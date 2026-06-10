# RoofRadar — PRD v4 (Tri-County Complete + Owner/Rental Intelligence)

Internal roofing-sales tool. Satellite map covering **all of Seminole, Volusia, and Orange Counties** (every municipality + unincorporated areas), showing each house’s street number and roof age overlaid on the roof, derived from public roofing permit records — plus **owner name and owner-occupied vs. rental classification** from property appraiser rolls. Sales manager selects houses and exports ordered door-knocking routes. Data refreshes monthly.

-----

## Core Problem

Reps waste knocks on new roofs and pitch the wrong person (tenants instead of owners). Permit + ownership records solve both, but live across 25+ government systems and aren’t visual.

## Target User

- **Sales manager:** plans territories, selects houses, exports routes.
- **Sales reps:** receive ordered routes with address, roof age, owner name, occupancy flag.

## Success Metric

≥1 exported route/week actually run by reps; fewer wasted knocks; reps greet owner-occupants by name.

## Core User Loop

1. Pipeline ingests roofing permits + property appraiser rolls → roof age + owner info per address.
1. Manager views satellite map: street number, roof age, and roofing squares calculated on each roof; occupancy filter.
1. Manager selects houses → exports optimized route (CSV with owner names + Google Maps links).

-----

## Jurisdiction Matrix & Ingestion Strategy

**Architecture principle:** every jurisdiction is an *adapter* (`api` | `scrape` | `file`) emitting the same normalized permit record. Jurisdictions onboard independently — the map ships with whatever is loaded and grows as data arrives. Never block on the slowest city.

|#    |Jurisdiction                                                                                                                                                                                                            |Adapter           |Status / Plan                                                                                                                                                                                                                          |
|-----|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|1    |City of Orlando                                                                                                                                                                                                         |`api`             |**VERIFIED.** Socrata SODA (details below). Build first.                                                                                                                                                                               |
|2    |Volusia Co. (unincorp.)                                                                                                                                                                                                 |`api` + `file`    |**VERIFIED (partial).** ArcGIS REST layer of OPEN permits from AMANDA (details below) — good for ongoing; historical issued-permit backfill via records request.                                                                       |
|3    |Seminole Co. (unincorp.)                                                                                                                                                                                                |`scrape` or `file`|“Building Permits Online” portal — Phase 0 discovery; records request day 1.                                                                                                                                                           |
|4–10 |Seminole cities: Sanford, Oviedo, Lake Mary, Altamonte Springs, Casselberry, Longwood, Winter Springs                                                                                                                   |`scrape` or `file`|Each has own portal. Phase 0 discovery + records request day 1, each.                                                                                                                                                                  |
|11–26|Volusia cities: Daytona Beach, Deltona, Port Orange, Ormond Beach, DeLand, New Smyrna Beach, Edgewater, DeBary, Orange City, Holly Hill, South Daytona, Daytona Beach Shores, Ponce Inlet, Lake Helen, Oak Hill, Pierson|`scrape` or `file`|Same playbook. Prioritize by housing stock: Deltona, Port Orange, Daytona Beach, Ormond Beach, DeLand first.                                                                                                                           |
|27   |Orange Co. (unincorp.)                                                                                                                                                                                                  |`scrape` or `file`|Permits live in **Fast Track** (Accela-based, fast.ocfl.net) — NOT in county GIS (verified). Phase 0: Accela portals often expose date-range searches and sometimes the Accela Civic Data open API — check both. Records request day 1.|
|28–39|Orange cities: Winter Park, Apopka, Ocoee, Winter Garden, Maitland, Belle Isle, Edgewood, Eatonville, Oakland, Windermere, Bay Lake, Lake Buena Vista                                                                   |`scrape` or `file`|Same playbook. Prioritize by housing stock: Winter Park, Apopka, Ocoee, Winter Garden, Maitland. Bay Lake & Lake Buena Vista are Disney property (~negligible residential) — request data but lowest priority.                         |

**Phase 0 per non-API jurisdiction — stop at first success:**

