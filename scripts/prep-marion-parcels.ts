/**
 * Transform the Marion County PA bulk file (MCPA226DataWeb_*.csv inside
 * MCPA_Data.ZIP) into the normalized parcels CSV consumed by
 * ingest-county-parcels.ts. MCPA carries owner/situs/year-built/living-area/
 * homestead but NO coordinates — those come from the Marion PA GIS Parcels
 * layer (fetch-marion-parcels.ts) via the parcel-keyed geocode join.
 *
 *   npx tsx scripts/prep-marion-parcels.ts
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse";

const DIR = "data/inbox/marion";
const OUT = "data/inbox/marion-parcels.csv";

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const NOW = new Date().getFullYear();

function findSrc(): string {
  const f = fs.readdirSync(DIR).find((n) => /^MCPA\d+DataWeb_.*\.csv$/i.test(n));
  if (!f) throw new Error(`MCPA DataWeb CSV not found in ${DIR} (extract MCPA_Data.ZIP first)`);
  return path.join(DIR, f);
}

async function main() {
  const src = findSrc();
  const out = fs.createWriteStream(OUT);
  out.write("PARCEL,SITUS,CITY,LAT,LNG,OWNER,MAILING,HOMESTEAD,YEAR_BUILT,SQFT,USE\n");
  let total = 0, written = 0;
  const parser = fs.createReadStream(src).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true }));
  for await (const r of parser as AsyncIterable<Record<string, string>>) {
    total++;
    const parcel = (r["PARCEL"] ?? "").trim();
    const situs = [r["SITUS_1"], r["SITUS_2"]].map((v) => (v ?? "").trim()).filter(Boolean).join(" ");
    if (!parcel || !situs) continue;
    const owner = [r["OWNER 1"], r["OWNER 2"]].map((v) => (v ?? "").trim()).filter(Boolean).join(" ");
    const mailing = [r["MAILING ADDRESS1"], r["MAILING ADDRESS2"], r["MAILING CITY"], r["MAILING STATE"], r["MAILING ZIP"]]
      .map((v) => (v ?? "").trim()).filter(Boolean).join(" ");
    const hxYr = parseInt(r["HX_YR"] ?? "", 10);
    const homestead = !isNaN(hxYr) && hxYr > 0 ? "1" : "0";
    const yb = parseInt(r["YRBLT1"] ?? "", 10);
    const year = !isNaN(yb) && yb >= 1800 && yb <= NOW ? String(yb) : "";
    const sqft = parseInt(r["RESUSESF"] ?? "", 10);
    const sqftStr = !isNaN(sqft) && sqft > 0 ? String(sqft) : "";
    const pcRaw = (r["PC"] ?? "").trim();
    const use = /^\d+$/.test(pcRaw) ? pcRaw.padStart(2, "0") : pcRaw;
    const city = (r["SITUS_CITY"] ?? r["CITY"] ?? "").trim();
    out.write([parcel, situs, city, "", "", owner, mailing, homestead, year, sqftStr, use].map(csvCell).join(",") + "\n");
    written++;
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${written}/${total} parcels -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
