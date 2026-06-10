# Data Sources — Tampa Bay & The Villages Expansion

> Researched 2026-06-10 by four parallel agents using the playbook proven in Central FL
> (check the county Property Appraiser FIRST — they often aggregate permits from all
> jurisdictions). Every claim below was marked VERIFIED (fetched/downloaded/parsed) or
> REPORTED by the researching agent; this doc keeps that distinction.
> Sample downloads live in `docs/temp/pinellas/`, `docs/temp/hillsborough/`, `docs/temp/`
> (Lake/Marion files) and `archive/temp-pasco-research/`.

## Scoreboard

| County | Parcels (addr/owner/use/lat-lng) | Permits — bulk path | Effort |
|---|---|---|---|
| **Pinellas** | PA nightly CSVs + label-point shapefile (VERIFIED) | **PA nightly `RP_PERMITS` CSV: 1.64M permits, 424,660 ROOF-typed, all 24 jurisdictions, 1997→present (VERIFIED end-to-end)** | None — build ingest |
| **Hillsborough** | PA weekly shapefile (531k parcels, 55 attrs) + `LatLon_Table` folio→lat/lng (VERIFIED) | Tampa: CivicData CKAN bulk 2004→present (VERIFIED). County+cities full history: HCPA CAMA permit-table custom request (~$125) + records request to county | 2 emails |
| **Pasco** | PA weekly FTP files + county address-points layer w/ lat/lng (VERIFIED) | No PA permits. County Accela ("PascoGateway") holds unincorporated (most rooftops), history ≥2004; records request for extract; scriptable per-parcel GET fallback (VERIFIED) | 1 request + 4 small cities |
| **Sumter** (Villages core) | County AGOL `Parcels_gdb` FeatureServer — situs/owner/mailing/DOR_LUC/AYB/EYB/sqft/**lat-lng** in one layer (VERIFIED) | No public permits. NextRequest to county (Citizenserve reports prove export exists) + JustFOIA to Wildwood (CivicGov) | 2 requests |
| **Lake** (Lady Lake etc.) | PA monthly FTP CSVs (Bldg incl **ROOF_COVER**, Situs, NAL) + GeoHub Tax Parcels geometry, AltKey join (VERIFIED) | PA documents a **Permits (BPE_*) extract** — layout published, file absent from FTP. Email Eric Bjorn (below). Highest-leverage email of the batch | 1 email |
| **Marion** (newest Villages) | PA daily `MCPA_Data.ZIP` (~531k... 92-col per-parcel CSV) — no lat/lng (use FGIO statewide parcels) (VERIFIED) | **Legacy CDPlus permit search scriptable via plain HTTP POST: 1995→Nov 2025 incl. re-roof type codes (VERIFIED live)**; post-Nov-2025 via Tyler Civic Access / records request | Scrape + 1 request |

---

## Pinellas — fully solved, zero requests

- Downloads page: `https://www.pcpao.gov/tools-data/data-downloads/raw-database-files`. Mechanism (no auth):
  `POST https://www.pcpao.gov/dal/databasefile/downloadDatabaseFile` body `hdn_tbl_name=<TABLE>&hdn_ftype=csv` → `<TABLE>_csv.zip`. Nightly refresh.
- **`RP_PERMITS`** (44MB zip → 216MB CSV, VERIFIED): `STRAP, PARCEL_NUMBER, PERMIT_NUMBER, PERMIT_TYPE, PERMIT_DSCR, AGENCY_ID, AGENCY_NAME, ISSUE_DT, SIGN_OFF_DT, EST_VAL, PERMIT_YEAR`. 1,640,153 rows; **424,660 with PERMIT_TYPE=96 / DSCR='ROOF'**; all 24 jurisdictions (County 477k, St Pete 421k, Clearwater 180k…); solid 1997→present. Use `ISSUE_DT` (not PERMIT_YEAR); treat `1899-12-30` as null.
- **`RP_PROPERTY_INFO`**: STRAP, situs, owner1/2, mailing, `LAND_USE_CD` (2-digit DOR), YEAR_BUILT, living/gross sqft, values. Also `RP_BUILDING`, `RP_ALL_SITE_ADDRESSES`, `RP_ALL_OWNERS`, `RP_SALES_HISTORY`.
- **Lat/lng**: `POST https://www.pcpao.gov/dal/shapefile/downloadParcelLabel` → `Parcel_Label_Point.zip` (EPSG:2882 → reproject to WGS84; join STRAP).
- Parcel pages (`https://www.pcpao.gov/property-details?s=<STRAP>`) show the same permits (cross-check verified). PA records liaison: Alex Luca, (727) 464-3207.
- County GovQA (building services listed): `https://pinellas.govqa.us/WEBAPP/_rs/supporthome.aspx` — only if pre-1997 ever matters.

## Hillsborough

- **Parcels**: `https://downloads.hcpafl.org/` — weekly; ASP.NET postback downloads (script: GET `/`, extract `__VIEWSTATE`/`__EVENTVALIDATION`, POST `__EVENTTARGET=grdFiles$ctl00$ctlNN$ctl00`; rows alphabetical from ctl04 step +2). Key files: `HCparcel_4_public_*.zip` (531,113 parcels: FOLIO/PIN/STRAP, owner+mailing, SITE_ADDR, DOR_CODE, ACT/EFF year built, HEAT_AR, MUNI flag A/U/T/P, sales, values) and `LatLon_Table_*.zip` (540,780 FOLIO→lat/lon rows).
- **HCPA aggregates permits county-wide** (disclaimer: "Permit information is received from the County and Cities") — visible per parcel via `https://gis.hcpafl.org/CommonServices/property/search/ParcelData?pin=<10-digit folio>` → `permitInfo[]` (UNSTABLE under load — spot checks only, not a scrape path). **No public bulk permits file** → custom-data request to **Marilyn Martinez, martinezm@hcpafl.org, 813-276-8810** (MAF custom extracts, ~$125 media fee) for the CAMA permit table.
- **Tampa permits SOLVED free**: CivicData CKAN (BLDS schema), 11 resources covering ~2004→present, current file updates daily (112,098 rows for 2023→present; `Residential Roof Trade Permit` = 17,556 + commercial 2,225 in that slice alone). API `https://www.civicdata.com/api/3/action/datastore_search?resource_id=<id>` (+ `datastore_search_sql`, CSV `/datastore/dump/<id>`; needs browser UA). **PIN = HCPA STRAP** (join verified). Prior-to-2010 archive resource `52f396e9…` reaches back to ≈2004.
- **Unincorporated county**: HillsGovHub (Accela `HCFL`) 01/2021→present, search-only; legacy 2005–01/2021 at `https://app.hillsboroughcounty.org/DevelopmentServices/PermitReports` (queryable, 1,000-row cap, no export). Records request → **Permitting@HCFL.gov** for CSV of both systems.
- **Temple Terrace** (Click2Gov): PublicRecordsRequests@templeterrace.gov. **Plant City** (MaintStar): bldgemail@plantcitygov.com. Both small.
- County AGOL: `Site_Address_Point/FeatureServer/0` = 750,811 address points (STRAP/FOLIO/FULLADDR/MUNICIPALITY) — backup address layer. The `AccelaDashBoard` layer has zero roof-trade permits (new construction/CO only).

## Pasco

- **Parcels**: `https://downloads.pascopa.com/` → `https://ftp01.pascopa.com/real_estate/` weekly: `parcel_summary.zip` (use code, actual+effective year built, living area, owner+mailing, site address, JURISDICTION_NAME, pool), `building.zip` (**Bldg_Roof_Cover_Desc** — shingle/tile/metal, Bldg_Eff vs Act YrBlt), `owners.zip`, `site_addresses.zip`. Historic NAL rolls 1998–2025 at `/historic/real_estate/`. Schema PDFs at `downloads.pascopa.com/metadata/<name>.pdf`. **No permits table (verified by listing the FTP + reading every schema); no permits on parcel pages.**
- **Lat/lng**: "PascoMapper Addresses" — REST `https://services6.arcgis.com/Mo4MddfRHpFwT7UF/arcgis/rest/services/PascoMapper_Addresses/FeatureServer/16`; CSV download `https://data-pascocounty.opendata.arcgis.com/api/download/v1/items/273eed36df7c4e8d95b49a1d20732dd7/csv?layers=16`. Fields: PARCEL_NUMBER, FULL_ADDRESS, LATITUDE, LONGITUDE, JURISDICTION.
- **Permits**: county Accela "PascoGateway" covers unincorporated (Wesley Chapel, Land O' Lakes, Hudson, Trinity = most rooftops); record types include "Residential Re-Roof"; history ≥2004 (verified on two test parcels, incl. legacy migrated numbering). **Bulk = records request** via `https://pascocountyprrfl.qscend.com/311` / **prr@mypasco.net** (PRR mgr Courtney Cooper, ccooper@mypasco.net) — ask for Accela extract of roof/re-roof record types 2000→present with parcel, address, dates, status. **Scriptable fallback (verified)**: `GET https://aca-prod.accela.com/PASCO/Cap/GlobalSearchResults.aspx?QueryText=<DASHED-parcel>` returns all permits for a parcel (use PA's dashed format).
- Cities: New Port Richey (JustFOIA `citynprfl.justfoia.com`; permitting@cityofnewportrichey.org), Port Richey (iWorQ; admin@cityofportrichey.com), Zephyrhills (EnerGov CSS 2018+; pre-2018 self-serve Laserfiche `archives.ci.zephyrhills.fl.us`), Dade City covers San Antonio + St. Leo (iWorQ; buildingpermits@dadecityfl.com).
- PA custom-data email: media@pascopa.com (long-shot ask for internal permit table).

## The Villages (Sumter / Lake / Marion)

**Jurisdiction map**: Lady Lake (Lake) = Citizenserve #383 · Fruitland Park (Lake) = BS&A · Leesburg (Lake) = Click2Gov/OPRS · unincorporated Lake = county Building Services · unincorporated Sumter = Citizenserve #445 · Wildwood (Sumter) = CivicGov (most NEW Villages south of SR 44) · unincorporated Marion = CDPlus (hist.) + Tyler Civic Access (Nov 2025+). Lake GeoHub "Address Locations" `JurisdictionCity` field assigns any address to its authority.

### Sumter
- **Parcels (free, has lat/lng)**: `https://services8.arcgis.com/FTrtUCmxaVKdPC5e/arcgis/rest/services/Parcels_gdb/FeatureServer/0` — PIN, LATITUDE/LONGITUDE, Site_Addr/City/Zip, Owners_Nam, Mailing_*, DOR_LUC, AYB/EYB, LivingArea (Query+Extract enabled). Address points: `Address_Public/FeatureServer/0`.
- **Permits**: nothing public (PA viewer has no permits section; GIS has no layer; open-data DCAT empty). County Building Services = Citizenserve installation 445 — its portal exposes "Permits Issued by Jurisdiction"/"Issued Permits" reports (need browser session) proving the export is one query away. **Records request via NextRequest `https://sumtercountyfl.nextrequest.com/`** (ask for legacy pre-Citizenserve too). **Wildwood**: CivicGov portal `civicgov4.com/fl_wildwood`; request via JustFOIA `wildwoodfl.justfoia.com` / dsdinfo@wildwood-fl.gov.
- PA records custodian: christine.benitez@sumtercountyfl.gov; GIS: GISHelpdesk@SumterCountyFL.gov. Remaining unknown: whether qPublic parcel pages show permits (bot-blocked — check once in a real browser).

### Lake
- **Parcels (free monthly FTP)**: `https://c.lakecountyfl.gov/ftp/PA_office/data/` — `Bldg` (ROOF_COVER + DESC, ACTUAL/EFFECTIVE_YEAR_BUILT, areas, beds/baths), `Situs_Addr` (217k), `NALExtractPublic` (owner/mailing/use codes), `Sales`, layout docs alongside. Join AltKey → **GeoHub Tax Parcels** (`gis.lakecountyfl.gov/lakegis/rest/services/OpenData/OpenData1/FeatureServer/12`, has AltKey + YearBuilt + LandUseCode) for geometry/centroids; "Address Locations" `FeatureServer/11` for JurisdictionCity.
- **Permits — the lead**: PA's own instructions PDF documents a **"Permits" extract** (BPE_PERMIT_ID, BPE_PID, BPE_APP_DATE, BPE_ISSUE_DATE, BPE_TYPE, BPE_AMOUNT, BPE_COMPANY, BPE_DESC, BPE_STATUS, BPE_DATE_COMPLETE) **absent from the current FTP**. **Email Eric Bjorn — eric.bjorn@lcpafl.org** for it (PA "no longer accepts custom data requests," but this is a documented standard file, not custom). Parcel pages show NO permits (verified on a real Lady Lake Villages home), so the bulk file is the only PA path.
- Fallbacks per authority: Lady Lake NextRequest `ladylakefl.nextrequest.com` (Citizenserve 383 export); unincorporated Lake `permits_issued.aspx` report tool (type codes RFR/RF/ROR; browser session needed) or JustFOIA `lakecountyfl.justfoia.com`; Leesburg records request (Click2Gov no bulk); Fruitland Park permits@fruitlandpark.org (BS&A).

### Marion
- **Parcels (free, ~daily)**: `https://www.pa.marion.fl.us/data/MCPA_Data.ZIP` (39MB → ~160MB CSV, 92 cols: PARCEL, ALT_KEY, PC class, owners, mailing, situs, sale, YRBLT1, sqft, beds/baths/pool). Layout xlsx inside zip. No lat/lng → FGIO statewide parcels (`geodata.floridagio.gov`) or PA paid shapefile (mcpa@pa.marion.fl.us). NOTE: domain is **pa.marion.fl.us** (pa.marioncounty.org doesn't resolve).
- **Permits 1995→Nov 2025 (free, scriptable — verified live)**: `https://bcc.marionfl.org/cdplus/` Permitting Inquiry; plain HTTP POSTs; `SearchType=D` (date windows) or `SearchType=T` with roof codes **R23ROF / R18ROF / R074** (res re-roof), C23ROF/C18ROF (comm). Returns permit #, status+type, parcel, address, owner, contractor. Frozen at the Nov 2025 Tyler migration.
- **Permits Nov 2025+**: Tyler Civic Access (`marionfl.org/CivicAccess`, browser-only) and/or records request to Building Safety (352-438-2400) — also ask for a one-time full CDPlus dump as cross-check.

## Statewide fallbacks
- FL DOR Property Data Portal (NAL/NAP/SDF rolls per county; prior years via PTOTechnology@floridarevenue.com) — parcel attributes only, no permits.
- FGIO statewide parcel polygons: `https://geodata.floridagio.gov/` — geometry/centroids where county GIS lacks them (Marion).

## Action plan (in order)

1. **Build Pinellas ingest** — nightly POST for RP_PERMITS + RP_PROPERTY_INFO + label points. Biggest market, zero gatekeepers, verified end-to-end. (424k roof permits waiting.)
2. **Build Hillsborough parcel + Tampa permit ingests** (both free/verified) — covers Tampa proper immediately.
3. **Send 5 emails/requests** (need Rob's go): HCPA permit-table custom request (martinezm@, ~$125) · Pasco county Accela extract (prr@mypasco.net) · Lake PA permits file (eric.bjorn@lcpafl.org) · Sumter NextRequest · Wildwood JustFOIA.
4. **Script Marion CDPlus** roof-permit pull 1995→2025 (free, no permission needed) + Marion/Sumter/Lake/Pasco parcel loads.
5. **Gap-fill later**: Hillsborough unincorporated (Permitting@HCFL.gov), Temple Terrace, Plant City, Pasco's 4 cities, Leesburg/Fruitland Park/Lady Lake — most matter only if the county/PA bulk paths under-deliver.
