/**
 * Pinellas county-wide ingest from the PCPAO nightly bulk files (all 24
 * jurisdictions in one feed; dedicated ROOF permit type code).
 *
 *   1. npx tsx scripts/fetch-pinellas.ts     (RP_PERMITS + RP_PROPERTY_INFO)
 *   2. npx tsx scripts/ingest-pinellas.ts    (this script)
 *
 * RP_PROPERTY_INFO carries per-parcel LATITUDE/LONGITUDE (WGS84), so
 * properties are geocoded at upsert time — no address-point join needed.
 * properties.parcel_number gets the 18-digit STRAP (PCPAO's join key).
 */
import fs from "node:fs";
import { parse } from "csv-parse";
import { db, jurisdictionId, startRun, finishRun, insertRawPermits, upsertPermitProperties, PermitUpsert } from "./lib/db";
import { normalizeAddress, streetNumber } from "./lib/normalize";
import { sinceArg } from "./lib/since";

const DIR = "data/inbox/pinellas";
const NULL_DATE = /^1899-/;

const AGENCY_TO_SLUG: Record<string, string> = {
  "County": "pinellas-county",
  "St Petersburg": "st-petersburg",
  "Clearwater": "clearwater",
  "Largo": "largo",
  "Pinellas Park": "pinellas-park",
  "Dunedin": "dunedin",
  "Tarpon Springs": "tarpon-springs",
  "St Pete Beach": "st-pete-beach",
  "Treasure Island": "treasure-island",
  "Gulfport": "gulfport",
  "Seminole": "seminole-city",
  "Safety Harbor": "safety-harbor",
  "Oldsmar": "oldsmar",
  "Madeira Beach": "madeira-beach",
  "Belleair": "belleair",
  "South Pasadena": "south-pasadena",
  "Redington Shores": "redington-shores",
  "Indian Rocks Beach": "indian-rocks-beach",
  "Indian Shores": "indian-shores",
  "Kenneth City": "kenneth-city",
  "Redington Beach": "redington-beach",
  "North Redington Beach": "north-redington-beach",
  "Belleair Beach": "belleair-beach",
  "Belleair Bluffs": "belleair-bluffs",
};

interface ParcelInfo { situs: string | null; luc: string | null; lat: number | null; lng: number | null }

async function streamCsv(file: string, onRow: (row: Record<string, string>) => void): Promise<number> {
  const parser = fs.createReadStream(file).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }));
  let n = 0;
  for await (const row of parser) {
    onRow(row as Record<string, string>);
    n++;
  }
  return n;
}

