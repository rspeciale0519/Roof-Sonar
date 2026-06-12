-- Owner-roll upserts also carry the FL DOR use code so NAL-created rows
-- (full housing stock, no permit yet) participate in the property-type
-- filter. Existing non-null use codes are kept (county PA sources win).

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
  p_building_sqft   int,
  p_dor_use_code    text default null
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
    building_sqft, roofing_squares, dor_use_code, updated_at
  )
  values (
    p_jurisdiction_id, p_parcel_number, p_situs_address, p_street_number,
    p_owner_name, p_owner_mailing, p_homestead, p_occupancy, p_year_built,
    p_building_sqft,
    case when p_building_sqft is not null
         then floor((p_building_sqft * coalesce(v_mult, 1.30)) / 100)::int end,
    p_dor_use_code,
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
      dor_use_code          = coalesce(p.dor_use_code, excluded.dor_use_code),
      updated_at            = now()
  returning id into v_id;
  return v_id;
end;
$$;

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
      (r->>'building_sqft')::int,
      r->>'dor_use_code'
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