1. Open the permit portal in a real browser (chrome-devtools-mcp); check the Network tab for underlying JSON/XHR endpoints and any issued-permits-by-date-range report.
1. Look for published monthly “permits issued” reports (CSV/XLSX/PDF) on the city site.
1. **File a public records request (FL Ch. 119)** — day 1, ALL jurisdictions in parallel, regardless of 1–2. Guaranteed path; this is the “hard files” reality. Template below.

**Records request template (email each building division):**

> Subject: Public Records Request — Roofing Permit Data
> 
> Per Florida Statutes Chapter 119, I request the following in electronic format (CSV or Excel preferred):
> 
> 1. All issued roofing/re-roof permits from January 1, 2000 to present: permit number, parcel ID, site address, permit type/work description, application date, issue date, final date, status.
> 1. The same report monthly going forward (prior month’s issued roofing permits) as a standing request, if accommodated.
> 
> Please advise of any fees before fulfilling. Thank you.

### Orlando adapter (verified June 2026)

- `https://data.cityoforlando.net/resource/ryhf-m453.json`
- Filter `application_type='Building Permit' AND worktype='Roof'` → ~86,900 records.
- Fields: `permit_number`, `parcel_number`, `permit_address`, `issue_permit_date`, `application_status`, `geocoded_column` (GeoJSON Point — **pre-geocoded**).
- `$limit`/`$offset` pagination; Socrata app token header. Monthly incremental on `issue_permit_date > LAST_RUN`.

### Volusia County adapter (verified June 2026)

- ArcGIS REST: `https://maps5.vcgov.org/arcgis/rest/services/CurrentProjects/MapServer/1/query`
- AMANDA permit “folders”: `FOLDERTYPE`, `FOLDERNAME`, `FOLDERDESCRIPTION` (filter roof: `FOLDERDESCRIPTION LIKE '%ROOF%'` — verify vocabulary), `INDATE`, `STATUSDESC`, `PID` (parcel ID), polygon geometry (parcel — compute point-on-surface), spatial ref WKID 2881 (FL StatePlane East ft) → reproject 4326.
- **Caveat:** layer contains OPEN permits only. Use for ongoing monthly capture; get the historical issued-permit extract via records request to Volusia Growth & Resource Mgmt (AMANDA can export it).
- Also load Volusia Open Data `Parcels` + address points layers for geocode joins (hub: opendata-volusiacountyfl.hub.arcgis.com).

### File adapter (the workhorse)

- Drop files into `/data/inbox/<jurisdiction>/` (CSV/XLSX/PDF).
- Per-jurisdiction mapping config (`/ingest/configs/<slug>.json`): source columns → normalized fields + roof-filter rules (`ROOF|RE-?ROOF`, verify per city).
- PDF reports: programmatic table extraction (pdfplumber helper); low-confidence rows flagged for review, never silently dropped.
- Originals archived to `/data/processed/`; every raw row preserved in `raw_permits`.

### Geocoding

- Orlando: pre-geocoded. Volusia API: parcel polygons.
- All file/scrape permits: join on parcel ID → county address-point layer, all **countywide incl. cities**: Seminole GIS Addresses layer, Volusia address layer, and Orange’s OCPA `PARCELS_SITUS` point layer (parcel ID + situs, from the OCPA GIS downloads / ocgis4.ocfl.net address-point services); fallback normalized situs-address join; fallback parcel centroid. Unmatched → `geocode_failures` review table.
- **Address normalization:** standardize all addresses (USPS-style abbreviations, casing, unit stripping) before any join — use an open library (e.g. libpostal or usps-style normalizer). Optional later: USPS Addresses API/CASS vendor for verification. This is where USPS fits — validation, not names.

-----

## Owner-Occupied vs. Rental Module (replaces the “USPS resident lookup” idea)

**Fact:** USPS does not disclose occupant names; no public API exists for “who lives here.” The equivalent-but-better public source is the property tax roll.

