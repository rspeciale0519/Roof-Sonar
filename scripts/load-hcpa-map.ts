/**
 * One-time (refresh-occasionally) load of the HCPA STRAP<->FOLIO map into the
 * hcpa_parcel_map table from the local parcel dbf, so the cloud Tampa ingest +
 * Hillsborough scraper don't need the dbf. Re-run after a fresh HCPA parcel pull.
 *
 *   pwsh scripts/fetch-hillsborough-files.ps1   # refresh the dbf first (optional)
 *   npx tsx scripts/load-hcpa-map.ts
 */
import * as shapefile from "shapefile";
import { sql } from "./lib/sql";

const DBF = "data/inbox/hillsborough/parcel_4_public.dbf";
const BATCH = 4000;
const esc = (s: string) => s.replace(/'/g, "''");

async function main() {
  const rows: [string, string][] = [];
  const src = await shapefile.openDbf(DBF);
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const v = r.value as { STRAP?: string; FOLIO?: string };
    if (v.STRAP && v.FOLIO) rows.push([String(v.STRAP).trim(), String(v.FOLIO).trim()]);
  }
  console.log(`${rows.length.toLocaleString()} STRAP/FOLIO pairs from dbf`);

  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const vals = rows.slice(i, i + BATCH).map(([s, f]) => `('${esc(s)}','${esc(f)}')`).join(",");
    await sql(`insert into hcpa_parcel_map (strap, folio) values ${vals} on conflict (strap) do update set folio = excluded.folio`);
    done += Math.min(BATCH, rows.length - i);
    if (i % 40000 < BATCH) console.log(`  ${done.toLocaleString()}/${rows.length.toLocaleString()}`);
  }
  console.log(`Done: ${done.toLocaleString()} rows in hcpa_parcel_map.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
