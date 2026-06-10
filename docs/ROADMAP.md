# RoofRadar Development Roadmap

## Completed

- [x] MVP: Supabase/PostGIS schema, 4 ingest adapters, Mapbox map with age-bucket labels, routing, CSV/Google Maps exports, password gate (2026-06)
- [x] Remove vulnerable xlsx dependency; file adapter is CSV-only (2026-06-09)
- [x] Verify Orlando Socrata + Volusia ArcGIS adapters against live endpoints; fix Volusia field mapping (FOLDERTYPE='ROOF', FOLDERNAME address, client-side centroids) (2026-06-09)
- [x] Supabase project provisioned: migrations 0001–0002 applied, PostGIS on, RLS on all tables, 39 jurisdictions seeded (2026-06-09)
- [x] Map label fixes: collision-suppressed age line; doubled street number (2026-06-09)
- [x] First live data: Volusia open roof permits (203) + Orlando historical backfill (2026-06-09)

## Canvassing Operations (plan: .claude/plans/feature-canvassing.md)

- [x] Phase 1 — Schema, types, test harness (migrations 0003+0004, vitest, nearestProperty) (2026-06-09)
- [ ] Phase 2 — Reps, pin types, tags: APIs + admin pages
- [ ] Phase 3 — Route assignment + lifecycle (rep, status, DNK hard filter)
- [ ] Phase 4 — Property modal + pin layer (read path)
- [ ] Phase 5 — Pin drop flow (tray, snap, undo)
- [ ] Phase 6 — Knock metrics dashboard

## Backlog (not yet planned)

- [ ] Rep-facing app (Supabase Auth roles, assigned-routes-only view, offline tolerance, geostamped knocks)
- [ ] Pin-type icons on map markers; suggested tags by usage; per-rep daily knock goals
- [ ] Remaining 37 jurisdiction ingests (records requests → file adapter)
- [ ] NAL owner-roll load (occupancy + building sqft → roofing squares)
- [ ] Vercel deploy
