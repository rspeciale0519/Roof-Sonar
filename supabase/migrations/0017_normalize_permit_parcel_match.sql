-- apply_roof_permits matched parcel ids with raw equality (p.parcel_number =
-- r.parcel). That silently dropped permits wherever the stored roll and the
-- permit feed format the same parcel differently — notably Sumter, whose roll
-- mixes clean (D12A001) and dashed (C21-020) parcels, so ~half its roofing
-- permits never applied. Normalize BOTH sides to alphanumeric-only so the match
-- is separator-insensitive. Idempotent for already-clean ids; works whether the
-- ingest sends raw or stripped parcels (so --raw-parcel no longer matters).
-- Only the join predicate changes vs 0013.

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
    select upper(regexp_replace(x->>'parcel', '[^A-Za-z0-9]', '', 'g')) as parcel,
           (x->>'dt')::date as dt, x->>'num' as num
    from jsonb_array_elements(p_rows) x
    where x->>'parcel' is not null and x->>'dt' is not null
  ) r
  join jurisdictions j on j.county = p_county
  where p.jurisdiction_id = j.id
    and upper(regexp_replace(p.parcel_number, '[^A-Za-z0-9]', '', 'g')) = r.parcel;
  get diagnostics n = row_count;
  return n;
end;
$$;
