-- Footprint-based roofing squares. The living-area estimate is consistently
-- 20-33% low (validated vs Planimeter); the actual roof plan area comes from a
-- building footprint (FEMA USA Structures), matched per property by
-- point-in-polygon (else nearest), then x slope. We store the footprint sqft
-- and which source produced roofing_squares so the UI can say "measured from
-- aerial". Matching happens in scripts/apply-footprint-squares.ts (grid index
-- in JS — no millions of polygons in the DB); these RPCs feed/consume it.

alter table properties add column if not exists footprint_sqft  int;
alter table properties add column if not exists squares_source  text;  -- 'footprint' | 'footprint_near' | null(=living_area)

-- Stream a county's geocoded property points for the matcher (paged by id).
create or replace function county_property_points(p_county text, p_after_id bigint default 0, p_limit int default 20000)
returns table (id bigint, lng double precision, lat double precision)
language sql stable as $$
  select p.id, st_x(p.geom::geometry), st_y(p.geom::geometry)
  from properties p
  join jurisdictions j on j.id = p.jurisdiction_id
  where j.county = p_county and p.geom is not null and p.id > p_after_id
  order by p.id
  limit greatest(1, least(p_limit, 50000));
$$;

-- Apply matched footprints: set footprint_sqft + recompute roofing_squares.
-- p_rows: [{ id, sqft, near }] where near=true means nearest-building fallback.
create or replace function set_footprint_squares(p_rows jsonb)
returns int
language plpgsql as $$
declare v_mult decimal(3,2); n int;
begin
  select roof_slope_multiplier into v_mult from settings order by id limit 1;
  v_mult := coalesce(v_mult, 1.30);

  update properties p
  set footprint_sqft  = r.sqft,
      roofing_squares = floor((r.sqft * v_mult) / 100)::int,
      squares_source  = case when r.near then 'footprint_near' else 'footprint' end,
      updated_at = now()
  from (
    select (x->>'id')::bigint as id, (x->>'sqft')::int as sqft, coalesce((x->>'near')::boolean, false) as near
    from jsonb_array_elements(p_rows) x
  ) r
  where p.id = r.id and r.sqft > 0;
  get diagnostics n = row_count;
  return n;
end;
$$;
