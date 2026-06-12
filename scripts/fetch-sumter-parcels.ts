/**
 * Fetch all Sumter County parcels from the county AGOL Parcels_gdb layer, which
 * uniquely carries situs + lat/lng + owner + homestead + year-built + living
 * area + DOR use code in ONE layer (The Villages core). Emits a normalized
 * parcels CSV consumed by scripts/ingest-county-parcels.ts (attributes) and
 * scripts/load-address-points.ts (coordinates).
 *
 *   npx tsx scripts/fetch-sumter-parcels.ts
 *
 * Source (VERIFIED, public): services8.arcgis.com/FTrtUCmxaVKdPC5e Parcels_gdb/0
 */
import fs from "node:fs";

const LAYER = "https://services8.arcgis.com/FTrtUCmxaVKdPC5e/arcgis/rest/services/Parcels_gdb/FeatureServer/0";
const OUT = "data/inbox/sumter-parcels.csv";
const PAGE = 2000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36";
const FIELDS = ["PIN", "Physical_A", "Physical_C", "Owners_Nam", "Mailing_Ad", "City", "State", "Zip_4", "Homestead", "AYB", "EYB", "DOR_LUC", "Total_Usab", "LATITUDE", "LONGITUDE"];

interface Attr { [k: string]: string | number | null }

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function page(offset: number): Promise<Attr[]> {
  const url = `${LAYER}/query?where=${encodeURIComponent("1=1")}&outFields=${encodeURIComponent(FIELDS.join(","))}` +
    `&resultOffset=${offset}&resultRecordCount=${PAGE}&returnGeometry=false&f=json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { features?: { attributes: Attr }[]; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return (j.features ?? []).map((f) => f.attributes);
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
  let offset = 0, total = 0, withCoords = 0;
  for (;;) {
    const rows = await page(offset);
    if (rows.length === 0) break;
    for (const a of rows) {
      const pin = String(a.PIN ?? "").trim();
      const addr = String(a.Physical_A ?? "").trim();
      if (!pin || !addr) continue;
      const lat = Number(a.LATITUDE), lng = Number(a.LONGITUDE);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
      if (hasCoords) withCoords++;
      const mailing = [a.Mailing_Ad, a.City, a.State, a.Zip_4].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
      const homestead = String(a.Homestead ?? "").toUpperCase().includes("HOMESTEAD EXP") && !String(a.Homestead ?? "").toUpperCase().includes("NO HOMESTEAD") ? "1" : "0";
      const yb = Number(a.AYB) > 0 ? String(a.AYB) : (Number(a.EYB) > 0 ? String(a.EYB) : "");
      const sqft = Number(a.Total_Usab) > 0 ? String(a.Total_Usab) : "";
      const use = Number(a.DOR_LUC) >= 0 ? String(a.DOR_LUC).padStart(2, "0") : "";
      const cols = [pin, addr, String(a.Physical_C ?? "").trim(), hasCoords ? String(lat) : "", hasCoords ? String(lng) : "",
        String(a.Owners_Nam ?? "").trim(), mailing, homestead, yb, sqft, use];
      out.write(cols.map(csvCell).join(",") + "\n");
      total++;
    }
    offset += PAGE;
    if (total % 20000 < PAGE) console.log(`  ${total} parcels written…`);
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${total} parcels (${withCoords} with coords) -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
