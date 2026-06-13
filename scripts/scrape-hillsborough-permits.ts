/**
 * Hillsborough unincorporated + non-Tampa re-roof permits from the HCPA per-parcel
 * API (gis.hcpafl.org ParcelData), which aggregates county+city permits CivicData
 * (Tampa only) lacks. The API is keyed by HCPA STRAP (NOT folio/pin); we map
 * STRAP→FOLIO from the parcel dbf and advance roof_year by FOLIO. It's per-parcel
 * (~445k gap parcels), so this is RESUMABLE + throttled: it snapshots the queue of
 * Hillsborough folios with no roof_year, then processes a chunk per run (cron-
 * driven), checkpointing progress. Filters descr for real re-roofs (excludes
 * rooftop HVAC units).
 *
 *   npx tsx scripts/scrape-hillsborough-permits.ts --limit 100   # sample/verify
 *   npx tsx scripts/scrape-hillsborough-permits.ts               # one cron chunk (default 5000)
 *   npx tsx scripts/scrape-hillsborough-permits.ts --reset       # rebuild the queue
 */
import fs from "node:fs";
import * as shapefile from "shapefile";
import { sql, applyRoofPermits } from "./lib/sql";

const DBF = "data/inbox/hillsborough/parcel_4_public.dbf";
const QUEUE = "data/temp/hillsborough-scrape-queue.json";
const API = "https://gis.hcpafl.org/CommonServices/property/search/ParcelData?pin=";
const UA = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36" } };
const POOL = 6;
const REROOF = /re-?roof|roof replac|roof recover|roofing|reroof/i;
const NOT_ROOF = /roof top|rooftop|\brtu\b|roof drain|roof top unit|roof vent/i;

interface Permit { descr?: string; issueDate?: string; permitNum?: string }

function toISO(v: unknown): string | null {
  const m = String(v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const y = Number(m[3]);
  if (y < 1950 || y > 2027) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

async function folioToStrap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const src = await shapefile.openDbf(DBF);
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const v = r.value as { FOLIO?: string; STRAP?: string };
    if (v.FOLIO && v.STRAP) map.set(String(v.FOLIO).trim(), String(v.STRAP).trim());
  }
  return map;
}

async function buildQueue(): Promise<string[]> {
  console.log("building queue: Hillsborough folios with no roof_year…");
  const folios: string[] = [];
  let after = 0;
  for (;;) {
    const rows = await sql<{ id: number; parcel_number: string }>(
      `select p.id, p.parcel_number from properties p join jurisdictions j on j.id=p.jurisdiction_id
       where j.county='Hillsborough' and p.roof_year is null and p.parcel_number is not null and p.id > ${after}
       order by p.id limit 50000`,
    );
    if (!rows.length) break;
    for (const r of rows) folios.push(r.parcel_number);
    after = Number(rows[rows.length - 1].id);
    if (rows.length < 50000) break;
  }
  fs.mkdirSync("data/temp", { recursive: true });
  fs.writeFileSync(QUEUE, JSON.stringify({ folios, idx: 0 }));
  console.log(`queue: ${folios.length.toLocaleString()} parcels`);
  return folios;
}

async function roofPermits(strap: string): Promise<Permit[]> {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(API + encodeURIComponent(strap), UA);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { permitInfo?: Permit[] };
      return (j.permitInfo ?? []).filter((p) => REROOF.test(p.descr ?? "") && !NOT_ROOF.test(p.descr ?? ""));
    } catch {
      await new Promise((res) => setTimeout(res, 800 * (a + 1)));
    }
  }
  return [];
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k]); }
  }));
}

async function main() {
  const limIdx = process.argv.indexOf("--limit");
  const limit = limIdx >= 0 ? parseInt(process.argv[limIdx + 1], 10) : 5000;
  if (process.argv.includes("--reset") && fs.existsSync(QUEUE)) fs.rmSync(QUEUE);

  const map = await folioToStrap();
  const state = fs.existsSync(QUEUE)
    ? (JSON.parse(fs.readFileSync(QUEUE, "utf8")) as { folios: string[]; idx: number })
    : { folios: await buildQueue(), idx: 0 };

  const chunk = state.folios.slice(state.idx, state.idx + limit);
  if (!chunk.length) { console.log("queue complete — nothing left to scrape."); return; }
  console.log(`scraping ${chunk.length.toLocaleString()} parcels (from idx ${state.idx} of ${state.folios.length.toLocaleString()})`);

  const updates: { parcel: string; dt: string; num: string | null }[] = [];
  let withPermit = 0, noStrap = 0, done = 0;
  await pool(chunk, POOL, async (folio) => {
    const strap = map.get(folio);
    if (!strap) { noStrap++; return; }
    const permits = await roofPermits(strap);
    let best: { dt: string; num: string | null } | null = null;
    for (const p of permits) {
      const dt = toISO(p.issueDate);
      if (dt && (!best || dt > best.dt)) best = { dt, num: p.permitNum ?? null };
    }
    if (best) { updates.push({ parcel: folio, dt: best.dt, num: best.num }); withPermit++; }
    if (++done % 500 === 0) console.log(`  …${done}/${chunk.length} scraped, ${withPermit} with roof permit`);
  });

  let applied = 0;
  for (let i = 0; i < updates.length; i += 1000) applied += await applyRoofPermits("Hillsborough", updates.slice(i, i + 1000));

  state.idx += chunk.length;
  fs.writeFileSync(QUEUE, JSON.stringify(state));
  console.log(`\n=== Hillsborough HCPA scrape chunk ===`);
  console.log(`scraped:   ${chunk.length.toLocaleString()} (${noStrap} no-strap)`);
  console.log(`roof found: ${withPermit.toLocaleString()}`);
  console.log(`applied:   ${applied.toLocaleString()}`);
  console.log(`progress:  ${state.idx.toLocaleString()}/${state.folios.length.toLocaleString()}${state.idx >= state.folios.length ? " — COMPLETE" : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
