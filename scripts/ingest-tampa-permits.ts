/**
 * Tampa (Hillsborough) re-roof permits from the City of Tampa open data
 * (CivicData CKAN, BLDS schema, daily refresh). Tampa publishes PIN = HCPA
 * STRAP, but our properties are keyed by HCPA FOLIO, so we map PIN→STRAP→FOLIO
 * via the HCPA parcel dbf, then advance roof_year by FOLIO through
 * apply_roof_permits (migration 0017 makes the parcel match separator-safe).
 * Sweeps every date-range resource (Prior-2010 → present) for full roof history.
 *
 *   pwsh scripts/fetch-hillsborough-files.ps1   # needs parcel_4_public.dbf present
 *   npx tsx scripts/ingest-tampa-permits.ts            # full history
 *   npx tsx scripts/ingest-tampa-permits.ts --recent   # only 2023→present (weekly refresh)
 *
 * Covers the City of Tampa only (CivicData is Tampa's feed); unincorporated
 * Hillsborough + Temple Terrace/Plant City need the HCPA records request.
 */
import * as shapefile from "shapefile";
import { applyRoofPermits } from "./lib/sql";
import { sinceArg } from "./lib/since";

let SINCE: string | null = null; // --since: skip permits issued before this (weekly cron)

const DBF = "data/inbox/hillsborough/parcel_4_public.dbf";
const UA = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36" } };
const CKAN = "https://www.civicdata.com/api/3/action/datastore_search";
const PAGE = 1000;
const BATCH = 1000;

// City of Tampa standard-permit resources, newest first (id | label).
const RESOURCES: { id: string; label: string }[] = [
  { id: "64977456-0c60-4d26-aa6e-0f94eed6efea", label: "2023→present" },
  { id: "474844a7-3bd1-4722-bc8b-9ec5a5f82508", label: "2022-2023" },
  { id: "5dccf477-1347-449c-a569-ca7003c3e9ee", label: "2021-2022" },
  { id: "4019843f-abfe-4db1-8d04-caf1ad34d88f", label: "2020-2021" },
  { id: "a90e128a-6220-4db6-8c50-1b8b03fb3637", label: "2019-2020" },
  { id: "3be3d1e9-1525-421d-9a22-4a1a0ff237d8", label: "2018-2019" },
  { id: "2796d4a8-f478-4473-a1b7-eee861acf8e8", label: "2017-2018" },
  { id: "7d62bf58-26e2-493c-983c-01c27be34b34", label: "2015-2017" },
  { id: "410a0307-7bb7-4469-9f1f-a39246638e1c", label: "2012-2015" },
  { id: "e6283f4b-ef87-4e13-897a-08cfc4435b32", label: "2010-2012" },
  { id: "52f396e9-d987-4c6a-9d4d-626329719b21", label: "Prior to 2010" },
];

const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const ROOF = /roof/i;

function toISO(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

async function fetchJson(url: string): Promise<{ result?: { total: number; records: Record<string, unknown>[] } }> {
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(url, UA);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as { result?: { total: number; records: Record<string, unknown>[] } };
    } catch (e) {
      if (a === 4) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (a + 1)));
    }
  }
  return {};
}

async function strapFolioMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const src = await shapefile.openDbf(DBF);
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const v = r.value as { STRAP?: string; FOLIO?: string };
    if (v.STRAP && v.FOLIO) map.set(norm(v.STRAP), String(v.FOLIO).trim());
  }
  console.log(`STRAP→FOLIO map: ${map.size.toLocaleString()} parcels`);
  return map;
}

/** Roof permits from one resource → FOLIO-keyed apply rows. Server-side filter
 *  on PermitTypeMapped=Roof when available, else full-text q=roof + client check. */
async function ingestResource(res: { id: string; label: string }, map: Map<string, string>): Promise<{ roof: number; applied: number; nomap: number }> {
  const filtered = `&filters=${encodeURIComponent(JSON.stringify({ PermitTypeMapped: "Roof" }))}`;
  let useFilter = true;
  let first = await fetchJson(`${CKAN}?resource_id=${res.id}&limit=1${filtered}`);
  if (!first.result || first.result.total === 0) { useFilter = false; first = await fetchJson(`${CKAN}?resource_id=${res.id}&limit=1&q=roof`); }
  const total = first.result?.total ?? 0;
  if (total === 0) { console.log(`  ${res.label}: 0 roof permits`); return { roof: 0, applied: 0, nomap: 0 }; }

  let roof = 0, applied = 0, nomap = 0, offset = 0;
  let batch: { parcel: string; dt: string; num: string | null }[] = [];
  const flush = async () => {
    if (!batch.length) return;
    applied += await applyRoofPermits("Hillsborough", batch);
    batch = [];
  };
  for (; offset < total; offset += PAGE) {
    const url = `${CKAN}?resource_id=${res.id}&limit=${PAGE}&offset=${offset}` + (useFilter ? filtered : "&q=roof");
    const j = await fetchJson(url);
    const recs = j.result?.records ?? [];
    if (!recs.length) break;
    for (const r of recs) {
      const mapped = String(r.PermitTypeMapped ?? "");
      const type = String(r.PermitType ?? "");
      if (!(mapped.toLowerCase() === "roof" || (ROOF.test(type) && /trade|roof/i.test(type)))) continue;
      roof++;
      const folio = map.get(norm(r.PIN));
      if (!folio) { nomap++; continue; }
      const dt = toISO(r.IssuedDate) ?? toISO(r.AppliedDate);
      if (!dt) continue;
      if (SINCE && dt < SINCE) continue;
      batch.push({ parcel: folio, dt, num: (r.PermitNum as string) || null });
      if (batch.length >= BATCH) await flush();
    }
  }
  await flush();
  console.log(`  ${res.label}: ${roof.toLocaleString()} roof, ${applied.toLocaleString()} applied, ${nomap.toLocaleString()} no-folio`);
  return { roof, applied, nomap };
}

async function main() {
  const recent = process.argv.includes("--recent");
  SINCE = sinceArg();
  if (SINCE) console.log(`Incremental: only permits issued on/after ${SINCE}`);
  const list = recent ? RESOURCES.slice(0, 1) : RESOURCES;
  const map = await strapFolioMap();
  let roof = 0, applied = 0, nomap = 0;
  for (const res of list) {
    const r = await ingestResource(res, map);
    roof += r.roof; applied += r.applied; nomap += r.nomap;
  }
  console.log(`\n=== Tampa permits → Hillsborough ===`);
  console.log(`roof permits:          ${roof.toLocaleString()}`);
  console.log(`property-rows advanced: ${applied.toLocaleString()}`);
  console.log(`unmapped PINs:         ${nomap.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
