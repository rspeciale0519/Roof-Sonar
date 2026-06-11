/**
 * Volusia county-wide ingest from the VCPA weekly CAMA export (all 16 cities
 * + unincorporated in one source — supersedes per-city records requests).
 *
 *   1. pwsh scripts/export-volusia-cama.ps1        (Access -> 3 CSVs)
 *   2. npx tsx scripts/ingest-volusia-cama.ts      (this script)
 *   3. load Volusia address points + geocode join  (CAMA has no coordinates)
 *
 * PARID is the VCPA altkey; properties.parcel_number gets DORID (the county
 * parcel number) so the address-point geocode join can match on it later.
 */
import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { db, jurisdictionId, startRun, finishRun, insertRawPermits, upsertPermitProperties, PermitUpsert } from "./lib/db";
import { normalizeAddress, streetNumber } from "./lib/normalize";

const DIR = "data/inbox/volusia-cama";
const ROOF_INCLUDE = /ROOF/i;
const ROOF_EXCLUDE = /SOLAR|PHOTOVOLT|\bPV\b|GENERATOR|SIGN\b|AWNING|SCREEN\s+(ROOM|ENCL)/i;
const REROOF = /RE-?ROOF|ROOF\s*REPLAC|ROOF\s*OVER/i;
const EXCLUDED_STATUS = /withdrawn|void|cancel|denied|revoked/i;

const DISTRICT_TO_SLUG: Record<string, string> = {
  "DELTONA": "deltona",
  "DAYTONA BEACH": "daytona-beach",
  "NEW SMYRNA BEACH": "new-smyrna-beach",
  "ORMOND BEACH": "ormond-beach",
  "PORT ORANGE": "port-orange",
  "DELAND": "deland",
  "EDGEWATER": "edgewater",
  "DEBARY": "debary",
  "DAYTONA BEACH SHORES": "daytona-beach-shores",
  "HOLLY HILL": "holly-hill",
  "SOUTH DAYTONA": "south-daytona",
  "ORANGE CITY": "orange-city",
  "PONCE INLET": "ponce-inlet",
  "OAK HILL": "oak-hill",
  "LAKE HELEN": "lake-helen",
  "PIERSON": "pierson",
};

function slugFor(district: string): string | null {
  const d = (district ?? "").trim().toUpperCase();
  if (d.startsWith("UNINCORPORATED")) return "volusia-county";
  if (d in DISTRICT_TO_SLUG) return DISTRICT_TO_SLUG[d];
  return null; // out-of-county slivers (e.g. FLAGLER BEACH)
}