- **Source:** Florida DOR **NAL (Name-Address-Legal) files** — published annually, statewide, ONE standardized format covering Seminole, Volusia, AND Orange. Per parcel: owner name(s), owner mailing address, situs address, homestead exemption flag, year built, just/assessed values. Supplement/refresh from each county property appraiser’s download page (SCPA, VCPA, OCPA) if fresher data wanted.
- **Owner-occupancy logic per property:**
  - `homestead = true` → **owner-occupied** (FL homestead requires primary residence — strongest signal).
  - Else normalized owner mailing address == normalized situs address → **likely owner-occupied**.
  - Else → **RENTAL / absentee-owned** (tenant likely answers the door; the decision-maker is the owner at the mailing address — Yellow Letter Shop mail synergy).
  - Corporate/LLC owner name pattern → flag `investor_owned`.
- **Bonus solved for free:** `year_built` → permit-less houses labeled `orig. 'YY` (original roofs = prime leads).
- **Display:** map filter [Owner-occupied | Rental | Investor-owned | All]; owner name + classification in selection panel, popup, and route CSV (reps greet owners by name and skip or re-script rentals).
- **Tenant names at absentee homes:** only via paid skip-trace providers (BatchData/Melissa/PropStream). Deferred; schema leaves room (`resident_name`, `resident_source`).
- Annual refresh job for NAL files (separate from monthly permit cron).

-----

## Roof Age Logic

- `roof_year` = year of latest **issued** roofing permit per property across all sources (keep max issue date on upsert).
- `roof_age` computed at render. No permit → null → gray, label falls back to `orig. 'YY` from year_built when available.
- Exclude unissued/withdrawn/voided.

## Map Display Spec

- Mapbox GL JS, satellite, custom symbol layer. Three-line label centered on point:
  - Line 1: **street number** (bold, white, dark halo)
  - Line 2: **roof age** (`18 yrs` or `orig. '94`)
  - Line 3: **roofing squares** (e.g., `24 sqrs`, derived from `building_sqft × slope_multiplier`, first two leading digits)
- Colors: 0–5 green, 6–10 yellow, 11–15 orange, 16+ red, unknown gray. Red/gray + old-original = leads.
- Labels at zoom ≥ 16 only; cluster/heat below. Viewport bbox loading via Supabase RPC on `moveend`, ~3k cap. (v2: vector tiles.)
- Sidebar filters: jurisdiction, age bucket, **occupancy (owner-occupied / absentee / investor)**.

## Route Export Spec

