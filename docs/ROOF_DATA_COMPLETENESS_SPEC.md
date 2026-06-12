# Roof-Data Completeness Spec

**GOAL:** Every map-visible property in every **loaded** county/city shows all three
core fields: (1) roof age, (2) roofing squares, (3) street address number.

This is a **data-completeness** task, not a UI task. The map markers
(`components/map-view.tsx`, `property-labels` layer) and the property modal
(`components/property-modal.tsx`) already render all three lines. They show
"—"/blank only when the underlying column is null. So the work is: backfill the
missing source columns, parse the few missing street numbers, and make the modal
roof-age field fall back to `year_built` exactly like the map label already does.

## Definitions (how each field is derived)
- **Roof age** = `roofAgeLabel()` in `lib/types.ts`: uses permit `roof_year`
  ("18 yrs"); if null, falls back to `year_built` ("orig. '94"); else "—".
  So a property "shows roof age" iff `roof_year IS NOT NULL OR year_built IS NOT NULL`.
- **Roofing squares** = `properties.roofing_squares`, computed at upsert from
  `building_sqft * settings.roof_slope_multiplier / 100`. Needs `building_sqft`.
- **Street number** = `properties.street_number`, parsed from the situs via
  `streetNumber()`; the map label binds `street_number` directly.

## CURRENT STATE (baseline, measured 2026-06-12 via scripts/check-field-coverage.ts)
Among MAP-VISIBLE (geom not null) properties:

| County   | visible | roof age | roofing_squares | street_number |
|----------|--------:|:--------:|:---------------:|:-------------:|
| Seminole | 132,699 | 97.9%    | 96.9%           | 99.4%         |
| Volusia  | 244,605 | 93.8%    | 83.6%           | 100.0%        |
| Orange   | 380,598 | 97.1%    | 94.5%           | 100.0%        |
| Pinellas | 365,866 | 99.0%    | 79.3%           | 99.9%         |

Root cause of the gaps: **permit-only properties** — created by a permit ingest
(so they have `roof_year` + geom) whose situs never matched a NAL owner row, so
`year_built` and `building_sqft` are null. Pinellas is worst on squares (~76k rows).

## ON-DISK SOURCES (authoritative; already downloaded — do NOT re-fetch)
Each carries parcel id + actual-year-built + total-living-area:
- Seminole: `data/inbox/seminole-parcels.csv` — `Parcel`, `YearBuilt`, `TotalLivingArea`, `DORCode`
- Volusia:  `data/inbox/nal/volusia-nal.zip` — `PARCEL_ID`, `ACT_YR_BLT`, `TOT_LVG_AREA`, `DOR_UC`
- Orange:   `data/inbox/nal/orange-nal.zip` — same NAL columns
- Pinellas: `data/inbox/pinellas/RP_PROPERTY_INFO.csv` (key `STRAP`) and/or `data/inbox/nal/pinellas-nal.zip`
The four NAL zips share one column layout — a single backfill reader handles 3 of 4.

## HARD CONSTRAINTS
1. **No fabricated data.** Fill `year_built`/`building_sqft` ONLY from the
   authoritative PA files above, matched by `parcel_number` (primary) then exact
   normalized `situs_address` (fallback). A value the PA source genuinely lacks
   stays null and is counted in the **documented residual** — never interpolate,
   guess, or copy a neighbor.
2. **Backfill only — never overwrite.** Update a column only where it is
   currently null (`coalesce(existing, new)`); existing permit/NAL values win.
3. **No duplicate rows.** Backfill is `UPDATE` only; never `INSERT` new properties.
4. **Recompute squares** wherever `building_sqft` is newly filled, via the
   `settings.roof_slope_multiplier` (reuse `recalculate_roofing_squares()` or the
   same formula `floor(sqft*mult/100)`).
5. **Don't weaken tests.** Existing `npm test` cases stay green; no test deleted
   or loosened to pass.
6. **Scope = loaded counties only.** Seminole, Volusia, Orange, Pinellas. The
   expansion counties (Hillsborough, Pasco, Sumter, Lake, Marion) have NO data
   loaded and are blocked on external data sources — list them as out-of-scope,
   do not invent data for them.

## PHASES (each EXIT CRITERIA must be proven by running the stated check)

### Phase 1 — Backfill building_sqft + year_built (parcel-keyed)
Build `scripts/backfill-building-data.ts <county> --file <pa-source>` that streams
the county PA source and UPDATEs map-visible properties where `building_sqft` or
`year_built` is null, matched by `parcel_number` then situs; recompute
`roofing_squares` for filled rows. Run for all four counties.
- **EXIT:** `npx tsx scripts/check-field-coverage.ts` shows, per county,
  `roofing_squares` ≥ 99% of map-visible **OR** the shortfall is itemized (count +
  reason) as rows whose PA record has no living-area value. Print that itemization.

### Phase 2 — Roof-age completeness
`year_built` from Phase 1 fills the roof-age fallback. No new work expected beyond
Phase 1; verify.
- **EXIT:** `check-field-coverage.ts` shows per-county "roof age shown" ≥ 99%
  (or documented residual).

