/**
 * Hillsborough unincorporated + non-Tampa re-roof permits from the HCPA per-parcel
 * API (gis.hcpafl.org ParcelData), keyed by STRAP. FULLY CLOUD-RESUMABLE: reads
 * the STRAP<->FOLIO map and its own progress from the DB (hcpa_parcel_map +
 * properties.permit_scraped_at), so it runs in GitHub Actions with no local files
 * or checkpoint. Each run takes the next chunk of un-scraped Hillsborough gap
 * parcels, queries the API, advances roof_year (real re-roofs only, excludes
 * rooftop HVAC), and stamps permit_scraped_at so the ~444k backlog drains across
 * runs. (Map is loaded once via scripts/load-hcpa-map.ts.)
 *
 *   npx tsx scripts/scrape-hillsborough-permits.ts --limit 100   # sample
 *   npx tsx scripts/scrape-hillsborough-permits.ts               # one chunk (default 5000)
 */
import { sql, applyRoofPermits } from "./lib/sql";

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

/** Next chunk of un-scraped Hillsborough gap parcels (roof_year null), with their STRAP. */
async function nextChunk(limit: number): Promise<{ folio: string; strap: string }[]> {
  return sql<{ folio: string; strap: string }>(
    `select p.parcel_number as folio, m.strap
     from properties p
     join jurisdictions j on j.id = p.jurisdiction_id
     join hcpa_parcel_map m on m.folio = p.parcel_number
     where j.county = 'Hillsborough' and p.roof_year is null and p.permit_scraped_at is null
     order by p.id limit ${Math.max(1, Math.min(limit, 50000))}`,
  );
}

/** Stamp scraped parcels so they're not re-scraped (whether or not a permit was found). */
async function markScraped(folios: string[]): Promise<void> {
  for (let i = 0; i < folios.length; i += 2000) {
    const list = folios.slice(i, i + 2000).map((f) => `'${f.replace(/'/g, "''")}'`).join(",");
    await sql(
      `update properties p set permit_scraped_at = now() from jurisdictions j
       where j.id = p.jurisdiction_id and j.county = 'Hillsborough' and p.parcel_number in (${list})`,
    );
  }
}

async function main() {
  const li = process.argv.indexOf("--limit");
  const limit = li >= 0 ? parseInt(process.argv[li + 1], 10) : 5000;

  const chunk = await nextChunk(limit);
  if (!chunk.length) { console.log("Backlog drained — no un-scraped Hillsborough gap parcels left."); return; }
  console.log(`scraping ${chunk.length.toLocaleString()} parcels…`);

  const updates: { parcel: string; dt: string; num: string | null }[] = [];
  let withPermit = 0, done = 0;
  await pool(chunk, POOL, async ({ folio, strap }) => {
    let best: { dt: string; num: string | null } | null = null;
    for (const p of await roofPermits(strap)) {
      const dt = toISO(p.issueDate);
      if (dt && (!best || dt > best.dt)) best = { dt, num: p.permitNum ?? null };
    }
    if (best) { updates.push({ parcel: folio, dt: best.dt, num: best.num }); withPermit++; }
    if (++done % 500 === 0) console.log(`  …${done}/${chunk.length} scraped, ${withPermit} with roof permit`);
  });

  let applied = 0;
  for (let i = 0; i < updates.length; i += 1000) applied += await applyRoofPermits("Hillsborough", updates.slice(i, i + 1000));
  await markScraped(chunk.map((c) => c.folio));

  console.log(`\n=== Hillsborough HCPA scrape chunk ===`);
  console.log(`scraped:    ${chunk.length.toLocaleString()}`);
  console.log(`roof found: ${withPermit.toLocaleString()}`);
  console.log(`applied:    ${applied.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
