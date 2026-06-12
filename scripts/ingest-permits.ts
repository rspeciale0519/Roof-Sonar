/**
 * Generic parcel-keyed roof-permit ingest. Reads a county permit export (CSV or
 * xlsx), keeps roofing rows, and advances each matching property's roof_year /
 * last_permit_* by parcel number via the apply_roof_permits RPC. Used for
 * counties loaded from a PA parcel roll where the permit feed carries the same
 * parcel id (Seminole PA dump, Sumter Citizenserve, Marion CDPlus, …).
 *
 *   # Seminole PA dump (single description column)
 *   npx tsx scripts/ingest-permits.ts Seminole --file data/inbox/seminole/seminole-pa-permits.csv \
 *     --parcel Parcel --date PermitDate --number PermitNo --desc PermitDesc
 *
 *   # Sumter Citizenserve (roof match across several columns, date fallback)
 *   npx tsx scripts/ingest-permits.ts Sumter --file data/inbox/sumter/CitizenServe_2025.xlsx \
 *     --parcel "Parcel Number" --date "Issue Date,Application Date" --number "Permit#" \
 *     --desc "Permit Type,Permit Subtype,Subtype Details"
 */
import fs from "node:fs";
import { parse } from "csv-parse";
import ExcelJS from "exceljs";
import { db } from "./lib/db";

const BATCH = 1000;

function arg(name: string, dflt = ""): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

// Parse "YYYY-MM-DD…", "MM/DD/YYYY", or "M/D/YY" -> ISO date string or null.
function toISO(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const [, mm, dd, rawYy] = us;
    const yy = rawYy.length === 2 ? (Number(rawYy) > 50 ? "19" : "20") + rawYy : rawYy;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

const cleanParcel = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function* csvRows(file: string): AsyncGenerator<Record<string, string>> {
  const parser = fs.createReadStream(file).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true }));
  for await (const r of parser as AsyncIterable<Record<string, string>>) yield r;
}

async function* xlsxRows(file: string): AsyncGenerator<Record<string, string>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? "").trim());
  for (let i = 2; i <= ws.rowCount; i++) {
    const vals = ws.getRow(i).values as unknown[];
    const row: Record<string, string> = {};
    for (let c = 1; c < header.length; c++) row[header[c]] = vals[c] == null ? "" : String(vals[c]).trim();
    yield row;
  }
}

async function main() {
  const county = process.argv[2];
  const file = arg("--file");
  if (!county || !file || !fs.existsSync(file)) {
    console.error("Usage: npx tsx scripts/ingest-permits.ts <County> --file <csv|xlsx> --parcel COL --date COL[,FALLBACK] --number COL --desc COL[,COL2] [--roof REGEX] [--all]");
    process.exit(1);
  }
  const parcelCol = arg("--parcel", "Parcel");
  const dateCols = arg("--date", "PermitDate").split(",").map((s) => s.trim());
  const numberCol = arg("--number", "PermitNo");
  const descCols = arg("--desc").split(",").map((s) => s.trim()).filter(Boolean);
  const roofRe = new RegExp(arg("--roof", "re-?roof|roof"), "i");
  const all = process.argv.includes("--all");

  const rows = /\.xlsx$/i.test(file) ? xlsxRows(file) : csvRows(file);
  let rowsIn = 0, roofRows = 0, sent = 0, applied = 0;
  let batch: { parcel: string; dt: string; num: string | null }[] = [];

  async function flush() {
    if (batch.length === 0) return;
    const { data, error } = await db().rpc("apply_roof_permits", { p_county: county, p_rows: batch });
    if (error) throw new Error(`apply_roof_permits failed: ${error.message}`);
    applied += (data as number) ?? 0;
    sent += batch.length;
    if (sent % 50000 < BATCH) console.log(`  ${rowsIn} read, ${roofRows} roof, ${sent} sent, ${applied} property-rows advanced…`);
    batch = [];
  }

  for await (const r of rows) {
    rowsIn++;
    const desc = descCols.map((c) => r[c] ?? "").join(" ");
    if (!all && !roofRe.test(desc)) continue;
    roofRows++;
    const parcel = cleanParcel(r[parcelCol] ?? "");
    let dt: string | null = null;
    for (const c of dateCols) { dt = toISO(r[c]); if (dt) break; }
    if (!parcel || !dt) continue;
    batch.push({ parcel, dt, num: r[numberCol] || null });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  console.log(`\n=== Permits ${county} (${file.split(/[\\/]/).pop()}) ===`);
  console.log(`rows read:            ${rowsIn.toLocaleString()}`);
  console.log(`roofing rows:         ${roofRows.toLocaleString()}`);
  console.log(`property-rows advanced: ${applied.toLocaleString()}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