- Click toggle + Shift-drag box-select; selection panel with count.
- Nearest-neighbor ordering from chosen start (no paid optimization API).
- Exports: **CSV** (stop #, address, roof age, roofing squares, **owner name, occupancy**, lat, lon) + **Google Maps links** chunked ≤10 waypoints per leg.
- Named routes saved (re-open/re-export). No rep accounts/knock-status in MVP.

## Database Schema (Supabase / Postgres + PostGIS)

```sql
jurisdictions (id, slug, name, county, adapter_type, notes)

raw_permits (id, jurisdiction_id fk, source_file text, raw jsonb, imported_at)

properties (
  id bigint pk,
  jurisdiction_id fk,
  parcel_number text,
  situs_address text,
  street_number text,
  geom geography(point),         -- GiST index
  roof_year int,
  last_permit_number text,
  last_permit_date date,
  -- owner module
  owner_name text,
  owner_mailing_address text,
  homestead boolean,
  occupancy text,                -- 'owner'|'likely_owner'|'absentee'|'investor'|'unknown'
  year_built int,
  resident_name text,            -- future skip-trace
  resident_source text,
  -- roof measurement module
  building_sqft int,             -- total building area from property appraiser
  roofing_squares int,           -- computed: floor((building_sqft * roof_slope_multiplier) / 100)
  geocode_method text,
  updated_at timestamptz,
  unique (jurisdiction_id, situs_address)
)

settings (
  id serial pk,
  roof_slope_multiplier decimal(3,2)  -- default 1.30 (typical); admin-configurable
)

geocode_failures (id, jurisdiction_id, situs_address, parcel_number, reason)
routes (id, name, created_at)
route_stops (id, route_id fk, property_id fk, stop_order int)
ingest_runs (id, jurisdiction_id, source text, started_at, finished_at, rows_in, rows_upserted, status, error)
```

## Pipeline & Refresh

- `/scripts` (TS): `ingest:orlando`, `ingest:volusia-api`, `ingest:scrape -- <slug>`, `ingest:file -- <slug> <path>`, `ingest:nal -- <county>`.
- **Monthly** GitHub Actions cron: API + viable scrape adapters auto-run. File jurisdictions: monthly emailed reports → drop in inbox → `ingest:file` (manual ~15 min/mo; automate later).
- **Annually:** NAL owner-roll refresh.
- Upserts only advance `roof_year` forward; all runs in `ingest_runs`.

## Auth

Shared-password middleware gate (`APP_PASSWORD`, httpOnly cookie). Contains homeowner PII-adjacent data — never public. Roles deferred.

## Admin Settings Page

- **Roof slope multiplier** (default 1.30): admin can adjust to 1.1, 1.2, 1.3, 1.4, etc.
  - On change, trigger a `recalculate_roofing_squares` Postgres function to refresh all `roofing_squares` values across properties where `building_sqft` is not null.
  - Changes take effect immediately on the map (filter and refresh).
- Stores in `settings` table; cached client-side for calculations during render.

## Build Phases

- [ ] **P0 (Day 1–2):** Repo, scaffold, schema. Draft + send ~37 records requests (every jurisdiction in the matrix — batch-generate from one template + contacts list). Verify Orlando + Volusia endpoints with samples. Begin portal discovery.
- [ ] **P1 (D2–4):** Orlando backfill. NAL files for 3 counties loaded → owner module live. County address layers loaded. Map page complete (labels, colors, zoom gating, filters).
- [ ] **P2 (D4–6):** Selection, routing, exports (with roofing squares), saved routes, admin settings page, password gate, Vercel deploy. **Live and useful with Orlando + owner data alone.**
- [ ] **P3 (D5–7+):** Volusia API adapter live; scrape adapters where Phase 0 found viable portals; file adapter + configs ready.
- [ ] **P4 (rolling, wk 2–6):** City extracts imported as they arrive; each goes live same day. Monthly cron + annual NAL job live.

## NOT Building Yet

- Paid skip-trace tenant names; knock-status tracking; rep accounts; CRM sync
- Email auto-import of monthly reports; vector tiles; CASS-certified address verification
- Lead scoring, storm overlays, automated direct-mail handoff to Yellow Letter Shop (natural v2: absentee-owner mail campaigns)

## Tech Stack

Next.js (App Router) + Supabase (Postgres/PostGIS) + Mapbox GL JS + Vercel + GitHub Actions + Playwright. UI: shadcn/ui.

## Env Vars

`NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SOCRATA_APP_TOKEN`, `APP_PASSWORD`.

-----

## Claude Code Starter Prompt

```
Read roof-radar-prd.md in the repo root — it is the source of truth.

Build RoofRadar per the PRD. Sequence:

1. git init; gh repo create roof-radar --private --source=. --push
2. Next.js scaffold + Supabase schema (enable PostGIS)
3. scripts/ingest-orlando.ts (verified Socrata endpoint) — test $limit=1000,
   show me results, ask before full backfill
4. scripts/ingest-nal.ts — download FL DOR NAL files for Seminole, Volusia,
   Orange; load owner/homestead/year_built per the Owner & Occupancy Module
5. Draft the records-request emails (one per jurisdiction in the matrix)
   from the PRD template for me to review and send
6. scripts/ingest-volusia-api.ts (verified ArcGIS endpoint — verify roof
   vocabulary in FOLDERDESCRIPTION first)
7. Phase 0 discovery: open each jurisdiction portal with chrome-devtools-mcp
   (incl. Orange County Fast Track / Accela — also test the Accela Civic
   Data API), check Network tab for JSON endpoints / date-range reports,
   viability report per jurisdiction BEFORE writing any scraper
8. Map page per Map Display Spec, then Route Export Spec

Stack: Next.js + Supabase + Mapbox GL + Vercel.
Stop and ask me before: full backfills, sending anything to a government
office, and the first Vercel deploy.
```