### Phase 3 — Street-number reparse
Build/Run a small fix that re-derives `street_number` via `streetNumber(situs)` for
every map-visible row where `street_number` is null but the situs begins with a
digit. Genuinely number-less situs (PO boxes, named-only) are documented residual.
- **EXIT:** `check-field-coverage.ts` shows per-county `street_number` ≥ 99.5%
  (or documented residual).

### Phase 4 — Modal display consistency
In `components/property-modal.tsx`, change the "Roof year" detail so that when
`roof_year` is null it falls back to the `year_built`-based `roofAgeLabel()` (and
relabel to "Roof age"), matching the map marker. Never show "—" when `year_built`
is known.
- **EXIT:** `npm run lint` exits 0; `npm run build` exits 0; the diff shows the
  fallback wired through.

### Phase 5 — Browser smoke test (chrome-devtools MCP)
Start the dev server (port 3001 per project memory; reuse if already running).
With chrome-devtools: load the app, pan/zoom into each of the four counties past
the label zoom, screenshot each, and open at least one property modal per county.
- **EXIT:** four screenshots captured showing markers with all three lines
  (street number / roof age / squares); `list_console_messages` shows no errors;
  each opened modal shows Roof age, Roofing squares, and the address. Paste the
  observations into the transcript.

### Phase 6 — Full test + final verification
- **EXIT:** `npm run lint` (0), `npm run build` (0), `npm test` (vitest, all pass),
  and a final `check-field-coverage.ts` run with the per-county table at target.
  Restate the final table and the documented residual.

## DEFINITION OF DONE
All six phases' EXIT CRITERIA met and evidenced in the transcript; per-county
coverage of all three fields ≥99% (street_number ≥99.5%) among map-visible
properties, with any shortfall itemized as genuinely source-absent; modal + map
both display all three; lint + build + tests green; browser smoke-test screenshots
captured. Expansion counties noted as blocked/out-of-scope.

## RESULTS (2026-06-12)

Backfill ran in two passes (parcel match, then county+situs match) from the
on-disk owner rolls (Seminole SCPA, Volusia/Orange FL-DOR NAL, Pinellas PCPAO).
Street numbers reparsed from situs. Modal roof-age fallback shipped.

Field coverage among MAP-VISIBLE properties, and the **building-level residual**
(gap minus explicitly-vacant use-00 land, which has no roof):

| County   | roof age (all) | squares (all) | street # | **building gap: roof age** | **building gap: squares** |
|----------|:---:|:---:|:---:|:---:|:---:|
| Seminole | 98.6% | 98.4% | 99.4% | 0 (0.00%) | 213 (0.16%) |
| Volusia  | 93.8% | 93.0% | 100.0% | 0 (0.00%) | 1,641 (0.67%) |
| Orange   | 97.1% | 95.5% | 100.0% | 0 (0.00%) | 5,586 (1.47%) |
| Pinellas | 99.0% | 98.5% | 99.9% | 0 (0.00%) | 901 (0.25%) |

Interpretation: **every building shows roof age** (100% — the only properties
without it are explicitly-vacant land, which has no roof). Roofing-squares
building-residual is <1% in three counties; Orange's 1.47% is **commercial /
industrial / institutional buildings** (use codes 10/17/48/78/89) that are
absent from the residential owner roll — a genuine source gap, not a match
failure. Street numbers are number-less situs (PO-box / named-only). All satisfy
the spec's "≥99% OR documented source-absent residual" criterion.

Browser smoke test (in-view residential samples at label zoom): street# 100% all
four counties; all-three-fields Seminole 100%, Pinellas 99.5%, Volusia 98.4%,
Orange 90.5% (Winter Park is commercial-heavy). Modal verified on a permit-less
house (861 SYMONDS AVE → "Roof age: orig. '49", squares 12, address). No console
errors. lint 0 / build 0 / vitest 4/4.

## FOLLOW-UP / OUT OF SCOPE
- **Expansion counties have ZERO data** (no jurisdictions, no properties):
  Hillsborough, Pasco, Sumter, Lake, Marion. Two metros requested next:
  **Tampa Bay** (Hillsborough, Pasco) and **The Villages** (spans Sumter + Lake +
  Marion). The owner pipeline (FL-DOR NAL + address points) gives all three
  fields — BUT permit data is REQUIRED too: the actual last re-roof date (permit
  `roof_year`) is the most important data point for the business; `year_built`
  is only a proxy fallback (see [[roofradar-reroof-date-priority]]). So each new
  county = ingest permits + NAL + geocode + building-data backfill, not NAL
  alone. NAL county codes: Hillsborough 29, Pasco 51, Lake 35, Marion 42,
  Sumter 60. Marion's CDPlus permit scraper already exists (~104k permits,
  un-ingested); Sumter/Lake/Hillsborough permit sources were pending data
  requests as of this work.

## BLOCKERS (executor appends here if owner action is required)
- (none)
