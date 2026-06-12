/**
 * Build a Pinellas address-points CSV from PCPAO's RP_PROPERTY_INFO (already
 * downloaded by fetch-pinellas.ts) for load-address-points.ts — used to
 * geocode NAL-created parcels that have no permit (permit rows get coords at
 * upsert time directly).
 *
 *   npx tsx scripts/export-pinellas-points.ts
 *   npx tsx scripts/load-address-points.ts pinellas data/inbox/pinellas-address-points.csv \
 *     --parcel STRAP --situs COMPLETE_ADDRESS --lng LONGITUDE --lat LATITUDE --usecode LAND_USE_CD --skip-join
 */
import fs from "node:fs";
import { parse } from "csv-parse";

const SRC = "data/inbox/pinellas/RP_PROPERTY_INFO.csv";
const OUT = "data/inbox/pinellas-address-points.csv";

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function main() {
  const out = fs.createWriteStream(OUT);
  out.write("STRAP,COMPLETE_ADDRESS,LATITUDE,LONGITUDE,LAND_USE_CD\n");
  let total = 0;
  const parser = fs.createReadStream(SRC).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }));
  for await (const r of parser as AsyncIterable<Record<string, string>>) {
    const lat = parseFloat(r.LATITUDE);
    const lng = parseFloat(r.LONGITUDE);
    if (isNaN(lat) || isNaN(lng) || !r.SITE_ADDRESS || !r.STRAP) continue;
    const address = `${r.SITE_ADDRESS}, ${r.SITE_CITYZIP ?? ""}`;
    out.write([r.STRAP, address, String(lat), String(lng), r.LAND_USE_CD ?? ""].map(csvCell).join(",") + "\n");
    total++;
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${total} address points -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
