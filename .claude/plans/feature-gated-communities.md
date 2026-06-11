# Gated Communities Feature — Plan + /goal Spec

> **For the /goal run:** complete phases IN ORDER. Every EXIT CRITERIA below must be
> proven by command output, SQL results, or screenshots that appear in the transcript.
> Use the project git workflow: `/git-workflow-planning:start feature gated-communities`
> BEFORE any code; `/git-workflow-planning:checkpoint <n> <desc>` after each phase
> (update docs/ROADMAP.md first per Rule 7); `/git-workflow-planning:finish` at the end —
> create the PR but DO NOT merge (owner's call).

## GOAL

Show gated/private communities on the RoofSonar map as confidence-tiered shaded
polygons (single purple hue, three opacities), derived from authoritative county
private-road data crossed with OSM gate locations, with an admin confirm/clear page.
**Display only — zero route-behavior changes (Rob explicit).**

## CURRENT STATE (do not rediscover)

- Stack: Next.js 15 App Router + Supabase (service-role only, RLS no-policies model,
  PostGIS), Mapbox GL JS 3.24, Tailwind v4, vitest. Migrations 0001–0007 applied.
- Supabase CLI: `$env:SUPABASE_ACCESS_TOKEN = ((Get-Content .env.local | Where-Object { $_ -like 'SUPABASE_ACCESS_TOKEN=*' }) -replace '^SUPABASE_ACCESS_TOKEN=','').Trim(); npx supabase db query "<sql>" --linked`
  Long SQL: prefix `SET statement_timeout = '30min';`. Migrations: `npx supabase db push --linked`.
- Key files: `components/map-view.tsx` (Mapbox layers/sources), `components/filter-sidebar.tsx`
  (filter chips incl. USE_BUCKETS precedent), `components/map-app.tsx` (filter state),
  `app/api/properties/route.ts` (bbox API pattern), `lib/types.ts`, admin CRUD precedent at
  `app/admin/*` + `app/api/reps|pins|tags` (mirror their patterns incl. validation style).
- Verified data facts:
  - Orange roads layer: `https://ocgis4.ocfl.net/arcgis/rest/services/AGOL_Open_Data/MapServer/67`
    field `MAINTENANCE`, value `Private` = 3,370 segments (also values like Unincorporated/Orlando/FDOT…).
  - Seminole + Volusia road layers NOT yet identified — discover on their GIS servers
    (Seminole: services8.arcgis.com FTrtUCmxaVKdPC5e org + gis.seminolecountyfl.gov;
    Volusia: maps5.vcgov.org Open_Data services). Find centerline layer with a
    maintenance/ownership field; document layer URL + field/values in the county config.
  - OSM Overpass verified: Seminole bbox has 4,953 gate nodes (`barrier=gate|lift_gate|swing_gate`)
    + 12,109 private-access ways; Heathrow (Lake Mary, ~28.783, -81.373) densely gated — use as spot-check.
  - Overpass endpoint: https://overpass-api.de/api/interpreter (fallback mirror
    https://overpass.kumi.systems/api/interpreter). Be polite: 60–120s timeouts, retry/backoff,
    one county at a time.
- Two data ingests may still be running in background (Pinellas/Volusia properties) —
  they touch properties/raw_permits/address_points only; do not block on them, do not modify those tables.
- Working branch base: `main` (clean). Dev server port 3001 if needed (check before starting).

## DESIGN DECISIONS (Rob-approved — do not relitigate)

- Tiers: **high** = private road network + ≥1 OSM gate at/near it; **medium** = private
  network, no gate found; **low** = weak hint only (v1: OPTIONAL, may ship empty);
  **confirmed / cleared** = admin adjudication, overrides tier display.
- Color: one purple (#7c3aed) at three fill opacities ≈ high 0.28 / medium 0.16 / low 0.08;
  `confirmed` adds a crisp 1.5px border; `cleared` never renders.
- Sidebar gets a "Gated areas" show/hide toggle (display filter only). Default ON.
- **HARD: no route exclusion, no changes to route generation/assignment, pins, visits, tags.**
- Overlay must NOT intercept taps/clicks meant for property dots (mobile-critical):
  fill layer below dot layers, no click handler on it.

## PHASE 1 — Schema + data pipeline

Files: `supabase/migrations/0008_gated_areas.sql`, `scripts/build-gated-areas.ts`.

Migration 0008:
- `gated_areas`: id bigserial PK; county text CHECK (9 expansion counties, same list as 0007);
  name text; confidence text CHECK in ('high','medium','low'); status text CHECK in
  ('suggested','confirmed','cleared') default 'suggested'; geom geography(MultiPolygon,4326)
  NOT NULL; source jsonb; notes text; created_at/updated_at timestamptz default now().
  GIST index on geom; enable RLS (no policies — service-role model).
- Staging: `gated_road_segments` (id, county, geom geography(LineString,4326)) +
  `gated_gate_points` (id, county, geom geography(Point,4326)); GIST indexes; RLS on.
- SQL function `build_gated_areas(p_county text)`:
  DELETE existing suggested rows for county (keep confirmed/cleared);
  cluster staged segments via `ST_ClusterDBSCAN(geom::geometry, eps := 0.0008, minpoints := 4)`;
  per cluster: polygon = `ST_Multi(ST_Buffer(ST_Collect(geom::geometry)::geography, 30))`;
  discard clusters with < 6 segments or polygon area < 15,000 m² (driveway/utility noise);
  confidence = 'high' if any staged gate point within 60 m of the polygon, else 'medium';
  insert with source jsonb {segments: n, gates: n}; returns (inserted int, high int, medium int).
- Loader script `scripts/build-gated-areas.ts` (mirror fetch-address-points-* style):
  per-county config { roadsUrl, whereClause } (Orange: `MAINTENANCE='Private'`;
  Seminole/Volusia: as discovered); page ArcGIS polylines (f=json, outSR=4326), stage
  segments in batches; Overpass query for gate nodes in county bbox, stage points;
  call `build_gated_areas` RPC per county via supabase client (or CLI if it times out);
  print per-county counts. Counties for v1: Orange, Seminole, Volusia.

EXIT CRITERIA (each shown in transcript):
1. `npx supabase db push --linked` output shows 0008 applied.
2. Script run printing per-county staged segment count > 500 (Orange ≥ 2,000), gate count > 300,
   and RPC results: `SELECT county, confidence, count(*) FROM gated_areas GROUP BY 1,2` shows
   rows for all 3 counties with high-tier count ≥ 1 in Orange AND Seminole.
3. Heathrow spot-check returns ≥ 1 row:
   `SELECT id, confidence FROM gated_areas WHERE confidence='high' AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(-81.3727, 28.7831),4326)::geography, 1500)`.
4. `npm run lint` + `npm run test` + `npm run build` clean; roadmap updated;
   `/git-workflow-planning:checkpoint 1 gated areas schema and pipeline` succeeds.

## PHASE 2 — Map overlay + sidebar toggle

Files: `app/api/gated-areas/route.ts`, `components/map-view.tsx`,
`components/filter-sidebar.tsx`, `components/map-app.tsx`, `lib/types.ts`,
migration addition if an RPC is needed (`gated_areas_in_bbox` returning id, name,
confidence, status, geojson text via ST_AsGeoJSON — add as 0009 if 0008 already pushed).

- GET /api/gated-areas?minLng&minLat&maxLng&maxLat → GeoJSON FeatureCollection of
  non-cleared areas intersecting bbox (validate params the same way app/api/properties does).
- map-view: add a `gated` GeoJSON source + fill layer INSERTED BELOW property dot layers,
  fill-opacity by confidence per DESIGN DECISIONS; line layer (border) filtered to
  status='confirmed'; refresh with map moves (reuse the properties fetch-on-moveend pattern);
  no event handlers on gated layers.
- filter-sidebar: "Gated areas" toggle wired through map-app state (hide = setLayoutProperty
  visibility none); persists in the same way other filters do (in-memory is fine if that's the pattern).

EXIT CRITERIA:
1. `npm run lint` + `npm run test` + `npm run build` clean.
2. chrome-devtools (Rule 4 — never Playwright; leave browser open): navigate dev server →
   Lake Mary/Heathrow area; screenshot showing purple polygon overlay with visible dots on top;
   second screenshot with the toggle OFF showing overlay gone; `list_console_messages`
   shows no new errors from the gated layers.
3. Tap-through sanity: click a property dot inside a shaded area and the property modal
   still opens (screenshot or snapshot evidence).
4. Roadmap updated; `/git-workflow-planning:checkpoint 2 map overlay and toggle` succeeds.

## PHASE 3 — Admin confirm/clear page

Files: `app/admin/gated/page.tsx` (+ child components if needed, each ≤450 LOC),
`app/api/gated-areas/[id]/route.ts`.

- PATCH /api/gated-areas/[id]: body {status?: 'confirmed'|'cleared'|'suggested', name?: string,
  notes?: string} with the project's validation pattern; updates updated_at.
- Admin page mirroring existing admin CRUD pages: table of areas (county, name [inline editable],
  confidence badge, status, area in acres via SQL, created), actions Confirm / Clear / Re-suggest;
  filter by county + status; link per row to `/?focus=<bbox>` is OPTIONAL (skip if map-app lacks
  a cheap way to consume it — do not add map plumbing for it in this phase).
- Add nav link wherever the other admin pages are linked.

EXIT CRITERIA:
1. PATCH round-trip proven: curl (or vitest) showing status change to 'confirmed' and back, 200s.
2. Screenshot of /admin/gated rendering rows with working Confirm/Clear (one click shown
   changing a row's status badge).
3. `npm run lint` + `npm run test` + `npm run build` clean; roadmap updated;
   `/git-workflow-planning:checkpoint 3 gated admin page` succeeds.
4. `/git-workflow-planning:finish` → PR created (show `gh pr view --json url` or equivalent);
   DO NOT merge. Cleared with all HARD CONSTRAINTS.

## HARD CONSTRAINTS

- No route-behavior changes of any kind; no edits to visits/pins/tags/route flows.
- Do not change `properties_in_bbox` or the properties API contract.
- Source files ≤ 450 LOC; TypeScript strict (no `any`); follow existing component/API patterns.
- Migrations are additive; never edit applied migrations 0001–0007.
- Do not touch properties/raw_permits/address_points data (ingests may be running).
- Overpass + county ArcGIS: polite paging, retries with backoff, no parallel county pulls.
- Browser work via chrome-devtools MCP only; do not close the browser.
- If blocked on something only Rob can resolve, write it to `docs/temp/gated-blockers.md`
  and surface it in the final message instead of guessing.

## DEFINITION OF DONE

All EXIT CRITERIA for phases 1–3 evidenced in-transcript, in order; PR open (not merged);
final message reports: PR URL, per-county gated_areas counts by tier, Heathrow spot-check
result, and screenshot summary.
