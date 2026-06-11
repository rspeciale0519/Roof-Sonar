/**
 * Download the Pinellas PA (pcpao.gov) nightly bulk files needed for ingest:
 * RP_PERMITS + RP_PROPERTY_INFO (CSV zips) and the parcel label-point
 * shapefile (per-parcel centroids, EPSG:2882). No auth required; files are
 * rebuilt nightly.
 *
 *   npx tsx scripts/fetch-pinellas.ts
 */
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const DIR = path.join("data", "inbox", "pinellas");

async function download(url: string, body: string, dest: string): Promise<void> {
  console.log(`downloading ${path.basename(dest)}…`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  ${(buf.length / 1048576).toFixed(1)} MB`);
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const tbl of ["RP_PERMITS", "RP_PROPERTY_INFO"]) {
    const zipPath = path.join(DIR, `${tbl}_csv.zip`);
    await download(
      "https://www.pcpao.gov/dal/databasefile/downloadDatabaseFile",
      `hdn_tbl_name=${tbl}&hdn_ftype=csv`,
      zipPath
    );
    new AdmZip(zipPath).extractAllTo(DIR, true);
  }
  await download("https://www.pcpao.gov/dal/shapefile/downloadParcelLabel", "", path.join(DIR, "Parcel_Label_Point.zip"));
  new AdmZip(path.join(DIR, "Parcel_Label_Point.zip")).extractAllTo(path.join(DIR, "label-points"), true);
  console.log("Done. Files in", DIR);
  for (const f of fs.readdirSync(DIR)) console.log(" ", f);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
