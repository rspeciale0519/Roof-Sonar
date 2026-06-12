/**
 * Backfill year_built + building_sqft (→ roofing_squares) for properties that
 * were geocoded from a permit but never matched a NAL owner row, by joining the
 * authoritative county PA file on parcel_number. Fills NULLs only.
 *
 *   npx tsx scripts/backfill-building-data.ts seminole
 *   npx tsx scripts/backfill-building-data.ts volusia
 *   npx tsx scripts/backfill-building-data.ts orange
 *   npx tsx scripts/backfill-building-data.ts pinellas
 *
 * Sources are already on disk (see docs/ROOF_DATA_COMPLETENESS_SPEC.md).
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import AdmZip from "adm-zip";
import { parse } from "csv-parse";
import { db } from "./lib/db";
import { normalizeAddress } from "./lib/normalize";

interface Cfg {
  county: "Seminole" | "Volusia" | "Orange" | "Pinellas";
  file: string;
  zip?: boolean;        // file is a .zip containing one .csv (NAL)
  parcelCol: string;
  yearCol: string;
  sqftCol: string;
  // Optional normalized situs builder — must reproduce how this county's
  // properties.situs_address was stored, so the (county, situs) match can hit
  // permit-only rows whose parcel format differs from the owner roll.
  situs?: (r: Record<string, string>) => string;
}

// Strip a trailing "<ST> <ZIP>" so a full-address source ends at the city.
const stripStateZip = (s: string) => s.replace(/\s+[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/i, "").trim();
const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" ");

const CONFIG: Record<string, Cfg> = {
  // Seminole/Volusia store situs WITH city; Orange stores it WITHOUT city
  // (situsCity=false in ingest-nal). Match each convention exactly.
  seminole: { county: "Seminole", file: "data/inbox/seminole-parcels.csv", parcelCol: "Parcel", yearCol: "YearBuilt", sqftCol: "TotalLivingArea",
    situs: (r) => normalizeAddress(stripStateZip(r.PrimaryAddress ?? "")) },
  volusia:  { county: "Volusia",  file: "data/inbox/nal/volusia-nal.zip", zip: true, parcelCol: "PARCEL_ID", yearCol: "ACT_YR_BLT", sqftCol: "TOT_LVG_AREA",
    situs: (r) => normalizeAddress(join(r.PHY_ADDR1, r.PHY_ADDR2, r.PHY_CITY)) },
  orange:   { county: "Orange",   file: "data/inbox/nal/orange-nal.zip",  zip: true, parcelCol: "PARCEL_ID", yearCol: "ACT_YR_BLT", sqftCol: "TOT_LVG_AREA",
    situs: (r) => normalizeAddress(join(r.PHY_ADDR1, r.PHY_ADDR2)) },
  pinellas: { county: "Pinellas", file: "data/inbox/pinellas/RP_PROPERTY_INFO.csv", parcelCol: "STRAP", yearCol: "YEAR_BUILT", sqftCol: "TOTAL_LIVING_SQFT",
    situs: (r) => normalizeAddress(join(r.SITE_ADDRESS, r.SITE_CITYZIP)) },
};

const NOW = new Date().getFullYear();
const BATCH = 1000;

// Make duplicate header names unique (Pinellas ships two YEAR_BUILT columns).
const uniqueColumns = (header: string[]): string[] => {
  const seen = new Map<string, number>();
  return header.map((h) => {
    const c = seen.get(h) ?? 0;
    seen.set(h, c + 1);
    return c === 0 ? h : `${h}_${c}`;
  });
};

function openStream(cfg: Cfg): NodeJS.ReadableStream {
  if (cfg.zip) {
    const entry = new AdmZip(cfg.file).getEntries().find((e) => /\.csv$/i.test(e.entryName));
    if (!entry) throw new Error(`No .csv inside ${cfg.file}`);
    console.log(`Reading ${entry.entryName} from zip…`);
    return Readable.from(entry.getData());
  }
  return fs.createReadStream(cfg.file);
}

async function main() {
  const key = process.argv[2]?.toLowerCase();
  const cfg = CONFIG[key];
  if (!cfg) {
    console.error("Usage: npx tsx scripts/backfill-building-data.ts <seminole|volusia|orange|pinellas>");
    process.exit(1);
  }
  if (!fs.existsSync(cfg.file)) throw new Error(`Source not found: ${cfg.file}`);

  const client = db();
  let rowsIn = 0, sent = 0, updated = 0, skipped = 0;
  let batch: { parcel: string | null; situs: string | null; yb: number | null; sqft: number | null }[] = [];

  async function flush() {
    if (batch.length === 0) return;
    const { data, error } = await client.rpc("backfill_building_data", { p_county: cfg.county, p_rows: batch });
    if (error) throw new Error(`backfill_building_data failed: ${error.message}`);
    updated += (data as number) ?? 0;
    sent += batch.length;
    if (sent % 50000 < BATCH) console.log(`  ${rowsIn} read, ${sent} candidates sent, ${updated} rows updated…`);
    batch = [];
  }

  const parser = openStream(cfg).pipe(
    parse({ columns: uniqueColumns, skip_empty_lines: true, bom: true, relax_column_count: true, trim: true })
  );

  for await (const rec of parser as AsyncIterable<Record<string, string>>) {
    rowsIn++;
    const parcel = (rec[cfg.parcelCol] ?? "").trim();
    const situs = cfg.situs ? cfg.situs(rec) || null : null;
    if (!parcel && !situs) { skipped++; continue; }
    const ybRaw = parseInt(rec[cfg.yearCol] ?? "", 10);
    const sqftRaw = parseInt(rec[cfg.sqftCol] ?? "", 10);
    const yb = !isNaN(ybRaw) && ybRaw >= 1800 && ybRaw <= NOW ? ybRaw : null;
    const sqft = !isNaN(sqftRaw) && sqftRaw > 0 ? sqftRaw : null;
    if (yb === null && sqft === null) { skipped++; continue; } // nothing to give
    batch.push({ parcel: parcel || null, situs, yb, sqft });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  console.log(`\n=== Backfill ${cfg.county} ===`);
  console.log(`source rows read:      ${rowsIn.toLocaleString()}`);
  console.log(`skipped (no parcel/value): ${skipped.toLocaleString()}`);
  console.log(`candidate rows sent:   ${sent.toLocaleString()}`);
  console.log(`properties updated:    ${updated.toLocaleString()}`);
  console.log(`Next: re-run scripts/check-field-coverage.ts to confirm coverage.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
