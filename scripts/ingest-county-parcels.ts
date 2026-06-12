/**
 * Generic owner-roll ingest from a normalized county-parcels CSV
 * (PARCEL,SITUS,CITY,LAT,LNG,OWNER,MAILING,HOMESTEAD,YEAR_BUILT,SQFT,USE) for
 * counties whose Property Appraiser publishes parcels with attributes in one
 * feed (Sumter AGOL, Marion MCPA, Lake FTP). Upserts owner attributes; the
 * accompanying coordinates are applied by load-address-points.ts on the same
 * CSV (parcel/situs geocode join). Permits add the real re-roof date later.
 *
 *   npx tsx scripts/ingest-county-parcels.ts <sumter|lake|marion> --file data/inbox/<county>-parcels.csv
 */
import fs from "node:fs";
import { parse } from "csv-parse";
import { db, jurisdictionId, startRun, finishRun } from "./lib/db";
import { normalizeAddress, streetNumber } from "./lib/normalize";
import { classifyOccupancy } from "./lib/occupancy";

interface Cfg { name: "Sumter" | "Lake" | "Marion"; fallback: string; cities: Record<string, string> }

const COUNTY: Record<string, Cfg> = {
  sumter: { name: "Sumter", fallback: "sumter-county", cities: {
    WILDWOOD: "wildwood", BUSHNELL: "bushnell", "CENTER HILL": "center-hill", COLEMAN: "coleman", WEBSTER: "webster" } },
  lake: { name: "Lake", fallback: "lake-county", cities: {
    "LADY LAKE": "lady-lake", "FRUITLAND PARK": "fruitland-park", LEESBURG: "leesburg", TAVARES: "tavares",
    "MOUNT DORA": "mount-dora", "MT DORA": "mount-dora", EUSTIS: "eustis", CLERMONT: "clermont", MINNEOLA: "minneola",
    GROVELAND: "groveland", MASCOTTE: "mascotte", MONTVERDE: "montverde", ASTATULA: "astatula",
    "HOWEY IN THE HILLS": "howey-in-the-hills", UMATILLA: "umatilla" } },
  marion: { name: "Marion", fallback: "marion-county", cities: {
    OCALA: "ocala", BELLEVIEW: "belleview", DUNNELLON: "dunnellon", MCINTOSH: "mcintosh", REDDICK: "reddick" } },
};

const BATCH = 1000;
const NOW = new Date().getFullYear();

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

async function main() {
  const key = process.argv[2]?.toLowerCase();
  const cfg = COUNTY[key];
  if (!cfg) { console.error("Usage: npx tsx scripts/ingest-county-parcels.ts <sumter|lake|marion> --file <csv>"); process.exit(1); }
  const file = arg("--file", `data/inbox/${key}-parcels.csv`);
  if (!fs.existsSync(file)) throw new Error(`Source not found: ${file}`);

  const slugToId = new Map<string, number>();
  for (const slug of [...new Set([...Object.values(cfg.cities), cfg.fallback])]) {
    try { slugToId.set(slug, await jurisdictionId(slug)); } catch { /* not seeded — ignore */ }
  }
  const fallbackId = slugToId.get(cfg.fallback);
  if (fallbackId === undefined) throw new Error(`Jurisdiction '${cfg.fallback}' not seeded — run migration 0012`);

  const runId = await startRun(fallbackId, `parcels:${key}`);
  let rowsIn = 0, upserted = 0;
  const occCounts = new Map<string, number>();
  let batch: Record<string, unknown>[] = [];

  async function flush() {
    if (batch.length === 0) return;
    const { data, error } = await db().rpc("upsert_owner_parcels", { p_rows: batch });
    if (error) throw new Error(`upsert_owner_parcels failed: ${error.message}`);
    upserted += (data as number) ?? 0;
    if (upserted % 20000 < BATCH) console.log(`  ${rowsIn} in, ${upserted} upserted…`);
    batch = [];
  }

  try {
    const parser = fs.createReadStream(file).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: true }));
    for await (const r of parser as AsyncIterable<Record<string, string>>) {
      rowsIn++;
      const city = (r.CITY ?? "").toUpperCase().trim();
      const situsRaw = [r.SITUS, city].filter(Boolean).join(" ");
      const situs = normalizeAddress(situsRaw);
      if (!situs || !/^\d/.test(situs)) continue;
      const homestead = r.HOMESTEAD === "1" || r.HOMESTEAD?.toLowerCase() === "true";
      const occupancy = classifyOccupancy(r.OWNER || null, homestead, r.MAILING || null, situsRaw);
      occCounts.set(occupancy, (occCounts.get(occupancy) ?? 0) + 1);
      const yb = parseInt(r.YEAR_BUILT || "", 10);
      const sqft = parseInt(r.SQFT || "", 10);
      const jid = slugToId.get(cfg.cities[city] ?? "") ?? fallbackId;

      batch.push({
        jurisdiction_id: jid,
        parcel_number: r.PARCEL || null,
        situs_address: situs,
        street_number: streetNumber(situs),
        owner_name: r.OWNER || null,
        owner_mailing: normalizeAddress(r.MAILING) || null,
        homestead,
        occupancy,
        year_built: isNaN(yb) || yb < 1800 || yb > NOW ? null : yb,
        building_sqft: isNaN(sqft) || sqft <= 0 ? null : sqft,
        dor_use_code: r.USE || null,
      });
      if (batch.length >= BATCH) await flush();
    }
    await flush();
    console.log(`\n=== Parcels ${cfg.name} ===`);
    console.log(`rows read:  ${rowsIn}`);
    console.log(`occupancy:`); for (const [k, v] of occCounts) console.log(`  ${k}: ${v}`);
    await finishRun(runId, "success", rowsIn, upserted);
    console.log(`${upserted} parcels upserted. Next: load-address-points for coords, then permits.`);
  } catch (err) {
    await finishRun(runId, "error", rowsIn, upserted, String(err));
    throw err;
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
