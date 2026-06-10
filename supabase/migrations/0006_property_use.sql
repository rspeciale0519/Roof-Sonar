-- Property type via FL DOR use codes (01 = Single Family, 02 = Mobile Home,
-- 03/08 = Multi-family, 04/05 = Condo/Co-op, 00 = Vacant Residential).
-- Sourced from county address points now (Orange layer carries DOR_USE_CODE);
-- the annual NAL load can overwrite with authoritative values later.

alter table address_points add column if not exists dor_use_code text;
alter table properties     add column if not exists dor_use_code text;

create index if not exists properties_use_idx on properties (dor_use_code);

-- ---------------------------------------------------------------------------
-- geocode_join_address_points v2: fills geometry as before, and now also
-- backfills dor_use_code — including for properties that were already
-- geocoded by their source (Orlando's Socrata rows need use codes too).
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
      dor_use_code = coalesce(p.dor_use_code, a.dor_use_code),
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
      dor_use_code = coalesce(p.dor_use_code, a.dor_use_code),
      updated_at = now()
  from address_points a, jurisdictions j
  where p.jurisdiction_id = j.id
    and j.county = p_county
    and a.county = p_county
    and p.geom is null
    and a.situs_address = p.situs_address;
  get diagnostics v_situs = row_count;

  -- use-code backfill for rows that already had coordinates
  update properties p
  set dor_use_code = a.dor_use_code,
      updated_at = now()
  from address_points a, jurisdictions j
  where p.jurisdiction_id = j.id
    and j.county = p_county
    and a.county = p_county
    and p.dor_use_code is null
    and a.dor_use_code is not null
    and (
      (p.parcel_number is not null and a.parcel_number = p.parcel_number)
      or a.situs_address = p.situs_address
    );

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

-- ---------------------------------------------------------------------------
-- properties_in_bbox v3: adds use_buckets filter + dor_use_code in the
-- result. Return type changes => drop the v2 signature first.
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
  use_buckets    text[] default null,   -- of: 'single','condo','mobile','multi','vacant','other'
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
  pin_knocked_at  timestamptz,
  dor_use_code    text
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
    lp.knocked_at           as pin_knocked_at,
    p.dor_use_code
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
      use_buckets is null
      or (
        case left(coalesce(p.dor_use_code, ''), 2)
          when '01' then 'single'
          when '02' then 'mobile'
          when '03' then 'multi'
          when '08' then 'multi'
          when '04' then 'condo'
          when '05' then 'condo'
          when '00' then 'vacant'
          else 'other'
        end
      ) = any (use_buckets)
    )
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
