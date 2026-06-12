/**
 * Fetch Pasco County address points (situs + lat/lng) from the PascoMapper
 * Addresses layer. The PA roll (parcel_summary) and this layer use different
 * parcel encodings, so coordinates join to the loaded properties by SITUS
 * (city-less street address) via the geocode situs pass. Output is the
 * address-points CSV for load-address-points.ts.
 *
 *   npx tsx scripts/fetch-pasco-addresses.ts
 */
import fs from "node:fs";

const LAYER = "https://services6.arcgis.com/Mo4MddfRHpFwT7UF/arcgis/rest/services/PascoMapper_Addresses/FeatureServer/16";
const OUT = "data/inbox/pasco-address-points.csv";
const PAGE = 2000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36";
const FIELDS = ["OBJECTID", "PARCEL_NUMBER", "FULL_ADDRESS", "LATITUDE", "LONGITUDE"];

interface Feat { attributes: Record<string, string | number | null> }
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function page(lastOid: number): Promise<Feat[]> {
  const url = `${LAYER}/query?where=${encodeURIComponent(`OBJECTID>${lastOid}`)}&outFields=${encodeURIComponent(FIELDS.join(","))}` +
    `&orderByFields=OBJECTID&resultRecordCount=${PAGE}&returnGeometry=false&f=json`;
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
      const a = f.attributes;
      lastOid = Math.max(lastOid, Number(a.OBJECTID) || lastOid);
      const addr = String(a.FULL_ADDRESS ?? "").trim();
      if (!addr) continue;
      const lat = Number(a.LATITUDE), lng = Number(a.LONGITUDE);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
      if (!hasCoords) continue;
      withCoords++;
      out.write([String(a.PARCEL_NUMBER ?? "").trim(), addr, String(lat), String(lng)].map(csvCell).join(",") + "\n");
      total++;
    }
    if (total % 40000 < PAGE) console.log(`  ${total} address points (oid≤${lastOid})…`);
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${total} address points (${withCoords} with coords) -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
