/**
 * Fetch Orange County address points (AGOL_Open_Data layer 0) to CSV for
 * load-address-points.ts. Pages the ArcGIS REST API 1000 rows at a time;
 * LATITUDE/LONGITUDE attribute fields mean no geometry fetch is needed.
 *
 *   npx tsx scripts/fetch-address-points-orange.ts            # -> data/inbox/orange-address-points.csv
 *   npx tsx scripts/load-address-points.ts orange data/inbox/orange-address-points.csv \
 *     --parcel OFFICIAL_PARCEL_ID --situs COMPLETE_ADDRESS --lng LONGITUDE --lat LATITUDE
 */
import fs from "node:fs";
import path from "node:path";

const LAYER = "https://ocgis4.ocfl.net/arcgis/rest/services/AGOL_Open_Data/MapServer/0/query";
const PAGE = 1000;
const OUT = path.join("data", "inbox", "orange-address-points.csv");

interface Attrs {
  OFFICIAL_PARCEL_ID: string | null;
  COMPLETE_ADDRESS: string | null;
  LATITUDE: number | null;
  LONGITUDE: number | null;
  DOR_USE_CODE: string | null;
}

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function fetchPage(offset: number, attempt = 1): Promise<Attrs[]> {
  const qs = new URLSearchParams({
    f: "json",
    where: "1=1",
    outFields: "OFFICIAL_PARCEL_ID,COMPLETE_ADDRESS,LATITUDE,LONGITUDE,DOR_USE_CODE",
    returnGeometry: "false",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE),
    orderByFields: "OBJECTID",
  });
  try {
    const res = await fetch(`${LAYER}?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { features?: { attributes: Attrs }[]; error?: unknown };
    if (json.error) throw new Error(JSON.stringify(json.error));
    return (json.features ?? []).map((f) => f.attributes);
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
  out.write("OFFICIAL_PARCEL_ID,COMPLETE_ADDRESS,LATITUDE,LONGITUDE,DOR_USE_CODE\n");
  let offset = 0;
  let total = 0;
  for (;;) {
    const rows = await fetchPage(offset);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.LATITUDE == null || r.LONGITUDE == null) continue;
      out.write(`${csvCell(r.OFFICIAL_PARCEL_ID)},${csvCell(r.COMPLETE_ADDRESS)},${r.LATITUDE},${r.LONGITUDE},${csvCell(r.DOR_USE_CODE)}\n`);
      total++;
    }
    offset += rows.length;
    if (offset % 25000 === 0) console.log(`  ${offset} fetched…`);
    if (rows.length < PAGE) break;
  }
  out.end();
  console.log(`Done: ${total} address points -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
