/**
 * Volusia County (unincorporated) OPEN permits — ArcGIS REST adapter over the
 * AMANDA "CurrentProjects" layer (VERIFIED endpoint, OPEN permits only; the
 * historical issued-permit backfill comes via records request).
 *
 *   npm run ingest:volusia-api -- --verify-vocab   # distinct FOLDERTYPE/FOLDERDESCRIPTION values — run FIRST
 *   npm run ingest:volusia-api -- --test           # fetch + analyze roof-filtered sample, NO db writes
 *   npm run ingest:volusia-api                     # ingest roof permits currently open
 *
 * Geometry: parcel polygons in WKID 2881, reprojected server-side to 4326 via
 * outSR. This MapServer ignores returnCentroid, so we compute the centroid
 * client-side from the polygon's bounding box.
 *
 * Field mapping (verified against live records 2026-06-09):
 *   FOLDERNAME      = situs address + ", CITY ZIP" tail (e.g. "1621 GLENWOOD Road, DELAND 32720")
 *   REFERENCEFILE   = permit number (e.g. "20260226007")
 *   FOLDERDESCRIPTION = free-text scope of work
 */
import { jurisdictionId, startRun, finishRun, insertRawPermits, upsertPermitProperties, PermitUpsert } from "./lib/db";
import { normalizeAddress, streetNumber } from "./lib/normalize";

const LAYER = "https://maps5.vcgov.org/arcgis/rest/services/CurrentProjects/MapServer/1/query";
const PAGE_SIZE = 1000;
// Verified via --verify-vocab (2026-06-09): AMANDA uses a dedicated ROOF folder
// type. Description LIKE '%ROOF%' was too noisy — it matched roof-mounted solar,
// remodels with roof scope, fire repairs, etc.
const ROOF_WHERE = `FOLDERTYPE = 'ROOF'`;
const EXCLUDED_STATUS = /withdrawn|void|cancel|denied|revoked|closed/i;

interface VolusiaAttrs {
  FOLDERTYPE?: string;
  FOLDERNAME?: string;
  FOLDERDESCRIPTION?: string;
  INDATE?: number | string; // epoch ms in ArcGIS JSON
  STATUSDESC?: string;
  PID?: string;
  REFERENCEFILE?: string;
  [k: string]: unknown;
}

interface VolusiaFeature {
  attributes: VolusiaAttrs;
  geometry?: { rings?: number[][][] };
}

/** Bbox midpoint of the parcel polygon's outer ring — close enough for a pin. */
function ringCentroid(geometry?: { rings?: number[][][] }): { x: number; y: number } | null {
  const ring = geometry?.rings?.[0];
  if (!ring || ring.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** "1621 GLENWOOD Road, DELAND 32720" -> "1621 GLENWOOD Road" */
function stripCityZip(folderName: string): string {
  return folderName.replace(/,\s*[A-Z .'-]+\s+\d{5}(-\d{4})?\s*$/i, "");
}

async function arcgis(params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ f: "json", ...params });
  const res = await fetch(`${LAYER}?${qs}`);
  if (!res.ok) throw new Error(`ArcGIS ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (json.error) throw new Error(`ArcGIS error: ${JSON.stringify(json.error)}`);
  return json;
}

async function verifyVocab(): Promise<void> {
  console.log("Layer metadata (fields):");
  const metaRes = await fetch(`${LAYER.replace(/\/query$/, "")}?f=json`);
  const meta = (await metaRes.json()) as { fields?: { name: string; type: string }[] };
  for (const f of meta.fields ?? []) console.log(`  ${f.name} (${f.type})`);

  for (const field of ["FOLDERTYPE", "FOLDERDESCRIPTION"]) {
    console.log(`\nDistinct ${field} values:`);
    // NB: this server 400s on returnDistinctValues + resultRecordCount unless
    // orderByFields is also set, so let it return the full distinct set.
    const json = (await arcgis({
      where: "1=1",
      outFields: field,
      returnDistinctValues: "true",
      returnGeometry: "false",
    })) as { features?: { attributes: Record<string, string> }[] };
    const values = (json.features ?? []).map((f) => f.attributes[field]).filter(Boolean).sort();
    for (const v of values) {
      const marker = /roof/i.test(v) ? "  <-- ROOF MATCH" : "";
      console.log(`  ${v}${marker}`);
    }
  }
  console.log(
    "\nReview the ROOF MATCH lines above. If the vocabulary differs from LIKE '%ROOF%', update ROOF_WHERE in this script."
  );
}

async function fetchRoofPage(offset: number): Promise<VolusiaFeature[]> {
  const json = (await arcgis({
    where: ROOF_WHERE,
    outFields: "*",
    returnGeometry: "true",
    outSR: "4326",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
  })) as { features?: VolusiaFeature[] };
  return json.features ?? [];
}

function toPermit(f: VolusiaFeature): PermitUpsert | null {
  const a = f.attributes;
  if (a.STATUSDESC && EXCLUDED_STATUS.test(a.STATUSDESC)) return null;
  const situs = normalizeAddress(stripCityZip(a.FOLDERNAME ?? ""));
  if (!situs) return null;
  const inDate = typeof a.INDATE === "number" ? new Date(a.INDATE) : a.INDATE ? new Date(a.INDATE) : null;
  if (!inDate || isNaN(inDate.getTime())) return null;
  const centroid = ringCentroid(f.geometry);
  return {
    parcel_number: a.PID ?? null,
    situs_address: situs,
    street_number: streetNumber(situs),
    lng: centroid?.x ?? null,
    lat: centroid?.y ?? null,
    permit_number: a.REFERENCEFILE ?? null,
    permit_date: inDate.toISOString().slice(0, 10),
    geocode_method: centroid ? "parcel_centroid" : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--verify-vocab")) {
    await verifyVocab();
    return;
  }

  const isTest = args.includes("--test");
  if (isTest) {
    const features = await fetchRoofPage(0);
    console.log(`Fetched ${features.length} roof-matched open permits.`);
    const permits = features.map(toPermit).filter(Boolean) as PermitUpsert[];
    console.log(`Usable: ${permits.length}. First 5:`);
    for (const p of permits.slice(0, 5)) console.log(" ", JSON.stringify(p));
    console.log("(no database writes in --test mode)");
    return;
  }

  const jid = await jurisdictionId("volusia-county");
  const runId = await startRun(jid, "volusia:arcgis-open-permits");
  let rowsIn = 0;
  let upserted = 0;
  try {
    let offset = 0;
    for (;;) {
      const features = await fetchRoofPage(offset);
      if (features.length === 0) break;
      rowsIn += features.length;
      await insertRawPermits(jid, "arcgis:CurrentProjects/1", features.map((f) => f.attributes));
      const permits = features.map(toPermit).filter(Boolean) as PermitUpsert[];
      upserted += await upsertPermitProperties(jid, permits);
      console.log(`  offset ${offset}: ${features.length} in, ${permits.length} usable`);
      if (features.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    await finishRun(runId, "success", rowsIn, upserted);
    console.log(`Done. ${rowsIn} rows in, ${upserted} upserted.`);
  } catch (err) {
    await finishRun(runId, "error", rowsIn, upserted, String(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
