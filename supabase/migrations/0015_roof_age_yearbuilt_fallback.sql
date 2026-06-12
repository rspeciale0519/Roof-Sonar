-- Roof-age coloring/filter falls back to year_built when there is no re-roof
-- permit (roof_year). An un-permitted house almost certainly has its original
-- roof, so its age is best estimated from the build year — this surfaces old
-- roofs as leads instead of hiding ~69% of the map in the gray "unknown"
-- bucket. The map label already distinguishes the two ("18 yrs" vs "orig.
-- '94"); only the age BUCKET changes. "unknown" now means no year at all.
-- Only the age CASE changes vs 0006; the rest of properties_in_bbox is identical.

create or replace function properties_in_bbox(
  min_lng        double precision,
  min_lat        double precision,
  max_lng        double precision,
  max_lat        double precision,
  jurisdictions_ text[] default null,
  age_buckets    text[] default null,
  occupancies    text[] default null,
  use_buckets    text[] default null,
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
          when coalesce(p.roof_year, p.year_built) is null then 'unknown'
          when extract(year from now())::int - coalesce(p.roof_year, p.year_built) <= 5  then '0-5'
          when extract(year from now())::int - coalesce(p.roof_year, p.year_built) <= 10 then '6-10'
          when extract(year from now())::int - coalesce(p.roof_year, p.year_built) <= 15 then '11-15'
          else '16+'
        end
      ) = any (age_buckets)
    )
  limit greatest(1, least(max_rows, 3000));
$$;
