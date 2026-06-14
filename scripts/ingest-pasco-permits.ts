/**
 * Pasco County re-roof permits from the public-records release (#8752), exported
 * from Accela as CSV. Three files in data/inbox/pasco/:
 *   - residential 12-2021..2026  (Record Type = "Residential Re-Roof")
 *   - commercial  02-2024..2026  (Record Type = "Commercial Re-Roof")
 *   - res-comm     2000..2024     (mixed free-text re-roof descriptions, historical)
 * Parcels are space-delimited (e.g. "34 25 16 0030 00000 0880"); properties are
 * keyed by dashed parcel — apply_roof_permits normalizes both sides (migration
 * 0017), verified at 97.8% overlap. Advance-only via applyRoofPermits.
 *
 *   npx tsx scripts/ingest-pasco-permits.ts
 *
 * NOTE: the residential + res-comm exports are capped at 5,000 rows by Accela,
 * so this is PARTIAL history pending an uncapped re-request. One-time/occasional
 * (records-request data, no live feed) — not wired to a cron.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { applyRoofPermits } from "./lib/sql";

const DIR = path.join("data", "inbox", "pasco");
const FILES = [
  "pasco-residential-2021-2026.csv",
  "pasco-commercial-2024-2026.csv",
  "pasco-res-comm-2000-2024.csv",
];
// re-roof matcher for the mixed historical file; exclude rooftop HVAC / solar
const REROOF = /re-?roof|reroof|roof replac|tear off.*shingl|install.*(new )?roof|new roof/i;
const NOT_ROOF = /roof ?top|\brtu\b|roof drain|roof vent|solar|a\/?c|hvac/i;
const BATCH = 1000;

// "Opened Date" is the application/intake date (the export has no issue date);
// for re-roofs the permit opens within days of the work, so opened-year is a
// sound roof-year proxy — far better than year_built.
function toISO(v: string): string | null {
  const m = String(v ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const y = Number(m[3]);
  if (y < 1950 || y > new Date().getFullYear() + 1) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Parse a file, dropping Accela's "first 5000 records…" preamble. `capped` is
 *  true when that preamble was present (the real partial-history signal). */
function readRows(file: string): { rows: Record<string, string>[]; capped: boolean } {
  let txt = fs.readFileSync(path.join(DIR, file), "utf8");
  const capped = /^"?This report contains the first/i.test(txt);
  if (capped) txt = txt.slice(txt.indexOf("\n") + 1);
  const rows = parse(txt, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  return { rows, capped };
}

function isReroof(recordType: string): boolean {
  return REROOF.test(recordType) && !NOT_ROOF.test(recordType);
}

async function main() {
  const rows: { parcel: string; dt: string; num: string | null }[] = [];
  let seen = 0, roof = 0, nodate = 0, noparcel = 0, capped = 0;

  for (const file of FILES) {
    const { rows: recs, capped: isCapped } = readRows(file);
    if (isCapped) capped++;
    let fileRoof = 0;
    for (const r of recs) {
      seen++;
      const type = r["Record Type"] ?? "";
      if (!isReroof(type)) continue;
      roof++; fileRoof++;
      const parcel = (r["Parcel #"] ?? "").trim();
      if (!parcel) { noparcel++; continue; }
      const dt = toISO(r["Opened Date"] ?? "");
      if (!dt) { nodate++; continue; }
      rows.push({ parcel, dt, num: (r["Record ID"] ?? "").trim() || null });
    }
    console.log(`  ${file}: ${recs.length} rows → ${fileRoof} re-roof`);
  }

  console.log(`\nparsed ${seen} rows, ${roof} re-roof, ${rows.length} applicable (${noparcel} no-parcel, ${nodate} no-date)`);
  let applied = 0;
  for (let i = 0; i < rows.length; i += BATCH) applied += await applyRoofPermits("Pasco", rows.slice(i, i + BATCH));

  console.log(`\n=== Pasco permits → roof_year ===`);
  console.log(`property-rows advanced: ${applied.toLocaleString()}`);
  if (capped) console.log(`⚠ ${capped} file(s) were Accela-capped at 5,000 rows — PARTIAL history (re-request pending).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
