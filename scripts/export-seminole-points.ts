/**
 * Build a Seminole address-points CSV from the SCPA parcels export
 * (seminole-parcels.csv) for load-address-points.ts — geocodes NAL-created
 * parcels that have no permit. The SCPA PrimaryAddress carries a trailing
 * "<CITY> FL <ZIP>"; we strip the " FL <ZIP>" tail so the situs matches the
 * NAL situs convention (addr + city, no state/zip). The 17-char Parcel also
 * matches the NAL parcel format directly, so either join key can hit.
 *
 *   npx tsx scripts/export-seminole-points.ts
 *   npx tsx scripts/load-address-points.ts seminole data/inbox/seminole-address-points.csv \
 *     --parcel PARCEL --situs SITUS --lng LON --lat LAT --usecode USE --skip-join
 */
import fs from "node:fs";
import { parse } from "csv-parse";

const SRC = "data/inbox/seminole-parcels.csv";
const OUT = "data/inbox/seminole-address-points.csv";

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
// Strip a trailing " FL 32746" / " FL 32746-1234" (any 2-letter state) so the
// situs ends at the city, matching how the NAL situs was stored.
const stripStateZip = (s: string) => s.replace(/\s+[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/i, "").trim();

async function main() {
  const out = fs.createWriteStream(OUT);
  out.write("PARCEL,SITUS,LAT,LON,USE\n");
  let total = 0;
  const parser = fs.createReadStream(SRC).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }));
  for await (const r of parser as AsyncIterable<Record<string, string>>) {
    const lat = parseFloat(r.Latitude);
    const lng = parseFloat(r.Longitude);
    if (isNaN(lat) || isNaN(lng) || !r.PrimaryAddress || !r.Parcel) continue;
    const situs = stripStateZip(r.PrimaryAddress);
    out.write([r.Parcel, situs, String(lat), String(lng), r.DORCode ?? ""].map(csvCell).join(",") + "\n");
    total++;
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${total} address points -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
