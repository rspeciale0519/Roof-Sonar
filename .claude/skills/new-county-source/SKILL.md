---
name: new-county-source
description: Scaffold a new FL county permit adapter (bulk ingester or per-parcel scraper) following RoofRadar's established patterns, with a join-key verification checklist. Use when onboarding permit re-roof data for a new county or municipality.
disable-model-invocation: true
---

# New County Permit Source

Scaffolds a county permit adapter consistent with the existing `scripts/ingest-*.ts` / `scripts/scrape-*.ts`, and walks the join-key verification that prevents the bulk-apply bugs we've hit before. Roof age is the #1 data point — get the key right before applying anything.

## Steps

### 1. Gather source facts (ask the user if unknown)
- County / municipality name (must match `jurisdictions.county`).
- Source type: **bulk feed** (CKAN / Socrata / nightly file → `ingest-*.ts`) or **per-parcel API** (resumable → `scrape-*.ts`).
- Source URL(s) / resource IDs.
- The source's parcel/permit key field and how it relates to our property key for that county:
  - Volusia/Seminole → parcel, Orange/Pinellas → situs, Hillsborough → FOLIO (Tampa CivicData PIN = STRAP, needs `hcpa_parcel_map`).
  - Note dashed vs clean parcel formats.
- The roof-permit identifier (PermitType / description value), and how to exclude rooftop HVAC and solar.

### 2. Verify the join key BEFORE writing the apply path
- Pull a sample (~200) of source keys and compare against `properties.parcel_number` (or situs) for that county.
- Normalize both sides: `upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g'))`.
- Require high overlap (~90%+ = correct key; single digits = wrong field — find the right one, e.g. Winter Garden's section-first dashed parcel, not the census number).

### 3. Scaffold from the closest existing adapter
- **Bulk feed** → copy the shape of `scripts/ingest-tampa-permits.ts` (paged fetch, `norm`, `toISO`, server-side roof filter, batched `applyRoofPermits`).
- **Per-parcel** → copy `scripts/scrape-hillsborough-permits.ts` (DB cursor via `nextChunk`, concurrency `pool`, `markScraped`, DB-resident progress — NO local files).
- Reuse helpers: `applyRoofPermits` / `sql` from `scripts/lib/sql.ts`, `sinceArg` / `parseSince` from `scripts/lib/since.ts`.

### 4. Required invariants (do not skip)
- Apply via `applyRoofPermits(county, rows)` only (advance-only roof_year).
- Large reads/writes through the Management API helper, never the PostgREST client (1000-row cap, 8s timeout).
- Add `--since` support for cron refresh.
- Roof filter matches real re-roofs and EXCLUDES rooftop HVAC/RTU/roof drains and solar.
- `toISO` rejects implausible years and handles the source's date format(s).
- Keep the file under 450 LOC.

### 5. Wire automation (only if it should refresh)
- Cloud-reachable feed → add a step to `.github/workflows/weekly-permits.yml` (with `--since 90d`).
- Per-parcel scrape → model on `.github/workflows/hillsborough-scrape.yml` (daily DB-resumable chunk).
- Anything needing local files / Windows drivers (e.g. Volusia Access DB) stays manual — note it explicitly.

### 6. Hand off to review
Run the `county-adapter-reviewer` subagent on the new file before any production apply.
