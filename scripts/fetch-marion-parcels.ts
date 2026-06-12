/**
 * Fetch Marion County parcel coordinates from the PA GIS Parcels MapServer.
 * The layer has no point/centroid support and no building attributes, so we
 * pull simplified polygons (maxAllowableOffset) and compute a centroid per
 * parcel. Output is an address-points CSV (PARCEL,SITUS,LAT,LNG) joined to the
 * MCPA-loaded properties by parcel number. (Attributes come from MCPA via
 * prep-marion-parcels.ts + ingest-county-parcels.ts.)
 *
 *   npx tsx scripts/fetch-marion-parcels.ts
 */
import fs from "node:fs";

const LAYER = "https://www.pa.marion.fl.us/arcgis/rest/services/MCPA_Services/Parcels/MapServer/0";
const OUT = "data/inbox/marion-address-points.csv";
const PAGE = 2000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36";

interface Feat { attributes: Record<string, string | number | null>; geometry?: { rings?: number[][][] } }

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Centroid as the mean of the outer ring's vertices (good enough for a map dot
// on a simplified ~4-vertex parcel polygon).
function centroid(geom?: { rings?: number[][][] }): [number, number] | null {
  const ring = geom?.rings?.[0];
  if (!ring || ring.length === 0) return null;
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of ring) {
    if (Number.isFinite(x) && Number.isFinite(y)) { sx += x; sy += y; n++; }
  }
  return n ? [sx / n, sy / n] : null;
}

async function page(lastOid: number): Promise<Feat[]> {
  const url = `${LAYER}/query?where=${encodeURIComponent(`OBJECTID>${lastOid}`)}&outFields=${encodeURIComponent("OBJECTID,PARCEL,SITUS_1,SITUS_2")}` +
    `&orderByFields=OBJECTID&resultRecordCount=${PAGE}&returnGeometry=true&maxAllowableOffset=0.0006&outSR=4326&f=json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { features?: Feat[]; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.features ?? [];
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return [];
}

async function main() {
  const out = fs.createWriteStream(OUT);
  out.write("PARCEL,SITUS,LAT,LNG\n");
  let lastOid = 0, total = 0, withCoords = 0;
  for (;;) {
    const feats = await page(lastOid);
    if (feats.length === 0) break;
    for (const f of feats) {
      lastOid = Math.max(lastOid, Number(f.attributes.OBJECTID) || lastOid);
      const parcel = String(f.attributes.PARCEL ?? "").trim();
      if (!parcel) continue;
      const c = centroid(f.geometry);
      const situs = [f.attributes.SITUS_1, f.attributes.SITUS_2].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
      if (c) withCoords++;
      out.write([parcel, situs, c ? String(c[1]) : "", c ? String(c[0]) : ""].map(csvCell).join(",") + "\n");
      total++;
    }
    if (total % 20000 < PAGE) console.log(`  ${total} parcels (oid≤${lastOid})…`);
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${total} parcels (${withCoords} with centroid) -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
