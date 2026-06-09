# RoofRadar

Internal roofing-sales tool for **Seminole, Volusia, and Orange counties**: a satellite
map showing each house's street number, roof age (from public roofing permits), and
roofing squares — plus owner name and owner-occupied vs. rental classification from the
FL DOR tax roll. Select houses, export ordered door-knocking routes.
Source of truth: [`roof-radar-prd.md`](./roof-radar-prd.md).

## Stack

Next.js (App Router) · Supabase (Postgres + PostGIS) · Mapbox GL JS · Vercel · GitHub Actions

## Setup

1. **Supabase**: create a project, then apply migrations in order:
   ```
   psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql
   psql "$SUPABASE_DB_URL" -f supabase/migrations/0002_ingest_functions.sql
   ```
   (or `supabase db push` with the CLI). This enables PostGIS, creates the schema,
   seeds all 39 jurisdictions, and installs the RPCs (`properties_in_bbox`,
   `recalculate_roofing_squares`, ingest upserts). RLS is enabled with **no anon
   policies** — all access flows through server routes with the service-role key.
2. **Env**: copy `.env.example` → `.env.local` and fill in.
3. `npm install && npm run dev` → open http://localhost:3000 (password gate → map).

## Data pipeline

| Command | What it does |
|---|---|
| `npm run ingest:orlando -- --test` | 1,000-row Socrata sample + analysis, **no writes** |
| `npm run ingest:orlando -- --backfill` | full Orlando history (~87k permits) |
| `npm run ingest:orlando` | monthly incremental (`issue_permit_date > last loaded`) |
| `npm run ingest:volusia-api -- --verify-vocab` | dump distinct `FOLDERTYPE`/`FOLDERDESCRIPTION` — run before first ingest |
| `npm run ingest:volusia-api` | Volusia open permits (AMANDA via ArcGIS) |
| `npm run ingest:nal -- <county> --file <nal.zip>` | FL DOR NAL owner roll (owner, homestead, year built, sqft → squares, occupancy) |
| `npm run ingest:file -- <slug> <file>` | records-request extracts (CSV/XLSX), mapping in `ingest/configs/<slug>.json` |
| `npx tsx scripts/load-address-points.ts <county> <file>` | stage county address points + geocode join (parcel → situs → failures table) |
| `npx tsx scripts/generate-records-requests.ts` | regenerate the 39 FL Ch. 119 email drafts |

NAL files: floridarevenue.com/property/dataportal — county codes Seminole **69**,
Volusia **74**, Orange **58**. Annual refresh; permits refresh monthly via
`.github/workflows/monthly-ingest.yml` (set repo secrets `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SOCRATA_APP_TOKEN`).

## Map

- Labels at zoom ≥ 16: street number / roof age (`18 yrs` or `orig. '94`) / squares.
- Colors: 0–5 green · 6–10 yellow · 11–15 orange · 16+ red · unknown gray.
- Click to select, Shift-drag to box-select → selection panel orders stops
  nearest-neighbor, exports CSV (owner names + occupancy) and Google Maps links
  (≤10 waypoints/leg), and saves named routes.
- `/admin`: roof slope multiplier (default 1.30) — recalculates all squares on change.

## Status / next steps

- [x] Scaffold, schema, map, routes, exports, admin, auth, crons
- [x] Orlando + Volusia + NAL + file adapters written (verified offline; live pulls need network)
- [ ] Run `--test` ingests + backfills (needs network access to gov hosts)
- [ ] Verify + send records requests (`docs/records-requests/drafts/`)
- [ ] Finish Phase 0 portal discovery (`docs/phase0-discovery.md`)
- [ ] Vercel deploy (set all env vars; `APP_PASSWORD` gates everything)
