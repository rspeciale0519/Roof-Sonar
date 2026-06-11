/**
 * Fetch Volusia County address points (Open_Data_1 layer 2 "Address Situs",
 * ~276k rows) to CSV for load-address-points.ts. PID is the county parcel
 * number (matches VCPA DORID stored as properties.parcel_number).
 *
 *   npx tsx scripts/fetch-address-points-volusia.ts
 *   npx tsx scripts/load-address-points.ts volusia data/inbox/volusia-address-points.csv \
 *     --parcel PID --situs COMPLETE_ADDRESS --lng LONGITUDE --lat LATITUDE --skip-join
 */
import fs from "node:fs";
import path from "node:path";

const LAYER = "https://maps5.vcgov.org/arcgis/rest/services/Open_Data/Open_Data_1/FeatureServer/2/query";
const PAGE = 2000;
const OUT = path.join("data", "inbox", "volusia-address-points.csv");

interface Feature {
  attributes: { PID: string | null; ADDRESS: string | null; CITYNAME: string | null; ZIP: number | null };
  geometry?: { x: number; y: number };
}

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function fetchPage(offset: number, attempt = 1): Promise<Feature[]> {
  const qs = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "PID,ADDRESS,CITYNAME,ZIP",
    returnGeometry: "true",
    outSR: "4326",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    orderByFields: "OBJECTID",
  });
  try {
    const res = await fetch(`${LAYER}?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { features?: Feature[]; error?: unknown };
    if (json.error) throw new Error(JSON.stringify(json.error));
    return json.features ?? [];
  } catch (err) {
    if (attempt >= 4) throw err;
    const backoff = attempt * 5000;
    console.warn(`  offset ${offset} failed (${err instanceof Error ? err.message : err}); retry ${attempt}/3 in ${backoff / 1000}s`);
    await new Promise((r) => setTimeout(r, backoff));
    return fetchPage(offset, attempt + 1);
  }
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out = fs.createWriteStream(OUT);
  out.write("PID,COMPLETE_ADDRESS,LATITUDE,LONGITUDE\n");
  let offset = 0;
  let total = 0;
  for (;;) {
    const feats = await fetchPage(offset);
    if (feats.length === 0) break;
    for (const f of feats) {
      const a = f.attributes;
      if (!f.geometry || a.PID == null) continue;
      const address = `${(a.ADDRESS ?? "").trim()}, ${(a.CITYNAME ?? "").trim()}, FL ${a.ZIP ?? ""}`;
      out.write(`${csvCell(a.PID)},${csvCell(address)},${f.geometry.y},${f.geometry.x}\n`);
      total++;
    }
    offset += feats.length;
    if (offset % 20000 === 0) console.log(`  ${offset} fetched…`);
    if (feats.length < PAGE) break;
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${total} address points -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
