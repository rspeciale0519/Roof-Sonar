# Phase 0 Discovery — Jurisdiction Portal Viability

> **Status: partially complete — environment-limited.** This build session ran in a
> sandbox whose network allowlist blocks government hosts (every `*.gov`/`*.net`
> county endpoint returned `403 Host not in allowlist`), and no chrome-devtools
> MCP browser was attached. So the in-browser Network-tab discovery the PRD calls
> for could **not** be executed here. What follows is (a) findings verified via web
> search, (b) prior-knowledge leads marked UNVERIFIED, and (c) the exact runbook to
> finish discovery from a normal machine. **No scrapers have been written** — per
> the PRD, scrapers come only after a portal is confirmed viable.

## Verified findings (web search, June 2026)

| Jurisdiction | Finding | Implication |
|---|---|---|
| City of Orlando | Socrata SODA dataset `ryhf-m453` (per PRD, verified endpoint) | `api` adapter built: `scripts/ingest-orlando.ts` |
| Volusia Co. (unincorp.) | ArcGIS REST `maps5.vcgov.org/.../CurrentProjects/MapServer/1` — AMANDA OPEN permits (per PRD) | `api` adapter built: `scripts/ingest-volusia-api.ts` — run `--verify-vocab` first |
| Orange Co. (unincorp.) | Live portal is **fasttrack.ocfl.net/OnlineServices** (ASP.NET `.aspx` pages, public permit search without an account). The PRD's `fast.ocfl.net` appears to redirect/alias to this. The `.aspx` WebForms look suggests a **custom portal, not hosted Accela Citizen Access** — the "Accela-based" claim needs in-browser confirmation. | Strong candidate for date-range scrape OR hidden XHR endpoints; check Network tab. |
| Accela Civic Data API | Accela's **Construct API** (developer.accela.com) is alive, but it is an *agency-scoped* API: you register an app and need the agency to expose data; the old open-data portal (CivicData.com) is largely stale. | Don't count on it for Orange County. Test once: register a free developer app, try agency name `ORANGECO`-style identifiers; if the agency isn't published, fall back to scrape/records request. |
| Seminole Co. (unincorp.) | "Building Permits Online" is the county's own portal; plan review moved to **ePlan/ProjectDox** (mandatory Dec 2025, legacy "EZ Permit" retired). Permit *search* remains on Building Permits Online. | Portal exists with public status lookup — check for date-range search + XHR JSON in Network tab. |
| Daytona Beach | Uses **iMS (Intuitive Municipal Services)** for permit & licensing search (daytonabeach.gov/1140). | iMS portals typically have JSON XHR backends — good Network-tab candidate. |
| Volusia Co. Property Appraiser | vcpa.vcgov.org exposes per-parcel "Links to Permit information" pages. | Possible cross-check/backfill aid, parcel-keyed. |

## Leads from prior knowledge — UNVERIFIED, confirm in browser

| Jurisdiction | Lead |
|---|---|
| Port Orange | City runs its own permit-status lookup (port-orange.org/798); platform unknown. |
| Deltona | Building Services pages on CivicPlus CMS; permit system behind it unknown. |
| Winter Park, Apopka, Ocoee, Winter Garden, Maitland | Mid-size Orange cities commonly run Tyler EnerGov "Self-Service (CSS)" or CitizenServe; each CSS instance exposes a JSON API (`/EnerGov_Prod/SelfService#/search` → XHR to `/api/energov/search/search`). Identify per city. |
| Sanford, Oviedo, Lake Mary, Altamonte Springs, Casselberry, Longwood, Winter Springs | Mixed; at least some use MyGovernmentOnline (MGO) or CitizenServe. MGO has a documented public API used by its own portal. |
| Small Volusia towns (Ponce Inlet, Lake Helen, Oak Hill, Pierson, etc.) | Likely paper/clerk workflows → records request is the realistic path. |
| Bay Lake / Lake Buena Vista | Disney-controlled; building authority historically via Reedy Creek/CFTOD. Request data for completeness, lowest priority. |

## Runbook to finish Phase 0 (per jurisdiction, ~10 min each, stop at first success)

1. Open the permit portal in Chrome with chrome-devtools-mcp (or plain DevTools).
2. Run a permit search (any roofing permit, small date range). Watch the **Network tab → Fetch/XHR**:
   - JSON responses with permit arrays ⇒ **API-viable**: record URL, params, auth/cookies, pagination. Adapter = `api`/`scrape` hybrid hitting the XHR directly.
   - HTML-only responses but a **date-range search form** ⇒ **scrape-viable** (Playwright): record form fields + result table shape.
3. Check the city site for published **monthly "permits issued" reports** (CSV/XLSX/PDF) ⇒ **report-viable**: wire into the file adapter (`ingest/configs/<slug>.json`).
4. Nothing? The **records request** (already drafted in `docs/records-requests/drafts/`) is the path — it was sent day 1 regardless.
5. Log the verdict in the table below; only then write a scraper.

### Specific tests queued for Orange County

- `fasttrack.ocfl.net/OnlineServices` permit search → Network tab for `.asmx`/`.ashx`/`api` XHR endpoints; check for a date-range "reports" page.
- Accela Construct API: create a free app at developer.accela.com, attempt agency discovery for Orange County FL; document result either way.

## Verdict tracker

| Jurisdiction | Verdict (api / scrape / report / file-only) | Endpoint / notes | Date |
|---|---|---|---|
| orlando | api (Socrata) — DONE | `ryhf-m453.json` | 2026-06 |
| volusia-county | api (ArcGIS, open permits only) — DONE | `CurrentProjects/MapServer/1` | 2026-06 |
| _all others_ | pending in-browser discovery | | |
