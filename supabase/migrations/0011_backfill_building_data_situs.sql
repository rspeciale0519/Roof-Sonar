-- Extend the building-data backfill to also match by county + normalized situs,
-- not just parcel. Permit-only rows often carry a different parcel format than
-- the owner roll and can sit under a different jurisdiction slug than the NAL
-- row for the same house, so a parcel-only match misses them. We match by
-- parcel first, then by (county, situs) for whatever is still null. Fills NULLs
-- only; recompute roofing_squares when building_sqft is newly set.

create or replace function backfill_building_data(p_county text, p_rows jsonb)
returns int
language plpgsql
as $$
declare
  v_mult decimal(3,2);
  n1 int := 0;
  n2 int := 0;
begin
  select roof_slope_multiplier into v_mult from settings order by id limit 1;
  v_mult := coalesce(v_mult, 1.30);

  -- Pass 1: parcel match
  update properties p
  set building_sqft = coalesce(p.building_sqft, r.sqft),
      year_built    = coalesce(p.year_built, r.yb),
      roofing_squares = case
        when p.building_sqft is null and r.sqft is not null
          then floor((r.sqft * v_mult) / 100)::int
        else p.roofing_squares end,
      updated_at = now()
  from (
    select x->>'parcel'      as parcel,
           (x->>'sqft')::int as sqft,
           (x->>'yb')::int   as yb
    from jsonb_array_elements(p_rows) x
    where x->>'parcel' is not null
  ) r
  join jurisdictions j on j.county = p_county
  where p.jurisdiction_id = j.id
    and p.parcel_number = r.parcel
    and (p.building_sqft is null or p.year_built is null);
  get diagnostics n1 = row_count;

  -- Pass 2: county + situs match for rows still missing data
  update properties p
  set building_sqft = coalesce(p.building_sqft, r.sqft),
      year_built    = coalesce(p.year_built, r.yb),
      roofing_squares = case
        when p.building_sqft is null and r.sqft is not null
          then floor((r.sqft * v_mult) / 100)::int
        else p.roofing_squares end,
      updated_at = now()
  from (
    select x->>'situs'       as situs,
           (x->>'sqft')::int as sqft,
           (x->>'yb')::int   as yb
    from jsonb_array_elements(p_rows) x
    where x->>'situs' is not null and length(x->>'situs') > 4
  ) r
  join jurisdictions j on j.county = p_county
  where p.jurisdiction_id = j.id
    and p.situs_address = r.situs
    and (p.building_sqft is null or p.year_built is null);
  get diagnostics n2 = row_count;

  return n1 + n2;
end;
$$;
