/**
 * Winter Garden (Orange) re-roof permits from the city's BP412L "PERMITS ISSUED
 * REPORT" PDFs (records-request output). Records are multi-line: each starts
 * with a permit number (NN-NNNNNNNN); within the block we pull the dashed parcel
 * (14-22-27-9392-02810 — matches stored Orange parcel_number once separators are
 * stripped; the no-dash "census tracking" number is a DIFFERENT ordering, don't
 * use it) and the ISSUE DATE, then advance roof_year via apply_roof_permits.
 * Needs `pdftotext` (poppler) on PATH.
 *
 *   npx tsx scripts/ingest-winter-garden-permits.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { applyRoofPermits } from "./lib/sql";

const PDFS = [
  "data/inbox/permit-pdfs/Residential Reroofs 01.01.2000 to 02.01.2026.pdf",
  "data/inbox/permit-pdfs/Commercial Reroofs 01.01.2000 to 02.01.2026.pdf",
];
const TMP = "docs/temp/wg-extract.txt";
const START = /^\d{2}-\d{8} /;
const PARCEL = /\d{2}-\d{2}-\d{2}-\d{4}-\d{5}/;
const DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/;
const BATCH = 1000;

function toISO(m: RegExpMatchArray | null): string | null {
  if (!m) return null;
  let yy = m[3];
  if (yy.length === 2) yy = (Number(yy) > 50 ? "19" : "20") + yy;
  const y = Number(yy);
  if (y < 1990 || y > 2027) return null;
  return `${yy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parse(text: string): { parcel: string; dt: string; num: string | null }[] {
  const lines = text.split(/\r?\n/);
  const out: { parcel: string; dt: string; num: string | null }[] = [];
  let block: string[] = [];
  let num: string | null = null;
  const emit = () => {
    if (block.length) {
      const txt = block.join("\n");
      const pm = txt.match(PARCEL);
      if (pm) {
        let dt: string | null = null;
        const ii = block.findIndex((l) => /ISSUE DATE/.test(l));
        if (ii >= 0) for (let k = ii; k < block.length; k++) { const d = toISO(block[k].replace(/ISSUE DATE/, "").match(DATE)); if (d) { dt = d; break; } }
        if (!dt) dt = toISO(txt.match(DATE)); // fallback: application date
        if (dt) out.push({ parcel: pm[0], dt, num });
      }
    }
    block = [];
  };
  for (const l of lines) {
    if (START.test(l)) { emit(); num = l.slice(0, l.indexOf(" ")); }
    block.push(l);
  }
  emit();
  return out;
}

async function main() {
  let parsed = 0, applied = 0;
  for (const pdf of PDFS) {
    if (!fs.existsSync(pdf)) { console.log(`skip (missing): ${pdf}`); continue; }
    execFileSync("pdftotext", ["-layout", pdf, TMP]);
    const rows = parse(fs.readFileSync(TMP, "utf8"));
    parsed += rows.length;
    let fileApplied = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      fileApplied += await applyRoofPermits("Orange", rows.slice(i, i + BATCH));
    }
    applied += fileApplied;
    console.log(`  ${pdf.split(/[\\/]/).pop()}: ${rows.length.toLocaleString()} permits parsed, ${fileApplied.toLocaleString()} applied`);
  }
  fs.rmSync(TMP, { force: true });
  console.log(`\n=== Winter Garden permits → Orange ===`);
  console.log(`parsed:                ${parsed.toLocaleString()}`);
  console.log(`property-rows advanced: ${applied.toLocaleString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
