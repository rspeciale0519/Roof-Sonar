# RoofSonar Development Roadmap

> Renamed from RoofRadar on 2026-06-10 (domain: roofsonar.com).

## Completed

- [x] MVP: Supabase/PostGIS schema, 4 ingest adapters, Mapbox map with age-bucket labels, routing, CSV/Google Maps exports, password gate (2026-06)
- [x] Remove vulnerable xlsx dependency; file adapter is CSV-only (2026-06-09)
- [x] Verify Orlando Socrata + Volusia ArcGIS adapters against live endpoints; fix Volusia field mapping (FOLDERTYPE='ROOF', FOLDERNAME address, client-side centroids) (2026-06-09)
- [x] Supabase project provisioned: migrations 0001–0002 applied, PostGIS on, RLS on all tables, 39 jurisdictions seeded (2026-06-09)
- [x] Map label fixes: collision-suppressed age line; doubled street number (2026-06-09)
- [x] First live data: Volusia open roof permits (203) + Orlando historical backfill (2026-06-09)

## Canvassing Operations (plan: .claude/plans/feature-canvassing.md)

- [x] Phase 1 — Schema, types, test harness (migrations 0003+0004, vitest, nearestProperty) (2026-06-09)
- [x] Phase 2 — Reps, pin types, tags: APIs + admin pages (2026-06-10)
- [x] Phase 3 — Route assignment + lifecycle (rep, status, DNK hard filter) (2026-06-10)
- [x] Phase 4 — Property modal + pin layer (read path) (2026-06-10)
- [x] Phase 5 — Pin drop flow (tray, snap, undo) + GPS follow-me (2026-06-10)
- [x] Phase 6 — Knock metrics dashboard + mobile responsiveness pass (2026-06-10)

## Expansion: Tampa Bay + The Villages (researched 2026-06-10 — see docs/data-sources-tampa-villages.md)

- [ ] Pinellas ingest (best source of any county: PA nightly CSVs incl. RP_PERMITS — 1.64M permits, 424k ROOF-typed, all 24 jurisdictions, 1997+; label-point shapefile for lat/lng)
- [ ] Hillsborough: PA weekly parcel+latlon ingest; Tampa permits via CivicData CKAN (2004+, daily refresh, PIN=STRAP join)
- [ ] Marion: PA daily parcel CSV + script CDPlus permit search (1995→Nov 2025, verified scriptable, re-roof type codes)
- [ ] Pasco/Sumter/Lake parcel loads (all free + verified URLs in doc)
- [ ] 5 acquisition emails/requests pending Rob's go: HCPA CAMA permit table (~$125), Pasco county Accela extract, Lake PA BPE permits file (eric.bjorn@lcpafl.org), Sumter NextRequest, Wildwood JustFOIA
- [ ] Gap-fill (later): Hillsborough unincorporated + Temple Terrace + Plant City, Pasco's 4 cities, Leesburg/Fruitland Park/Lady Lake, Marion post-Nov-2025 (Tyler Civic Access)

## Gated Communities (plan: .claude/plans/feature-gated-communities.md)

- [x] Phase 1 — Schema + pipeline: migration 0008 (gated_areas + staging + DBSCAN/buffer/tier RPC), build-gated-areas.ts (Orange/Volusia county private-road layers, Seminole OSM fallback, Overpass gates). 435 suggested areas: Orange 108H/43M, Seminole 181H/20M, Volusia 58H/25M; Heathrow verifies high (2026-06-11)
- [x] Phase 2 — Map overlay + toggle: /api/gated-areas (bbox GeoJSON), lib/gated-overlay.ts (purple fill by confidence under dot layers, confirmed border), sidebar Overlays toggle. Verified in-browser: Heathrow + Spruce Creek Fly-In shaded, toggle hides, dot click-through intact, console clean (2026-06-11)
- [x] Phase 3 — Admin confirm/clear: /admin/gated (county/status filters, inline rename, confidence/status badges, Confirm/Clear/Re-suggest), PATCH /api/gated-areas/[id]. Verified: curl round-trip + live badge flip on 435-row list (2026-06-11)

## Backlog (not yet planned)

