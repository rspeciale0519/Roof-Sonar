-- Gated communities: confidence-tiered polygons derived from county
-- private-road networks (authoritative) crossed with OSM gate locations.
-- Display-only feature: no route behavior reads these tables.

create table if not exists gated_areas (
  id         bigserial primary key,
  county     text not null check (county in ('Seminole', 'Volusia', 'Orange',
                                             'Pinellas', 'Hillsborough', 'Pasco',
                                             'Sumter', 'Lake', 'Marion')),
  name       text,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  status     text not null default 'suggested'
             check (status in ('suggested', 'confirmed', 'cleared')),
  geom       geography(multipolygon, 4326) not null,
  source     jsonb,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gated_areas_geom_idx on gated_areas using gist (geom);
create index if not exists gated_areas_county_idx on gated_areas (county, status);
alter table gated_areas enable row level security;

-- staging: raw private-road centerline segments + OSM gate nodes per county
create table if not exists gated_road_segments (
  id     bigserial primary key,
  county text not null,
  geom   geography(linestring, 4326) not null
);
create index if not exists gated_road_segments_geom_idx on gated_road_segments using gist (geom);
create index if not exists gated_road_segments_county_idx on gated_road_segments (county);
alter table gated_road_segments enable row level security;

create table if not exists gated_gate_points (
  id     bigserial primary key,
  county text not null,
  geom   geography(point, 4326) not null
);
create index if not exists gated_gate_points_geom_idx on gated_gate_points using gist (geom);
create index if not exists gated_gate_points_county_idx on gated_gate_points (county);
alter table gated_gate_points enable row level security;

-- Rebuild suggested areas for a county from staged segments + gates.
-- Confirmed/cleared rows survive rebuilds; new suggestions that overlap an
-- adjudicated area are skipped so admin decisions stick.
create or replace function build_gated_areas(p_county text)
returns table (inserted int, high_count int, medium_count int)
language plpgsql
as $$
declare
  v_ins  int;
  v_high int;
  v_med  int;
begin
  delete from gated_areas where county = p_county and status = 'suggested';

  with seg as (
    select geom::geometry as g
    from gated_road_segments
    where county = p_county
  ),
  clustered as (
    select g, ST_ClusterDBSCAN(g, eps := 0.0008, minpoints := 4) over () as cid
    from seg
  ),
  polys as (
    select cid,
           count(*) as nseg,
           ST_Buffer(ST_Collect(g)::geography, 30) as poly
    from clustered
    where cid is not null
    group by cid
  ),
  keep as (
    select nseg, poly, ST_Area(poly) as area_m2
    from polys
    where nseg >= 6 and ST_Area(poly) >= 15000
  ),
  tiered as (
    select k.nseg, k.poly, k.area_m2,
           (select count(*) from gated_gate_points gp
             where gp.county = p_county
               and ST_DWithin(gp.geom, k.poly, 60)) as gate_n
    from keep k
    where not exists (
      select 1 from gated_areas ga
      where ga.county = p_county
        and ga.status in ('confirmed', 'cleared')
        and ST_Intersects(ga.geom, k.poly)
    )
  )
  insert into gated_areas (county, confidence, status, geom, source)
  select p_county,
         case when gate_n > 0 then 'high' else 'medium' end,
         'suggested',
         ST_Multi(poly::geometry)::geography,
         jsonb_build_object('segments', nseg, 'gates', gate_n, 'area_m2', round(area_m2))
  from tiered;
  get diagnostics v_ins = row_count;

  select count(*) filter (where confidence = 'high'),
         count(*) filter (where confidence = 'medium')
    into v_high, v_med
  from gated_areas
  where county = p_county and status = 'suggested';

  return query select v_ins, v_high, v_med;
end;
$$;

-- bbox fetch for the map overlay (mirrors properties_in_bbox's bbox pattern)
create or replace function gated_areas_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision
)
returns table (id bigint, name text, confidence text, status text, geojson text)
language sql
stable
as $$
  select g.id, g.name, g.confidence, g.status, ST_AsGeoJSON(g.geom) as geojson
  from gated_areas g
  where g.status <> 'cleared'
    and g.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  limit 500;
$$;
