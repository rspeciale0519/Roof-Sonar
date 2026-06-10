-- RoofRadar initial schema (Supabase / Postgres + PostGIS)
-- Apply with: supabase db push, or psql -f against your Supabase database.

create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- Jurisdictions
-- ---------------------------------------------------------------------------
create table if not exists jurisdictions (
  id           serial primary key,
  slug         text not null unique,
  name         text not null,
  county       text not null check (county in ('Seminole', 'Volusia', 'Orange')),
  adapter_type text not null check (adapter_type in ('api', 'scrape', 'file')),
  notes        text
);

-- ---------------------------------------------------------------------------
-- Raw permits: every source row preserved verbatim
-- ---------------------------------------------------------------------------
create table if not exists raw_permits (
  id              bigserial primary key,
  jurisdiction_id int not null references jurisdictions (id),
  source_file     text,
  raw             jsonb not null,
  imported_at     timestamptz not null default now()
);

create index if not exists raw_permits_jurisdiction_idx on raw_permits (jurisdiction_id);

-- ---------------------------------------------------------------------------
-- Properties: one row per (jurisdiction, situs address)
-- ---------------------------------------------------------------------------
create table if not exists properties (
  id                    bigserial primary key,
  jurisdiction_id       int not null references jurisdictions (id),
  parcel_number         text,
  situs_address         text not null,
  street_number         text,
  geom                  geography (point, 4326),
  roof_year             int,
  last_permit_number    text,
  last_permit_date      date,
  -- owner module (FL DOR NAL)
  owner_name            text,
  owner_mailing_address text,
  homestead             boolean,
  occupancy             text check (occupancy in ('owner', 'likely_owner', 'absentee', 'investor', 'unknown')),
  year_built            int,
  resident_name         text, -- future skip-trace
  resident_source       text,
  -- roof measurement module
  building_sqft         int,
  roofing_squares       int,
  geocode_method        text,
  updated_at            timestamptz not null default now(),
  unique (jurisdiction_id, situs_address)
);

create index if not exists properties_geom_idx on properties using gist (geom);
create index if not exists properties_parcel_idx on properties (parcel_number);
create index if not exists properties_roof_year_idx on properties (roof_year);
create index if not exists properties_occupancy_idx on properties (occupancy);

-- ---------------------------------------------------------------------------
-- Settings (single-row table; roof slope multiplier is admin-configurable)
-- ---------------------------------------------------------------------------
create table if not exists settings (
  id                    serial primary key,
  roof_slope_multiplier decimal(3, 2) not null default 1.30
);

insert into settings (roof_slope_multiplier)
select 1.30
where not exists (select 1 from settings);

