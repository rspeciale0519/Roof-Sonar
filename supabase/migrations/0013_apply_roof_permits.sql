-- Apply roofing permits to already-loaded parcels by parcel number (set-based,
-- county-scoped). roof_year / last_permit_* only advance (newest issue wins),
-- mirroring upsert_permit_property but matched on parcel_number instead of
-- situs — used for counties loaded from a PA parcel roll (Sumter/Marion/Lake)
-- where the permit feed carries the same parcel id. p_rows: {parcel, dt, num}.

create or replace function apply_roof_permits(p_county text, p_rows jsonb)
returns int
language plpgsql
as $$
declare n int;
begin
  update properties p
  set roof_year = greatest(coalesce(p.roof_year, 0), extract(year from r.dt)::int),
      last_permit_date = greatest(coalesce(p.last_permit_date, '1900-01-01'::date), r.dt),
      last_permit_number = case when r.dt >= coalesce(p.last_permit_date, '1900-01-01'::date)
                                then r.num else p.last_permit_number end,
      updated_at = now()
  from (
    select x->>'parcel' as parcel, (x->>'dt')::date as dt, x->>'num' as num
    from jsonb_array_elements(p_rows) x
    where x->>'parcel' is not null and x->>'dt' is not null
  ) r
  join jurisdictions j on j.county = p_county
  where p.jurisdiction_id = j.id
    and p.parcel_number = r.parcel;
  get diagnostics n = row_count;
  return n;
end;
$$;
