-- Backfill year_built + building_sqft (and recompute roofing_squares) for
-- properties that have coordinates but no owner-roll match — permit-only rows
-- whose situs never matched a NAL/PA situs. Parcel-keyed, county-scoped,
-- fills NULLs only (existing authoritative values always win). Set-based:
-- one UPDATE per batch. Source rows come from the county PA file the caller
-- streams in (scripts/backfill-building-data.ts).

create or replace function backfill_building_data(p_county text, p_rows jsonb)
returns int
language plpgsql
as $$
declare
  v_mult decimal(3,2);
  n int;
begin
  select roof_slope_multiplier into v_mult from settings order by id limit 1;
  v_mult := coalesce(v_mult, 1.30);

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
  ) r
  join jurisdictions j on j.county = p_county
  where p.jurisdiction_id = j.id
    and p.parcel_number = r.parcel
    and (p.building_sqft is null or p.year_built is null);

  get diagnostics n = row_count;
  return n;
end;
$$;
