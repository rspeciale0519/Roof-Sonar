/**
 * Fetch all Lake County parcels from the GeoHub "Tax Parcels" layer (situs,
 * owner, year built, living area, DOR use code + polygon geometry → centroid).
 * Lady Lake / Fruitland Park sit in The Villages' north. Emits the normalized
 * parcels CSV consumed by ingest-county-parcels.ts + load-address-points.ts.
 *
 *   npx tsx scripts/fetch-lake-parcels.ts
 *
 * NOTE: the layer sits behind a WAF that blocks LIKE/quoted predicates, so we
 * page by OBJECTID (where=OBJECTID>last) and ask for centroids in WGS84.
 */
import fs from "node:fs";

const LAYER = "https://gis.lakecountyfl.gov/lakegis/rest/services/OpenData/OpenData1/FeatureServer/12";
const OUT = "data/inbox/lake-parcels.csv";
const PAGE = 2000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36";
const FIELDS = ["OBJECTID", "ParcelNumber", "PropertyAddress", "OwnerName", "OwnerAddress", "OwnerCity", "OwnerState", "OwnerZip", "YearBuilt", "TotalLivingArea", "LandUseCode"];

interface Feat { attributes: Record<string, string | number | null>; centroid?: { x: number; y: number } | null }

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function page(lastOid: number): Promise<Feat[]> {
  const url = `${LAYER}/query?where=${encodeURIComponent(`OBJECTID>${lastOid}`)}&outFields=${encodeURIComponent(FIELDS.join(","))}` +
    `&orderByFields=OBJECTID&resultRecordCount=${PAGE}&returnCentroid=true&outSR=4326&returnGeometry=false&f=json`;
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
  out.write("PARCEL,SITUS,CITY,LAT,LNG,OWNER,MAILING,HOMESTEAD,YEAR_BUILT,SQFT,USE\n");
  let lastOid = 0, total = 0, withCoords = 0;
  for (;;) {
    const feats = await page(lastOid);
    if (feats.length === 0) break;
    for (const f of feats) {
      const a = f.attributes;
      lastOid = Math.max(lastOid, Number(a.OBJECTID) || lastOid);
      const parcel = String(a.ParcelNumber ?? "").trim();
      const addr = String(a.PropertyAddress ?? "").trim();
      if (!parcel || !addr) continue;
      const lat = f.centroid?.y, lng = f.centroid?.x;
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
      if (hasCoords) withCoords++;
      const mailing = [a.OwnerAddress, a.OwnerCity, a.OwnerState, a.OwnerZip].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
      const yb = Number(a.YearBuilt) > 0 ? String(a.YearBuilt) : "";
      const sqft = Number(a.TotalLivingArea) > 0 ? String(Number(a.TotalLivingArea)) : "";
      const use = String(a.LandUseCode ?? "").trim();
      const cols = [parcel, addr, "", hasCoords ? String(lat) : "", hasCoords ? String(lng) : "",
        String(a.OwnerName ?? "").trim(), mailing, "0", yb, sqft, use];
      out.write(cols.map(csvCell).join(",") + "\n");
      total++;
    }
    if (total % 20000 < PAGE) console.log(`  ${total} parcels written (oid≤${lastOid})…`);
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${total} parcels (${withCoords} with coords) -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