function readCsv(name: string): Record<string, string>[] {
  return parse(fs.readFileSync(`${DIR}/${name}.csv`), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
}

function parseUsDate(value: string): string | null {
  const m = (value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

interface SitusRow { PARID: string; OWNSEQ: string; ADRNO: string; ADRADD: string; ADRDIR: string; ADRSTR: string; ADRSUF: string; ADRSUF2: string; UNITDESC: string; UNITNO: string; CITYNAME: string; ZIP1: string }

function composeSitus(s: SitusRow): string | null {
  const street = [s.ADRNO ? `${s.ADRNO}${s.ADRADD ?? ""}` : "", s.ADRDIR, s.ADRSTR, s.ADRSUF, s.ADRSUF2]
    .map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
  if (!street || !s.ADRSTR) return null;
  const unit = [s.UNITDESC, s.UNITNO].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
  const zip = (s.ZIP1 ?? "").trim().slice(0, 5);
  const city = (s.CITYNAME ?? "").trim();
  return normalizeAddress(`${street}${unit ? " " + unit : ""}, ${city}, FL ${zip}`) || null;
}

async function main() {
  const permitsRaw = readCsv("volusia-roof-permits");
  const parcels = readCsv("volusia-parcels");
  const situs = readCsv("volusia-situs") as unknown as SitusRow[];
  console.log(`source rows: permits=${permitsRaw.length} parcels=${parcels.length} situs=${situs.length}`);

  const parcelMap = new Map<string, { dorid: string | null; luc: string | null; slug: string | null }>();
  for (const p of parcels) parcelMap.set(p.PARID, { dorid: p.DORID || null, luc: (p.LUC || "").trim() || null, slug: slugFor(p.TAXDIST_DESC) });

  const situsMap = new Map<string, SitusRow>();
  for (const s of situs) {
    const prev = situsMap.get(s.PARID);
    if (!prev || Number(s.OWNSEQ) < Number(prev.OWNSEQ)) situsMap.set(s.PARID, s);
  }

  // filter + dedupe permits
  const seen = new Set<string>();
  const stats = { excludedType: 0, excludedStatus: 0, badDate: 0, noParcel: 0, noSitus: 0, outOfCounty: 0, dupes: 0 };
  type Joined = { slug: string; raw: Record<string, string>; upsert: PermitUpsert; luc: string | null };
  const joined: Joined[] = [];

  for (const r of permitsRaw) {
    const desc = `${r.WORK_DESC ?? ""} ${r.WORK_TYPE ?? ""}`;
    if (!ROOF_INCLUDE.test(desc)) { stats.excludedType++; continue; }
    if (ROOF_EXCLUDE.test(desc) && !REROOF.test(desc)) { stats.excludedType++; continue; }
    if (EXCLUDED_STATUS.test(r.STATUS ?? "")) { stats.excludedStatus++; continue; }
    const date = parseUsDate(r.PERMDT);
    if (!date) { stats.badDate++; continue; }
    const key = `${r.PARID}|${(r.NUM ?? "").trim()}`;
    if (seen.has(key)) { stats.dupes++; continue; }
    seen.add(key);

    const parcel = parcelMap.get(r.PARID);
    if (!parcel) { stats.noParcel++; continue; }
    if (!parcel.slug) { stats.outOfCounty++; continue; }
    const sit = situsMap.get(r.PARID);
    const address = sit ? composeSitus(sit) : null;
    if (!address) { stats.noSitus++; continue; }

    joined.push({
      slug: parcel.slug,
      luc: parcel.luc,
      raw: r,
      upsert: {
        parcel_number: parcel.dorid,
        situs_address: address,
        street_number: streetNumber(address),
        lng: null,
        lat: null,
        permit_number: (r.NUM ?? "").trim() || null,
        permit_date: date,
        geocode_method: null,
      },
    });
  }
  console.log(`joined roof permits: ${joined.length}`, stats);

  // group by jurisdiction
  const bySlug = new Map<string, Joined[]>();
  for (const j of joined) {
    if (!bySlug.has(j.slug)) bySlug.set(j.slug, []);
    bySlug.get(j.slug)!.push(j);
  }

  const runId = await startRun(null, "volusia-cama:CAMA_DATA_EXPORT_WEB.accdb");
  let totalUpserted = 0;
  try {
    for (const [slug, rows] of [...bySlug.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const jid = await jurisdictionId(slug);
      await insertRawPermits(jid, "volusia-cama-roof-permits.csv", rows.map((r) => r.raw));

      // mildly concurrent upserts (independent rows)
      const CONC = 8;
      let upserted = 0;
      for (let i = 0; i < rows.length; i += CONC) {
        const counts = await Promise.all(
          rows.slice(i, i + CONC).map((r) => upsertPermitProperties(jid, [r.upsert]))
        );
        upserted += counts.reduce((a, b) => a + b, 0);
        if ((i / CONC) % 250 === 0 && i > 0) console.log(`  ${slug}: ${i}/${rows.length}`);
      }
      totalUpserted += upserted;
      console.log(`${slug}: ${upserted}/${rows.length} upserted`);

      // dor_use_code backfill, batched by LUC
      const byLuc = new Map<string, string[]>();
      for (const r of rows) {
        if (!r.luc || !r.upsert.parcel_number) continue;
        if (!byLuc.has(r.luc)) byLuc.set(r.luc, []);
        byLuc.get(r.luc)!.push(r.upsert.parcel_number);
      }
      for (const [luc, parcelNums] of byLuc) {
        const uniq = [...new Set(parcelNums)];
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
    await finishRun(runId, "success", permitsRaw.length, totalUpserted);
    console.log(`Done. ${totalUpserted} permits upserted across ${bySlug.size} jurisdictions.`);
    console.log("Next: load Volusia address points, then run the geocode join for 'Volusia'.");
  } catch (err) {
    await finishRun(runId, "error", permitsRaw.length, totalUpserted, String(err));
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
