/**
 * File adapter — the workhorse for records-request extracts (PRD: File adapter).
 *
 *   npm run ingest:file -- <jurisdiction-slug> data/inbox/<slug>/permits.csv
 *
 * Reads CSV. Column mapping + roof-filter rules live in
 * ingest/configs/<slug>.json (see ingest/configs/_example.json). XLSX or PDF
 * reports: export/extract to CSV first (agencies can export CSV; for PDFs use
 * e.g. pdfplumber), then run this.
 * Originals are archived to data/processed/<slug>/ after a successful run;
 * every raw row is preserved in raw_permits.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { jurisdictionId, startRun, finishRun, insertRawPermits, upsertPermitProperties, PermitUpsert } from "./lib/db";
import { normalizeAddress, streetNumber } from "./lib/normalize";

interface FileConfig {
  columns: {
    permit_number?: string;
    parcel_number?: string;
    situs_address: string;
    issue_date: string;
    status?: string;
    work_description?: string; // column the roof filter runs against
    lng?: string;
    lat?: string;
  };
  roof_filter?: string;          // regex over work_description (default: ROOF|RE-?ROOF)
  excluded_status?: string;      // regex (default: withdrawn|void|cancel|denied|revoked)
  date_format?: "iso" | "us";    // us = MM/DD/YYYY
}

function readRows(file: string): Record<string, string>[] {
  if (/\.(xlsx|xls)$/i.test(file)) {
    console.error("XLSX is no longer supported (vulnerable dependency removed). Export the file to CSV and re-run.");
    process.exit(1);
  }
  return parse(fs.readFileSync(file), {
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];
}

function parseDate(value: string, format: FileConfig["date_format"]): string | null {
  if (!value) return null;
  if (format === "us") {
    const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function main() {
  const [slug, file] = process.argv.slice(2);
  if (!slug || !file) {
    console.error("Usage: npm run ingest:file -- <jurisdiction-slug> <path/to/file.csv>");
    process.exit(1);
  }
  const configPath = path.join("ingest", "configs", `${slug}.json`);
  if (!fs.existsSync(configPath)) {
    console.error(`No mapping config at ${configPath}. Copy ingest/configs/_example.json and map the source columns.`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as FileConfig;
  const roofFilter = new RegExp(config.roof_filter ?? "ROOF|RE-?ROOF", "i");
  const excludedStatus = new RegExp(config.excluded_status ?? "withdrawn|void|cancel|denied|revoked", "i");

  const rows = readRows(file);
  console.log(`${rows.length} rows in ${file}`);
  const jid = await jurisdictionId(slug);
  const runId = await startRun(jid, `file:${path.basename(file)}`);
  let upserted = 0;
  let lowConfidence = 0;

  try {
    await insertRawPermits(jid, path.basename(file), rows);

    const permits: PermitUpsert[] = [];
    for (const row of rows) {
      const c = config.columns;
      const desc = c.work_description ? row[c.work_description] ?? "" : "";
      if (c.work_description && !roofFilter.test(desc)) continue;
      if (c.status && excludedStatus.test(row[c.status] ?? "")) continue;

      const situs = normalizeAddress(row[c.situs_address]);
      const date = parseDate(row[c.issue_date] ?? "", config.date_format ?? "iso");
      if (!situs || !date) {
        // never silently dropped: flagged for review
        lowConfidence++;
        console.warn(`  LOW CONFIDENCE (kept out, review): ${JSON.stringify(row).slice(0, 160)}`);
        continue;
      }
      permits.push({
        parcel_number: c.parcel_number ? row[c.parcel_number] || null : null,
        situs_address: situs,
        street_number: streetNumber(situs),
        lng: c.lng ? parseFloat(row[c.lng]) || null : null,
        lat: c.lat ? parseFloat(row[c.lat]) || null : null,
        permit_number: c.permit_number ? row[c.permit_number] || null : null,
        permit_date: date,
        geocode_method: c.lng ? "source_geocoded" : null,
      });
    }

    console.log(`${permits.length} roof permits matched filter; ${lowConfidence} low-confidence rows flagged above.`);
    upserted = await upsertPermitProperties(jid, permits);
    await finishRun(runId, "success", rows.length, upserted);

    const processedDir = path.join("data", "processed", slug);
    fs.mkdirSync(processedDir, { recursive: true });
    fs.renameSync(file, path.join(processedDir, `${Date.now()}-${path.basename(file)}`));
    console.log(`Done. ${upserted} upserted. Original archived to ${processedDir}/.`);
    console.log(`If this jurisdiction lacks coordinates, run the geocode join after loading county address points.`);
  } catch (err) {
    await finishRun(runId, "error", rows.length, upserted, String(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