-- ---------------------------------------------------------------------------
-- Geocode failures: rows we could not place, for manual review
-- ---------------------------------------------------------------------------
create table if not exists geocode_failures (
  id              bigserial primary key,
  jurisdiction_id int references jurisdictions (id),
  situs_address   text,
  parcel_number   text,
  reason          text,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Routes
-- ---------------------------------------------------------------------------
create table if not exists routes (
  id         bigserial primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists route_stops (
  id          bigserial primary key,
  route_id    bigint not null references routes (id) on delete cascade,
  property_id bigint not null references properties (id) on delete cascade,
  stop_order  int not null
);

create index if not exists route_stops_route_idx on route_stops (route_id);

-- ---------------------------------------------------------------------------
-- Ingest run bookkeeping
-- ---------------------------------------------------------------------------
create table if not exists ingest_runs (
  id              bigserial primary key,
  jurisdiction_id int references jurisdictions (id),
  source          text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  rows_in         int,
  rows_upserted   int,
  status          text not null default 'running' check (status in ('running', 'success', 'error')),
  error           text
);

-- ---------------------------------------------------------------------------
-- RLS: this app serves PII-adjacent data through server routes using the
-- service-role key only. Lock every table away from anon/authenticated.
-- ---------------------------------------------------------------------------
alter table jurisdictions    enable row level security;
alter table raw_permits      enable row level security;
alter table properties       enable row level security;
alter table settings         enable row level security;
alter table geocode_failures enable row level security;
alter table routes           enable row level security;
alter table route_stops      enable row level security;
alter table ingest_runs      enable row level security;

-- ---------------------------------------------------------------------------
-- RPC: viewport bbox loading (called on map moveend), ~3k cap
-- ---------------------------------------------------------------------------
create or replace function properties_in_bbox(
  min_lng        double precision,
  min_lat        double precision,
  max_lng        double precision,
  max_lat        double precision,
  jurisdictions_ text[] default null,   -- slugs; null = all
  age_buckets    text[] default null,   -- of: '0-5','6-10','11-15','16+','unknown'
  occupancies    text[] default null,   -- of: 'owner','likely_owner','absentee','investor','unknown'
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
  last_permit_date date
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
    p.last_permit_date
  from properties p
  join jurisdictions j on j.id = p.jurisdiction_id
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
-- RPC: recalculate roofing squares after the slope multiplier changes
-- ---------------------------------------------------------------------------
create or replace function recalculate_roofing_squares()
returns int
language plpgsql
as $$
declare
  multiplier decimal(3, 2);
  affected   int;
begin
  select roof_slope_multiplier into multiplier from settings order by id limit 1;
  update properties
  set roofing_squares = floor((building_sqft * multiplier) / 100)::int,
      updated_at = now()
  where building_sqft is not null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed: jurisdiction matrix from the PRD
-- ---------------------------------------------------------------------------
insert into jurisdictions (slug, name, county, adapter_type, notes) values
  ('orlando',              'City of Orlando',              'Orange',   'api',    'VERIFIED Socrata SODA ryhf-m453; pre-geocoded'),
  ('volusia-county',       'Volusia County (unincorp.)',   'Volusia',  'api',    'VERIFIED ArcGIS open-permits layer (AMANDA); historical backfill via records request'),
  ('seminole-county',      'Seminole County (unincorp.)',  'Seminole', 'scrape', 'Building Permits Online portal; Phase 0 + records request'),
  ('sanford',              'City of Sanford',              'Seminole', 'scrape', 'Phase 0 + records request'),
  ('oviedo',               'City of Oviedo',               'Seminole', 'scrape', 'Phase 0 + records request'),
  ('lake-mary',            'City of Lake Mary',            'Seminole', 'scrape', 'Phase 0 + records request'),
  ('altamonte-springs',    'City of Altamonte Springs',    'Seminole', 'scrape', 'Phase 0 + records request'),
  ('casselberry',          'City of Casselberry',          'Seminole', 'scrape', 'Phase 0 + records request'),
  ('longwood',             'City of Longwood',             'Seminole', 'scrape', 'Phase 0 + records request'),
  ('winter-springs',       'City of Winter Springs',       'Seminole', 'scrape', 'Phase 0 + records request'),
  ('daytona-beach',        'City of Daytona Beach',        'Volusia',  'scrape', 'Priority: large housing stock'),
  ('deltona',              'City of Deltona',              'Volusia',  'scrape', 'Priority: largest Volusia city'),
  ('port-orange',          'City of Port Orange',          'Volusia',  'scrape', 'Priority: large housing stock'),
  ('ormond-beach',         'City of Ormond Beach',         'Volusia',  'scrape', 'Priority: large housing stock'),
  ('deland',               'City of DeLand',               'Volusia',  'scrape', 'Priority: large housing stock'),
  ('new-smyrna-beach',     'City of New Smyrna Beach',     'Volusia',  'scrape', 'Phase 0 + records request'),
  ('edgewater',            'City of Edgewater',            'Volusia',  'scrape', 'Phase 0 + records request'),
  ('debary',               'City of DeBary',               'Volusia',  'scrape', 'Phase 0 + records request'),
  ('orange-city',          'City of Orange City',          'Volusia',  'scrape', 'Phase 0 + records request'),
  ('holly-hill',           'City of Holly Hill',           'Volusia',  'scrape', 'Phase 0 + records request'),
  ('south-daytona',        'City of South Daytona',        'Volusia',  'scrape', 'Phase 0 + records request'),
  ('daytona-beach-shores', 'City of Daytona Beach Shores', 'Volusia',  'scrape', 'Phase 0 + records request'),
  ('ponce-inlet',          'Town of Ponce Inlet',          'Volusia',  'scrape', 'Phase 0 + records request'),
  ('lake-helen',           'City of Lake Helen',           'Volusia',  'scrape', 'Phase 0 + records request'),
  ('oak-hill',             'City of Oak Hill',             'Volusia',  'scrape', 'Phase 0 + records request'),
  ('pierson',              'Town of Pierson',              'Volusia',  'scrape', 'Phase 0 + records request'),
  ('orange-county',        'Orange County (unincorp.)',    'Orange',   'scrape', 'Fast Track (Accela, fast.ocfl.net); test Accela Civic Data API; records request'),
  ('winter-park',          'City of Winter Park',          'Orange',   'scrape', 'Priority: large housing stock'),
  ('apopka',               'City of Apopka',               'Orange',   'scrape', 'Priority: large housing stock'),
  ('ocoee',                'City of Ocoee',                'Orange',   'scrape', 'Priority: large housing stock'),
  ('winter-garden',        'City of Winter Garden',        'Orange',   'scrape', 'Priority: large housing stock'),
  ('maitland',             'City of Maitland',             'Orange',   'scrape', 'Priority: large housing stock'),
  ('belle-isle',           'City of Belle Isle',           'Orange',   'scrape', 'Phase 0 + records request'),
  ('edgewood',             'City of Edgewood',             'Orange',   'scrape', 'Phase 0 + records request'),
  ('eatonville',           'Town of Eatonville',           'Orange',   'scrape', 'Phase 0 + records request'),
  ('oakland',              'Town of Oakland',              'Orange',   'scrape', 'Phase 0 + records request'),
  ('windermere',           'Town of Windermere',           'Orange',   'scrape', 'Phase 0 + records request'),
  ('bay-lake',             'City of Bay Lake',             'Orange',   'file',   'Disney property; ~negligible residential; lowest priority'),
  ('lake-buena-vista',     'City of Lake Buena Vista',     'Orange',   'file',   'Disney property; ~negligible residential; lowest priority')
on conflict (slug) do nothing;
