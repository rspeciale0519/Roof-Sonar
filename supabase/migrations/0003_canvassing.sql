-- Canvassing: sales reps, pin/tag vocabularies, visit events, notes,
-- route assignment + lifecycle. Pins = per-visit outcome markers;
-- tags = reusable property labels. Both admin-managed, archive-not-delete.

create table if not exists sales_reps (
  id         bigserial primary key,
  name       text not null,
  phone      text,
  email      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists pin_types (
  id                 serial primary key,
  label              text not null unique,
  color              text not null default '#f97316',
  icon               text,                       -- lucide icon name (admin UI chip)
  expires_after_days int,                        -- null = never expires
  is_do_not_knock    boolean not null default false,
  counts_as_contact  boolean not null default true,
  counts_as_lead     boolean not null default false,
  archived           boolean not null default false,
  sort_order         int not null default 0
);

create table if not exists tags (
  id       serial primary key,
  label    text not null unique,
  archived boolean not null default false
);

create table if not exists visits (
  id           bigserial primary key,
  property_id  bigint not null references properties (id) on delete cascade,
  route_id     bigint references routes (id) on delete set null,
  rep_id       bigint references sales_reps (id),   -- no on-delete: reps are soft-deactivated, never hard-deleted
  pin_type_id  int not null references pin_types (id),
  note         text,
  knocked_at   timestamptz not null default now(),
  knock_lng    double precision,   -- future rep app geostamp
  knock_lat    double precision
);

create index if not exists visits_property_latest_idx on visits (property_id, knocked_at desc);
create index if not exists visits_rep_idx on visits (rep_id, knocked_at desc);
create index if not exists visits_route_idx on visits (route_id);

create table if not exists property_notes (
  id          bigserial primary key,
  property_id bigint not null references properties (id) on delete cascade,
  rep_id      bigint references sales_reps (id),   -- null = admin
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists property_notes_property_idx on property_notes (property_id, created_at desc);

create table if not exists property_tags (
  property_id bigint not null references properties (id) on delete cascade,
  tag_id      int not null references tags (id) on delete cascade,
  primary key (property_id, tag_id)
);

create table if not exists route_assignments (
  id          bigserial primary key,
  route_id    bigint not null references routes (id) on delete cascade,
  rep_id      bigint not null references sales_reps (id),
  assigned_at timestamptz not null default now()
);

alter table routes add column if not exists rep_id bigint references sales_reps (id);
alter table routes add column if not exists status text not null default 'draft'
  check (status in ('draft', 'assigned', 'in_progress', 'completed'));

alter table properties add column if not exists do_not_knock boolean not null default false;

alter table sales_reps        enable row level security;
alter table pin_types         enable row level security;
alter table tags              enable row level security;
alter table visits            enable row level security;
alter table property_notes    enable row level security;
alter table property_tags     enable row level security;
alter table route_assignments enable row level security;

-- Seed pin vocabulary (admin can edit later)
insert into pin_types (label, color, icon, expires_after_days, is_do_not_knock, counts_as_contact, counts_as_lead, sort_order) values
  ('Not Home',           '#9ca3af', 'door-closed',    14,   false, false, false, 1),
  ('Not Interested',     '#ef4444', 'x-circle',       null, false, true,  false, 2),
  ('Interested',         '#22c55e', 'thumbs-up',      null, false, true,  true,  3),
  ('Appointment Set',    '#10b981', 'calendar-check', null, false, true,  true,  4),
  ('Callback Requested', '#eab308', 'phone',          null, false, true,  true,  5),
  ('Do Not Knock',       '#111827', 'ban',            null, true,  true,  false, 6)
on conflict (label) do nothing;

-- ---------------------------------------------------------------------------
-- record_visit: one atomic call per pin drop. Sets the property DNK flag and
-- advances route status (assigned -> in_progress -> completed).
-- ---------------------------------------------------------------------------
create or replace function record_visit(
  p_property_id bigint,
  p_pin_type_id int,
  p_rep_id      bigint default null,
  p_route_id    bigint default null,
  p_note        text default null,
  p_lng         double precision default null,
  p_lat         double precision default null
)
returns bigint
language plpgsql
as $$
declare
  v_id  bigint;
  v_dnk boolean;
  v_open int;
begin
  insert into visits (property_id, route_id, rep_id, pin_type_id, note, knock_lng, knock_lat)
  values (p_property_id, p_route_id, p_rep_id, p_pin_type_id, nullif(trim(p_note), ''), p_lng, p_lat)
  returning id into v_id;

  select is_do_not_knock into v_dnk from pin_types where id = p_pin_type_id;
  if v_dnk then
    update properties set do_not_knock = true, updated_at = now() where id = p_property_id;
  end if;

  if p_route_id is not null then
    update routes set status = 'in_progress'
    where id = p_route_id and status in ('draft', 'assigned');

    -- NOTE: completion check is best-effort under concurrency (READ COMMITTED):
    -- two reps finishing a route simultaneously can leave it 'in_progress'.
    -- Status is dashboard-only; acceptable for an internal tool.
    select count(*) into v_open
    from route_stops rs
    where rs.route_id = p_route_id
      and not exists (select 1 from visits v where v.route_id = p_route_id and v.property_id = rs.property_id);
    if v_open = 0 then
      update routes set status = 'completed' where id = p_route_id;
    end if;
  end if;

  return v_id;
end;
$$;

-- undo_visit: delete + recompute the DNK flag from remaining history.
-- Deliberately does not revert route status (status is non-load-bearing).
create or replace function undo_visit(p_visit_id bigint)
returns void
language plpgsql
as $$
declare
  v_property bigint;
begin
  delete from visits where id = p_visit_id returning property_id into v_property;
  if v_property is not null then
    update properties p
    set do_not_knock = exists (
      select 1 from visits v join pin_types pt on pt.id = v.pin_type_id
      where v.property_id = p.id and pt.is_do_not_knock
    )
    where p.id = v_property;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- properties_in_bbox v2: adds do_not_knock + latest non-expired pin.
-- Return type changes => must drop first.
-- ---------------------------------------------------------------------------
drop function if exists properties_in_bbox(
  double precision, double precision, double precision, double precision,
  text[], text[], text[], int
);

create or replace function properties_in_bbox(
  min_lng        double precision,
  min_lat        double precision,
  max_lng        double precision,
  max_lat        double precision,
  jurisdictions_ text[] default null,
  age_buckets    text[] default null,
  occupancies    text[] default null,
  max_rows       int default 3000
)
returns table (
  id              bigint,
  lng             double precision,
  lat             double precision,
  situs_address   text,
  street_number   text,
  roof_year       int,
  year_built      int,
  roofing_squares int,
  owner_name      text,
  occupancy       text,
  jurisdiction    text,
  last_permit_date date,
  do_not_knock    boolean,
  pin_type_id     int,
  pin_label       text,
  pin_color       text,
  pin_knocked_at  timestamptz
)
language sql
stable
as $$
  select
    p.id,
    st_x(p.geom::geometry)  as lng,
    st_y(p.geom::geometry)  as lat,
    p.situs_address,
    p.street_number,
    p.roof_year,
    p.year_built,
    p.roofing_squares,
    p.owner_name,
    coalesce(p.occupancy, 'unknown') as occupancy,
    j.slug                  as jurisdiction,
    p.last_permit_date,
    p.do_not_knock,
    lp.pin_type_id,
    lp.label                as pin_label,
    lp.color                as pin_color,
    lp.knocked_at           as pin_knocked_at
  from properties p
  join jurisdictions j on j.id = p.jurisdiction_id
  left join lateral (
    select v.pin_type_id, v.knocked_at, pt.label, pt.color
    from visits v
    join pin_types pt on pt.id = v.pin_type_id
    where v.property_id = p.id
      and (pt.expires_after_days is null
           or v.knocked_at > now() - make_interval(days => pt.expires_after_days))
    order by v.knocked_at desc
    limit 1
  ) lp on true
  where p.geom is not null
    and p.geom && st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
    and (jurisdictions_ is null or j.slug = any (jurisdictions_))
    and (occupancies is null or coalesce(p.occupancy, 'unknown') = any (occupancies))
    and (
      age_buckets is null
      or (
        case
          when p.roof_year is null then 'unknown'
          when extract(year from now())::int - p.roof_year <= 5  then '0-5'
          when extract(year from now())::int - p.roof_year <= 10 then '6-10'
          when extract(year from now())::int - p.roof_year <= 15 then '11-15'
          else '16+'
        end
      ) = any (age_buckets)
    )
  limit greatest(1, least(max_rows, 3000));
$$;

-- ---------------------------------------------------------------------------
-- rep_knock_stats: doors knocked / contacts / leads per rep over a window,
-- plus route assignment + completion counts.
-- leads is a subset of contacts (every lead pin also counts_as_contact);
-- intended rates: contacts/doors_knocked, leads/contacts.
-- ---------------------------------------------------------------------------
create or replace function rep_knock_stats(p_days int default 7)
returns table (
  rep_id           bigint,
  rep_name         text,
  doors_knocked    bigint,
  contacts         bigint,
  leads            bigint,
  routes_assigned  bigint,
  routes_completed bigint
)
language sql
stable
as $$
  select
    r.id   as rep_id,
    r.name as rep_name,
    count(v.id)                                  as doors_knocked,
    count(v.id) filter (where pt.counts_as_contact) as contacts,
    count(v.id) filter (where pt.counts_as_lead)    as leads,
    (select count(*) from routes rt where rt.rep_id = r.id)                          as routes_assigned,
    (select count(*) from routes rt where rt.rep_id = r.id and rt.status = 'completed') as routes_completed
  from sales_reps r
  left join visits v
    on v.rep_id = r.id and v.knocked_at > now() - make_interval(days => p_days)
  left join pin_types pt on pt.id = v.pin_type_id
  where r.active
  group by r.id, r.name
  order by doors_knocked desc;
$$;
