/**
 * FL DOR NAL (Name-Address-Legal) owner-roll loader — one standardized format
 * for all three counties (PRD: Owner & Occupancy Module).
 *
 *   npm run ingest:nal -- seminole --file data/inbox/nal/nal69f.zip
 *   npm run ingest:nal -- volusia  --url  "https://floridarevenue.com/.../NAL%2074%20...zip"
 *   npm run ingest:nal -- orange   --file data/inbox/nal/nal58f.csv --test
 *
 * Get the files from the FL DOR Property Tax Data Portal
 * (floridarevenue.com/property/dataportal): "NAL" files, county codes
 * Seminole=69, Volusia=74, Orange=58 (alphabetical DOR numbering).
 * County property appraiser downloads (SCPA/VCPA/OCPA) work too when fresher.
 *
 * Per parcel we load: owner name + mailing address, homestead flag, year
 * built, total living area (-> roofing squares), and classify occupancy.
 * --test parses + classifies 1,000 rows and prints the distribution, no writes.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import AdmZip from "adm-zip";
import { parse } from "csv-parse";
import { db, jurisdictionId, startRun, finishRun } from "./lib/db";
import { normalizeAddress, streetNumber } from "./lib/normalize";
import { classifyOccupancy } from "./lib/occupancy";

// situsCity: whether this county's existing properties.situs_address values
// include the city suffix (set by each county's permit ingest convention) —
// the NAL situs must match it for the (jurisdiction, situs) upsert to hit.
const COUNTY_INFO: Record<string, { name: "Seminole" | "Volusia" | "Orange" | "Pinellas"; dorCode: string; fallbackSlug: string; situsCity: boolean }> = {
  seminole: { name: "Seminole", dorCode: "69", fallbackSlug: "seminole-county", situsCity: true },
  volusia: { name: "Volusia", dorCode: "74", fallbackSlug: "volusia-county", situsCity: true },
  orange: { name: "Orange", dorCode: "58", fallbackSlug: "orange-county", situsCity: false },
  pinellas: { name: "Pinellas", dorCode: "62", fallbackSlug: "pinellas-county", situsCity: true },
};

// Situs-city -> jurisdiction slug. NOTE: postal city != municipal boundary
// (lots of unincorporated Orange County has an "ORLANDO" mailing city), so
// this is a grouping convenience, not a legal boundary; fine for map filters.
const CITY_SLUGS: Record<string, string> = {
  SANFORD: "sanford", OVIEDO: "oviedo", "LAKE MARY": "lake-mary",
  "ALTAMONTE SPRINGS": "altamonte-springs", CASSELBERRY: "casselberry",
  LONGWOOD: "longwood", "WINTER SPRINGS": "winter-springs",
  "DAYTONA BEACH": "daytona-beach", DELTONA: "deltona", "PORT ORANGE": "port-orange",
  "ORMOND BEACH": "ormond-beach", DELAND: "deland", "NEW SMYRNA BEACH": "new-smyrna-beach",
  EDGEWATER: "edgewater", DEBARY: "debary", "ORANGE CITY": "orange-city",
  "HOLLY HILL": "holly-hill", "SOUTH DAYTONA": "south-daytona",
  "DAYTONA BEACH SHORES": "daytona-beach-shores", "PONCE INLET": "ponce-inlet",
  "LAKE HELEN": "lake-helen", "OAK HILL": "oak-hill", PIERSON: "pierson",
  ORLANDO: "orlando", "WINTER PARK": "winter-park", APOPKA: "apopka", OCOEE: "ocoee",
  "WINTER GARDEN": "winter-garden", MAITLAND: "maitland", "BELLE ISLE": "belle-isle",
  EDGEWOOD: "edgewood", EATONVILLE: "eatonville", OAKLAND: "oakland",
  WINDERMERE: "windermere", "BAY LAKE": "bay-lake", "LAKE BUENA VISTA": "lake-buena-vista",
  // Pinellas (NOTE: city of Seminole -> seminole-city; seminole-county is the FL county)
  "ST PETERSBURG": "st-petersburg", "SAINT PETERSBURG": "st-petersburg",
  CLEARWATER: "clearwater", LARGO: "largo", "PINELLAS PARK": "pinellas-park",
  DUNEDIN: "dunedin", "TARPON SPRINGS": "tarpon-springs",
  "ST PETE BEACH": "st-pete-beach", "ST PETERSBURG BEACH": "st-pete-beach",
  "TREASURE ISLAND": "treasure-island", GULFPORT: "gulfport", SEMINOLE: "seminole-city",
  "SAFETY HARBOR": "safety-harbor", OLDSMAR: "oldsmar", "MADEIRA BEACH": "madeira-beach",
  BELLEAIR: "belleair", "SOUTH PASADENA": "south-pasadena",
  "REDINGTON SHORES": "redington-shores", "INDIAN ROCKS BEACH": "indian-rocks-beach",
  "INDIAN SHORES": "indian-shores", "KENNETH CITY": "kenneth-city",
  "REDINGTON BEACH": "redington-beach", "NORTH REDINGTON BEACH": "north-redington-beach",
  "BELLEAIR BEACH": "belleair-beach", "BELLEAIR BLUFFS": "belleair-bluffs",
};

// NAL column names (standard DOR layout). If a year's layout shifts, fix here.
const COL = {
  parcel: "PARCEL_ID",
  ownerName: "OWN_NAME",
  ownAddr1: "OWN_ADDR1",
  ownAddr2: "OWN_ADDR2",
  ownCity: "OWN_CITY",
  ownState: "OWN_STATE",
  ownZip: "OWN_ZIPCD",
  physAddr1: "PHY_ADDR1",
  physAddr2: "PHY_ADDR2",
  physCity: "PHY_CITY",
  yearBuilt: "ACT_YR_BLT",
  effYearBuilt: "EFF_YR_BLT",
  livingArea: "TOT_LVG_AREA",
  useCode: "DOR_UC",
  // homestead: assessed/just value attributable to homestead > 0
  homesteadValue: ["JV_HMSTD", "AV_HMSTD"],
} as const;

const BATCH = 1000;

interface NalRecord {
  [k: string]: string;
}

function isResidential(useCode: string): boolean {
  const n = parseInt(useCode, 10);
  return !isNaN(n) && n >= 0 && n <= 9; // DOR use codes 000-009 = residential
}

function openCsvStream(file: string): NodeJS.ReadableStream {
  if (file.toLowerCase().endsWith(".zip")) {
    const zip = new AdmZip(file);
    const entry = zip.getEntries().find((e) => /\.csv$/i.test(e.entryName));
    if (!entry) throw new Error(`No .csv entry found inside ${file}`);
    console.log(`Reading ${entry.entryName} from zip…`);
    return Readable.from(entry.getData());
  }
  return fs.createReadStream(file);
}

async function download(url: string, dest: string): Promise<string> {
  console.log(`Downloading ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`Saved ${(buf.length / 1e6).toFixed(1)} MB to ${dest}`);
  return dest;
}

async function main() {
  const args = process.argv.slice(2);
  const county = args[0]?.toLowerCase();
  const info = COUNTY_INFO[county];
  if (!info) {
    console.error("Usage: npm run ingest:nal -- <seminole|volusia|orange> [--file path | --url url] [--test] [--all-uses]");
    process.exit(1);
  }
  const fileIdx = args.indexOf("--file");
  const urlIdx = args.indexOf("--url");
  const isTest = args.includes("--test");
  const allUses = args.includes("--all-uses");

  let file: string;
  if (fileIdx >= 0) {
    file = args[fileIdx + 1];
  } else if (urlIdx >= 0) {
    file = await download(args[urlIdx + 1], `data/inbox/nal/${county}-nal.zip`);
  } else {
    console.error(
      `No --file or --url given. Download the ${info.name} County NAL file (county code ${info.dorCode}) from\n` +
        `https://floridarevenue.com/property/dataportal and pass it with --file.`
    );
    process.exit(1);
  }

  // Resolve jurisdiction ids up front (--test never touches the database)
  const slugToId = new Map<string, number>();
  let fallbackId = -1;
  if (!isTest) {
    for (const slug of [...new Set([...Object.values(CITY_SLUGS), info.fallbackSlug])]) {
      try {
        slugToId.set(slug, await jurisdictionId(slug));
      } catch {
        /* slug from another county not in this run — ignore */
      }
    }
    fallbackId = slugToId.get(info.fallbackSlug)!;
  }

  const runId = isTest ? -1 : await startRun(fallbackId, `nal:${county}`);
  let rowsIn = 0;
  let upserted = 0;
  let skippedUse = 0;
  const occCounts = new Map<string, number>();
  let batch: Record<string, unknown>[] = [];

  async function flush() {
    if (batch.length === 0) return;
    const { data, error } = await db().rpc("upsert_owner_parcels", { p_rows: batch });
    if (error) throw new Error(`upsert_owner_parcels failed: ${error.message}`);
    upserted += (data as number) ?? 0;
    if (upserted % 20000 < BATCH) console.log(`  ${rowsIn} rows in, ${upserted} upserted…`);
    batch = [];
  }

  try {
    const parser = openCsvStream(file).pipe(
      parse({ columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, bom: true })
    );

    for await (const rec of parser as AsyncIterable<NalRecord>) {
      rowsIn++;
      const useCode = rec[COL.useCode] ?? "";
      if (!allUses && !isResidential(useCode)) {
        skippedUse++;
        continue;
      }
      const situsRaw = [rec[COL.physAddr1], rec[COL.physAddr2], info.situsCity ? rec[COL.physCity] : null]
        .filter(Boolean)
        .join(" ");
      const situs = normalizeAddress(situsRaw);
      if (!situs || !/^\d/.test(situs)) continue; // no usable street address

      const ownerMailing = [rec[COL.ownAddr1], rec[COL.ownAddr2], rec[COL.ownCity], rec[COL.ownState], rec[COL.ownZip]]
        .filter(Boolean)
        .join(" ");
      const hmstdVal = COL.homesteadValue.map((c) => parseFloat(rec[c] ?? "0")).find((v) => !isNaN(v) && v > 0);
      const homestead = (hmstdVal ?? 0) > 0;
      const occupancy = classifyOccupancy(rec[COL.ownerName] ?? null, homestead, ownerMailing, situsRaw);
      occCounts.set(occupancy, (occCounts.get(occupancy) ?? 0) + 1);

      const yearBuilt = parseInt(rec[COL.yearBuilt] || rec[COL.effYearBuilt] || "", 10);
      const sqft = parseInt(rec[COL.livingArea] || "", 10);
      const city = (rec[COL.physCity] ?? "").toUpperCase().trim();
      const jid = slugToId.get(CITY_SLUGS[city] ?? "") ?? fallbackId;

      if (isTest) {
        if (rowsIn <= 5) console.log(JSON.stringify({ situs, owner: rec[COL.ownerName], homestead, occupancy, yearBuilt, sqft }));
        if (rowsIn >= 1000) break;
        continue;
      }

      batch.push({
        jurisdiction_id: jid,
        parcel_number: rec[COL.parcel] ?? null,
        situs_address: situs,
        street_number: streetNumber(situs),
        owner_name: rec[COL.ownerName] ?? null,
        owner_mailing: normalizeAddress(ownerMailing) || null,
        homestead,
        occupancy,
        year_built: isNaN(yearBuilt) || yearBuilt < 1800 ? null : yearBuilt,
        building_sqft: isNaN(sqft) || sqft <= 0 ? null : sqft,
        dor_use_code: useCode || null,
      });
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    console.log(`\n=== NAL ${info.name} ${isTest ? "(test sample)" : ""} ===`);
    console.log(`rows read:          ${rowsIn}`);
    console.log(`skipped non-resid.: ${skippedUse}`);
    console.log(`occupancy distribution:`);
    for (const [k, v] of occCounts) console.log(`  ${k}: ${v}`);
    if (isTest) {
      console.log("(no database writes in --test mode)");
    } else {
      await finishRun(runId, "success", rowsIn, upserted);
      console.log(`${upserted} parcels upserted.`);
      console.log(`Next: load address points + run geocode join for permit-less parcels (scripts/load-address-points.ts).`);
    }
  } catch (err) {
    if (!isTest) await finishRun(runId, "error", rowsIn, upserted, String(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