async function main() {
  const since = sinceArg(); // weekly cron passes --since 90d to skip old permits
  if (since) console.log(`Incremental: only permits issued on/after ${since}`);

  // 1. per-parcel attributes (situs, use code, coordinates)
  const parcels = new Map<string, ParcelInfo>();
  const nInfo = await streamCsv(`${DIR}/RP_PROPERTY_INFO.csv`, (r) => {
    const lat = parseFloat(r.LATITUDE);
    const lng = parseFloat(r.LONGITUDE);
    const situs = r.SITE_ADDRESS && r.SITE_CITYZIP ? normalizeAddress(`${r.SITE_ADDRESS}, ${r.SITE_CITYZIP}`) : null;
    parcels.set(r.STRAP, {
      situs: situs || null,
      luc: (r.LAND_USE_CD || "").trim() || null,
      lat: isNaN(lat) ? null : lat,
      lng: isNaN(lng) ? null : lng,
    });
  });
  console.log(`${nInfo} parcel-info rows -> ${parcels.size} parcels mapped`);

  // 2. roof permits joined to parcels
  const seen = new Set<string>();
  const stats = { notRoof: 0, badDate: 0, old: 0, noParcel: 0, noSitus: 0, unknownAgency: 0, dupes: 0 };
  type Joined = { slug: string; raw: Record<string, string>; upsert: PermitUpsert; luc: string | null };
  const bySlug = new Map<string, Joined[]>();
  const unknownAgencies = new Map<string, number>();

  const nPermits = await streamCsv(`${DIR}/RP_PERMITS.csv`, (r) => {
    if (r.PERMIT_TYPE !== "96" && !/ROOF/i.test(r.PERMIT_DSCR ?? "")) { stats.notRoof++; return; }
    const date = (r.ISSUE_DT ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || NULL_DATE.test(date)) { stats.badDate++; return; }
    if (since && date < since) { stats.old++; return; }
    const key = `${r.STRAP}|${r.PERMIT_NUMBER}`;
    if (seen.has(key)) { stats.dupes++; return; }
    seen.add(key);
    const slug = AGENCY_TO_SLUG[(r.AGENCY_NAME ?? "").trim()];
    if (!slug) { stats.unknownAgency++; unknownAgencies.set(r.AGENCY_NAME, (unknownAgencies.get(r.AGENCY_NAME) ?? 0) + 1); return; }
    const parcel = parcels.get(r.STRAP);
    if (!parcel) { stats.noParcel++; return; }
    if (!parcel.situs) { stats.noSitus++; return; }

    const joined: Joined = {
      slug,
      luc: parcel.luc,
      raw: r,
      upsert: {
        parcel_number: r.STRAP,
        situs_address: parcel.situs,
        street_number: streetNumber(parcel.situs),
        lng: parcel.lng,
        lat: parcel.lat,
        permit_number: r.PERMIT_NUMBER || null,
        permit_date: date,
        geocode_method: parcel.lng != null ? "source_geocoded" : null,
      },
    };
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug)!.push(joined);
  });
  const total = [...bySlug.values()].reduce((a, b) => a + b.length, 0);
  console.log(`${nPermits} permit rows -> ${total} roof permits joined`, stats);
  if (unknownAgencies.size) console.log("unknown agencies:", Object.fromEntries(unknownAgencies));

  // 3. upsert per jurisdiction
  const runId = await startRun(null, "pinellas-pcpao:RP_PERMITS+RP_PROPERTY_INFO");
  let totalUpserted = 0;
  try {
    for (const [slug, rows] of [...bySlug.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const jid = await jurisdictionId(slug);
      await insertRawPermits(jid, "RP_PERMITS.csv", rows.map((r) => r.raw));

      const CONC = 12;
      let upserted = 0;
      for (let i = 0; i < rows.length; i += CONC) {
        const counts = await Promise.all(rows.slice(i, i + CONC).map((r) => upsertPermitProperties(jid, [r.upsert])));
        upserted += counts.reduce((a, b) => a + b, 0);
        if (i > 0 && i % 24000 < CONC) console.log(`  ${slug}: ${i}/${rows.length}`);
      }
      totalUpserted += upserted;
      console.log(`${slug}: ${upserted}/${rows.length} upserted`);

      // dor_use_code backfill batched by LUC
      const byLuc = new Map<string, Set<string>>();
      for (const r of rows) {
        if (!r.luc || !r.upsert.parcel_number) continue;
        if (!byLuc.has(r.luc)) byLuc.set(r.luc, new Set());
        byLuc.get(r.luc)!.add(r.upsert.parcel_number);
      }
      for (const [luc, parcelSet] of byLuc) {
        const uniq = [...parcelSet];
        for (let i = 0; i < uniq.length; i += 200) {
          const { error } = await db()
            .from("properties")
            .update({ dor_use_code: luc })
            .eq("jurisdiction_id", jid)
            .is("dor_use_code", null)
            .in("parcel_number", uniq.slice(i, i + 200));
          if (error) console.error(`  use-code update failed (${slug}/${luc}): ${error.message}`);
        }
      }
    }
    await finishRun(runId, "success", nPermits, totalUpserted);
    console.log(`Done. ${totalUpserted} roof permits upserted across ${bySlug.size} jurisdictions (coordinates included — no geocode join needed).`);
  } catch (err) {
    await finishRun(runId, "error", nPermits, totalUpserted, String(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
