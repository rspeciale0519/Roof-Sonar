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
- [x] Vercel deploy — live at roof-sonar.vercel.app, project robs-projects-c72886ba/roof-sonar (2026-06-10)
- [x] Point roofsonar.com at the Vercel project — live, www-primary; fixed proxied records + stale apex A in Cloudflare (2026-06-10)
- [ ] Set GitHub Actions repo secrets so the monthly ingest cron runs (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SOCRATA_APP_TOKEN) — ON HOLD per Rob
- [ ] DNS/security hardening pass after records requests are sent (Rob): wildcard *.roofsonar.com → unknown GCP IP, DMARC none→quarantine, drop stale SPF `a` mechanism, review Cloudflare proxy strategy
