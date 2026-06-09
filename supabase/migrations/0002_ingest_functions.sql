-- Ingest-side functions: atomic permit upserts (roof_year only advances),
-- NAL owner-roll upserts, and the address-point geocode join.

-- ---------------------------------------------------------------------------
-- Staging: county address points (parcel id + situs + lon/lat), used to
-- geocode file/scrape permits and NAL-only properties.
-- ---------------------------------------------------------------------------
create table if not exists address_points (
  id              bigserial primary key,
  county          text not null check (county in ('Seminole', 'Volusia', 'Orange')),
  parcel_number   text,
  situs_address   text,   -- normalized
  lng             double precision not null,
  lat             double precision not null
);

create index if not exists address_points_parcel_idx on address_points (county, parcel_number);
create index if not exists address_points_situs_idx  on address_points (county, situs_address);

alter table address_points enable row level security;

-- ---------------------------------------------------------------------------
-- Permit upsert: keyed on (jurisdiction_id, situs_address); roof_year and
-- last_permit_* only move forward (max issue date wins).
-- ---------------------------------------------------------------------------
create or replace function upsert_permit_property(
  p_jurisdiction_id int,
  p_parcel_number   text,
  p_situs_address   text,
  p_street_number   text,
  p_lng             double precision,
  p_lat             double precision,
  p_permit_number   text,
  p_permit_date     date,
  p_geocode_method  text
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
  v_year int := extract(year from p_permit_date)::int;
begin
  insert into properties as p (
    jurisdiction_id, parcel_number, situs_address, street_number, geom,
    roof_year, last_permit_number, last_permit_date, geocode_method, updated_at
  )
  values (
    p_jurisdiction_id,
    p_parcel_number,
    p_situs_address,
    p_street_number,
    case when p_lng is not null and p_lat is not null
         then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography end,
    v_year,
    p_permit_number,
    p_permit_date,
    p_geocode_method,
    now()
  )
  on conflict (jurisdiction_id, situs_address) do update
  set parcel_number      = coalesce(excluded.parcel_number, p.parcel_number),
      street_number      = coalesce(excluded.street_number, p.street_number),
      geom               = coalesce(excluded.geom, p.geom),
      geocode_method     = coalesce(excluded.geocode_method, p.geocode_method),
      roof_year          = greatest(coalesce(p.roof_year, 0), coalesce(excluded.roof_year, 0)),
      last_permit_number = case when excluded.last_permit_date >= coalesce(p.last_permit_date, '1900-01-01')
                                then excluded.last_permit_number else p.last_permit_number end,
      last_permit_date   = greatest(coalesce(p.last_permit_date, '1900-01-01'), excluded.last_permit_date),
      updated_at         = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- NAL owner-roll upsert: enriches existing rows AND creates permit-less rows
-- (year_built drives the "orig 'YY" label for original-roof leads).
-- roofing_squares is computed here from the current slope multiplier.
-- ---------------------------------------------------------------------------
create or replace function upsert_owner_parcel(
  p_jurisdiction_id int,
  p_parcel_number   text,
  p_situs_address   text,
  p_street_number   text,
  p_owner_name      text,
  p_owner_mailing   text,
  p_homestead       boolean,
  p_occupancy       text,
  p_year_built      int,
  p_building_sqft   int
)
returns bigint
language plpgsql
as $$
declare
  v_id bigint;
  v_mult decimal(3,2);
begin
  select roof_slope_multiplier into v_mult from settings order by id limit 1;

  insert into properties as p (
    jurisdiction_id, parcel_number, situs_address, street_number,
    owner_name, owner_mailing_address, homestead, occupancy, year_built,
    building_sqft, roofing_squares, updated_at
  )
  values (
    p_jurisdiction_id, p_parcel_number, p_situs_address, p_street_number,
    p_owner_name, p_owner_mailing, p_homestead, p_occupancy, p_year_built,
    p_building_sqft,
    case when p_building_sqft is not null
         then floor((p_building_sqft * coalesce(v_mult, 1.30)) / 100)::int end,
    now()
  )
  on conflict (jurisdiction_id, situs_address) do update
  set parcel_number         = coalesce(p.parcel_number, excluded.parcel_number),
      owner_name            = excluded.owner_name,
      owner_mailing_address = excluded.owner_mailing_address,
      homestead             = excluded.homestead,
      occupancy             = excluded.occupancy,
      year_built            = coalesce(excluded.year_built, p.year_built),
      building_sqft         = coalesce(excluded.building_sqft, p.building_sqft),
      roofing_squares       = case when coalesce(excluded.building_sqft, p.building_sqft) is not null
                                   then floor((coalesce(excluded.building_sqft, p.building_sqft) * coalesce(v_mult, 1.30)) / 100)::int
                                   else p.roofing_squares end,
      updated_at            = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Bulk wrapper for NAL loads: one round trip per batch of parcels.
-- Each element: {jurisdiction_id, parcel_number, situs_address, street_number,
--                owner_name, owner_mailing, homestead, occupancy, year_built, building_sqft}
create or replace function upsert_owner_parcels(p_rows jsonb)
returns int
language plpgsql
as $$
declare
  r jsonb;
  n int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    perform upsert_owner_parcel(
      (r->>'jurisdiction_id')::int,
      r->>'parcel_number',
      r->>'situs_address',
      r->>'street_number',
      r->>'owner_name',
      r->>'owner_mailing',
      (r->>'homestead')::boolean,
      r->>'occupancy',
      (r->>'year_built')::int,
      (r->>'building_sqft')::int
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Geocode join: fill geom for properties missing it, by parcel id first,
-- then by normalized situs address, against the staged address points.
-- Remaining misses are logged to geocode_failures.
-- ---------------------------------------------------------------------------
create or replace function geocode_join_address_points(p_county text)
returns table (matched_parcel int, matched_situs int, failed int)
language plpgsql
as $$
declare
  v_parcel int;
  v_situs  int;
  v_fail   int;
begin
  update properties p
  set geom = st_setsrid(st_makepoint(a.lng, a.lat), 4326)::geography,
      geocode_method = 'parcel_join',
      updated_at = now()
  from address_points a, jurisdictions j
  where p.jurisdiction_id = j.id
    and j.county = p_county
    and a.county = p_county
    and p.geom is null
    and p.parcel_number is not null
    and a.parcel_number = p.parcel_number;
  get diagnostics v_parcel = row_count;

  update properties p
  set geom = st_setsrid(st_makepoint(a.lng, a.lat), 4326)::geography,
      geocode_method = 'situs_join',
      updated_at = now()
  from address_points a, jurisdictions j
  where p.jurisdiction_id = j.id
    and j.county = p_county
    and a.county = p_county
    and p.geom is null
    and a.situs_address = p.situs_address;
  get diagnostics v_situs = row_count;

  insert into geocode_failures (jurisdiction_id, situs_address, parcel_number, reason)
  select p.jurisdiction_id, p.situs_address, p.parcel_number, 'no address-point match'
  from properties p
  join jurisdictions j on j.id = p.jurisdiction_id
  where j.county = p_county and p.geom is null
    and not exists (
      select 1 from geocode_failures f
      where f.jurisdiction_id = p.jurisdiction_id and f.situs_address = p.situs_address
    );
  get diagnostics v_fail = row_count;

  return query select v_parcel, v_situs, v_fail;
end;
$$;
