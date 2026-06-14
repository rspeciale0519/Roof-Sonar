-- Cloud-enable the Tampa ingest + Hillsborough scraper so they run in GitHub
-- Actions without local files:
--   1. hcpa_parcel_map holds the HCPA STRAP<->FOLIO mapping that used to come
--      from the local parcel_4_public.dbf (Tampa: PIN=STRAP -> FOLIO; scraper:
--      FOLIO -> STRAP for the API call).
--   2. properties.permit_scraped_at replaces the scraper's local queue file as a
--      DB-resident cursor — a parcel is "done" once stamped, so the cloud runner
--      resumes across ephemeral runs and the backlog drains naturally.

create table if not exists hcpa_parcel_map (
  strap text primary key,
  folio text not null
);
create index if not exists hcpa_parcel_map_folio_idx on hcpa_parcel_map (folio);

alter table properties add column if not exists permit_scraped_at timestamptz;
