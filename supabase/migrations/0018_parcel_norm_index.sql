-- Migration 0017 made apply_roof_permits match parcels by a normalized
-- expression (upper(regexp_replace(parcel_number,'[^A-Za-z0-9]','','g'))). With
-- no index on that expression the per-batch UPDATE full-scans the county's
-- properties and recomputes the regexp for every row — fine for small counties
-- but it trips PostgREST's ~8s statement timeout on large ones (Hillsborough,
-- 506k). This functional index matches the exact join expression so the match
-- becomes an index seek regardless of county size.

create index if not exists properties_parcel_norm_idx
  on properties (upper(regexp_replace(parcel_number, '[^A-Za-z0-9]', '', 'g')))
  where parcel_number is not null;
