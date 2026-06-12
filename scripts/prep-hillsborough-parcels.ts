/**
 * Build the normalized Hillsborough parcels CSV from the HCPA public shapefile
 * download (fetch-hillsborough-files.ps1): parcel_4_public.dbf carries the
 * attributes (folio, situs, owner, ACT/EFF year, HEAT_AR living area, DOR_CODE)
 * and latlon.dbf carries folio -> WGS84 lat/lon (the .shp geometry is State
 * Plane, so we use the published lat/lon instead of reprojecting). Joined by
 * FOLIO into the CSV consumed by ingest-county-parcels.ts + load-address-points.
 *
 *   pwsh scripts/fetch-hillsborough-files.ps1   # download first
 *   npx tsx scripts/prep-hillsborough-parcels.ts
 */
import fs from "node:fs";
import * as shapefile from "shapefile";

const DIR = "data/inbox/hillsborough";
const OUT = "data/inbox/hillsborough-parcels.csv";
const NOW = new Date().getFullYear();
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const s = (v: unknown) => (v == null ? "" : String(v).trim());

async function main() {
  // 1) folio -> lat/lon
  const coords = new Map<string, [number, number]>();
  const ll = await shapefile.openDbf(`${DIR}/latlon.dbf`);
  for (;;) {
    const r = await ll.read();
    if (r.done) break;
    const p = r.value as { FOLIO?: string; lat?: number; lon?: number };
    const lat = Number(p.lat), lng = Number(p.lon);
    if (p.FOLIO && Number.isFinite(lat) && Number.isFinite(lng)) coords.set(s(p.FOLIO), [lat, lng]);
  }
  console.log(`latlon: ${coords.size.toLocaleString()} folios`);

  // 2) parcels -> normalized CSV with joined coords
  const out = fs.createWriteStream(OUT);
  out.write("PARCEL,SITUS,CITY,LAT,LNG,OWNER,MAILING,HOMESTEAD,YEAR_BUILT,SQFT,USE\n");
  const src = await shapefile.openDbf(`${DIR}/parcel_4_public.dbf`);
  let total = 0, written = 0, withCoords = 0;
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    total++;
    const p = r.value as Record<string, unknown>;
    const folio = s(p.FOLIO);
    const situs = s(p.SITE_ADDR);
    if (!folio || !situs) continue;
    const c = coords.get(folio);
    if (c) withCoords++;
    const mailing = [p.ADDR_1, p.ADDR_2, p.CITY, p.STATE, p.ZIP].map(s).filter(Boolean).join(" ");
    const ybRaw = parseInt(s(p.ACT) || s(p.EFF) || "", 10);
    const year = !isNaN(ybRaw) && ybRaw >= 1800 && ybRaw <= NOW ? String(ybRaw) : "";
    const sqftRaw = parseInt(s(p.HEAT_AR) || "", 10);
    const sqft = !isNaN(sqftRaw) && sqftRaw > 0 ? String(sqftRaw) : "";
    const useRaw = s(p.DOR_CODE);
    const use = /^\d+$/.test(useRaw) && useRaw.length >= 2 ? useRaw.slice(0, 2) : useRaw;
    out.write([folio, situs, s(p.SITE_CITY), c ? String(c[0]) : "", c ? String(c[1]) : "",
      s(p.OWNER), mailing, "0", year, sqft, use].map(csvCell).join(",") + "\n");
    written++;
    if (written % 50000 === 0) console.log(`  ${written} written…`);
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${written}/${total} parcels (${withCoords} with coords) -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