- [ ] Rep-facing app (Supabase Auth roles, assigned-routes-only view, offline tolerance, geostamped knocks)
- [ ] Pin-type icons on map markers; suggested tags by usage; per-rep daily knock goals
- [x] Records requests SENT to 30 jurisdictions (2026-06-10; log: data/records-send-log.json). Pending: 3 flagged (South Daytona, Oak Hill, Maitland — verify email by phone, then `npm run records -- --send --include-flagged`), 4 portal-only (Deltona, Port Orange, Bay Lake, LBV) + Windermere by hand
- [ ] As extracts arrive: data/inbox/<slug>/ → ingest config → `npm run ingest:file`; track fee quotes/replies in rob@roofsonar.com
- [x] Orange address points loaded (688,698 after CSV repair) + geocode join: Orlando 9%→96.8% geocoded (58,284/60,216), 56,298 with DOR use codes for the property-type filter (2026-06-10)
- [x] Seminole address points: 152k SCPA parcels staged (lat/lng + DORCode) + geocode join — Winter Springs 10,015/10,422 geocoded (96.1%), all with use codes (2026-06-10)
- [ ] Volusia address points: CAMA DB has no coords — need county GIS address layer before/with the CAMA permit ingest
- [ ] County-PA permit shortcuts discovered 2026-06-10: Volusia VCPA weekly CAMA Access DB has ALL-city permits (985k, ~107k roof; file in data/inbox/volusia-cama/) — build ingest; Orange has no PA shortcut (FastTrack captcha-gated, no GIS layer)
- [x] SCPA custom data request SENT 2026-06-10 via scpafl.org contact form → data@scpafl.org (notification 37934; 10 business days, possible fees): county-wide CAMA permit table, all 8 Seminole jurisdictions. Tracked as slug scpa-seminole in send log + recipients.json
- [ ] NAL owner-roll load (occupancy + building sqft → roofing squares)
- [~] Roof-age permit coverage (TOP priority — actual re-roof date per property). Structural ceiling: a property only has a re-roof date if it pulled a permit, so per-county max is ~30-70% (Volusia/Marion verified at ceiling); unpermitted homes keep the year_built proxy (migration 0015). Overall real-roof-date coverage 24.1%→27.4% this pass.
  - [x] apply_roof_permits parcel match made separator-insensitive (migration 0017) + functional index (0018); apply routed via Management API for large counties (lib/sql applyRoofPermits). Unblocked Sumter (mixed clean/dashed parcels) and Hillsborough (506k, PostgREST 8s timeout).
  - [x] Tampa/Hillsborough via CivicData CKAN (scripts/ingest-tampa-permits.ts): free daily API, PIN→STRAP→FOLIO map from HCPA dbf, PermitTypeMapped=Roof, all 11 date-range resources 2004→present. 75,222 roof permits, Hillsborough 0→12.2% (Tampa city). `--recent` = weekly refresh.
  - [x] Sumter CitizenServe 2024-2026 roofing permits ingested (9.4%; pre-2024 = legacy system — records request #26-13443 confirmed no bulk pre-2024 export exists, archive is address-search only). Winter Garden (Orange) BP412L PDFs ingested (scripts/ingest-winter-garden-permits.ts, 9,153; Orange 15→16.5%).
  - [x] Pasco re-roof permits ingested from records release #8752 (Accela CSV exports, scripts/ingest-pasco-permits.ts): 9,974 rows applied → Pasco 0→4.3%. PARTIAL — residential + res-comm exports Accela-capped at 5,000 rows; uncapped re-request pending to fill 2021-2025 residential history.
  - [ ] Gap counties still 0%/thin (need records requests already sent 2026-06-11, no replies yet): Hillsborough unincorp + Temple Terrace/Plant City (HCPA CAMA, martinezm@hcpafl.org), Lake (BPE extract eric.bjorn@lcpafl.org). Winter Garden 2026 Energov slice = situs-match follow-up (no parcel column). Wildwood.
  - [ ] Automation: schedule the bulk/API adapters weekly (Pinellas nightly RP_PERMITS, Volusia weekly CAMA, Tampa --recent daily/weekly, Orlando Socrata) via the GitHub Actions cron (still ON HOLD per Rob — needs repo secrets).
- [x] Footprint-based roofing squares (migration 0016): measure roof plan area from FEMA USA Structures building footprints — point-in-polygon, nearest-15m, then mutual-nearest 15-50m — instead of living-area×slope, which ran 20-40% low vs Planimeter (validated against 10 hand-measured homes; footprint ±2-11%, living-area ~33% off; gross building area was never the right field — the roof needs the footprint, not living area or all-floors gross). scripts/apply-footprint-squares.ts tile-parallel-downloads footprints per county; modal shows "· aerial" when footprint-sourced. Applied to all 9 counties (2026-06-12): ~2.03M properties measured. No regression (unmatched keep living-area).
  - [x] Mutual-nearest rural fix: homes whose parcel-centroid geocode sits 15-50m from the roof now match the nearest footprint, but only if the property is also that building's nearest geocode (a neighbor's own geocode claims the neighbor's house — no wrong grabs). Validated == parcel-polygon at ~10% of the cost (no per-county parcel-layer download). Coverage lift: Marion 51→67%, Lake 69→76%, Hillsborough 82→88%, Seminole 85→91%, Sumter 74→79%, Pinellas 91→94%, Pasco 91→93%, Orange 91→92%, Volusia 87→88% (~+109k homes). Residual "none" = USA Structures footprint gaps (e.g. Belleview) + vacant lots + homes >50m from any building.
- [x] Vercel deploy — live at roof-sonar.vercel.app, project robs-projects-c72886ba/roof-sonar (2026-06-10)
- [x] Point roofsonar.com at the Vercel project — live, www-primary; fixed proxied records + stale apex A in Cloudflare (2026-06-10)
- [ ] Set GitHub Actions repo secrets so the monthly ingest cron runs (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SOCRATA_APP_TOKEN) — ON HOLD per Rob
- [ ] DNS/security hardening pass after records requests are sent (Rob): wildcard *.roofsonar.com → unknown GCP IP, DMARC none→quarantine, drop stale SPF `a` mechanism, review Cloudflare proxy strategy
