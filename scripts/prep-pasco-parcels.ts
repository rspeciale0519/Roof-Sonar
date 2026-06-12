/**
 * Transform the Pasco PA bulk file (parcel_summary.xlsx — 79 MB, ~600k rows)
 * into the normalized parcels CSV consumed by ingest-county-parcels.ts.
 * Streamed (WorkbookReader) so the whole workbook never sits in memory.
 * Coordinates come from the PascoMapper Addresses layer
 * (fetch-pasco-addresses.ts) via the parcel-keyed geocode join.
 *
 *   npx tsx scripts/prep-pasco-parcels.ts
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

const SRC = "data/inbox/pasco-pa/parcel_summary.xlsx";
const OUT = "data/inbox/pasco-parcels.csv";
const NOW = new Date().getFullYear();
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`Missing ${SRC}`);
  const out = fs.createWriteStream(OUT);
  out.write("PARCEL,SITUS,CITY,LAT,LNG,OWNER,MAILING,HOMESTEAD,YEAR_BUILT,SQFT,USE\n");
  const col: Record<string, number> = {};
  let total = 0, written = 0;

  const wbr = new ExcelJS.stream.xlsx.WorkbookReader(path.resolve(SRC), { entries: "emit", sharedStrings: "cache", worksheets: "emit" });
  for await (const ws of wbr) {
    for await (const row of ws as AsyncIterable<ExcelJS.Row>) {
      const vals = row.values as unknown[];
      if (Object.keys(col).length === 0) {
        vals.forEach((v, i) => { if (v != null) col[String(v).trim()] = i; });
        continue;
      }
      total++;
      const get = (name: string) => { const i = col[name]; return i != null && vals[i] != null ? String(vals[i]).trim() : ""; };
      const parcel = get("PARCEL");
      const situs = get("SITE_ADDRESS");
      if (!parcel || !situs) continue;
      const yb = parseInt(get("ACTUAL_YEAR_BUILT") || get("EFFECTIVE_YEAR_BUILT") || "", 10);
      const year = !isNaN(yb) && yb >= 1800 && yb <= NOW ? String(yb) : "";
      const sqft = parseInt(get("LIVING_AREA") || "", 10);
      const sqftStr = !isNaN(sqft) && sqft > 0 ? String(sqft) : "";
      const useRaw = get("LAND_USE_CODE");
      const use = /^\d+$/.test(useRaw) ? useRaw.slice(0, 2) : useRaw; // 5-digit -> 2-digit DOR
      const owner = [get("OWNER_NAME_1"), get("OWNER_NAME_2")].filter(Boolean).join(" ");
      const mailing = [get("MAILING_ADDRESS_1"), get("MAILING_ADDRESS_2"), get("MAILING_CITY"), get("MAILING_STATE"), get("MAILING_ZIP")].filter(Boolean).join(" ");
      const hs = get("HAS_HOMESTEAD").toUpperCase();
      const homestead = hs === "YES" || hs === "Y" || hs === "TRUE" || hs === "1" ? "1" : "0";
      out.write([parcel, situs, get("SITE_CITY"), "", "", owner, mailing, homestead, year, sqftStr, use].map(csvCell).join(",") + "\n");
      written++;
      if (written % 50000 === 0) console.log(`  ${written} written…`);
    }
    break;
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${written}/${total} parcels -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
