/**
 * City of Orlando roofing permits — Socrata SODA adapter (VERIFIED endpoint).
 *
 *   npm run ingest:orlando -- --test            # fetch 1,000 rows, analyze, NO db writes
 *   npm run ingest:orlando -- --test --write    # fetch 1,000 rows and upsert them
 *   npm run ingest:orlando -- --backfill        # full historical backfill (~87k rows)
 *   npm run ingest:orlando -- --since 2026-05-01
 *   npm run ingest:orlando                      # incremental: issue_permit_date > last loaded
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SOCRATA_APP_TOKEN (optional but recommended).
 */
import { optionalEnv } from "./lib/env";
import { db, jurisdictionId, startRun, finishRun, insertRawPermits, upsertPermitProperties, PermitUpsert } from "./lib/db";
import { normalizeAddress, streetNumber } from "./lib/normalize";

const ENDPOINT = "https://data.cityoforlando.net/resource/ryhf-m453.json";
const PAGE_SIZE = 5000;
const EXCLUDED_STATUS = /withdrawn|void|cancel|denied|revoked/i;

interface OrlandoRow {
  permit_number?: string;
  parcel_number?: string;
  permit_address?: string;
  issue_permit_date?: string;
  application_status?: string;
  worktype?: string;
  application_type?: string;
  geocoded_column?: { type: string; coordinates: [number, number] };
  [k: string]: unknown;
}

async function fetchPage(offset: number, limit: number, since?: string): Promise<OrlandoRow[]> {
  const where = [
    `application_type='Building Permit'`,
    `worktype='Roof'`,
    ...(since ? [`issue_permit_date > '${since}'`] : []),
  ].join(" AND ");
  const url = `${ENDPOINT}?$where=${encodeURIComponent(where)}&$order=issue_permit_date&$limit=${limit}&$offset=${offset}`;
  const headers: Record<string, string> = {};
  const token = optionalEnv("SOCRATA_APP_TOKEN");
  if (token) headers["X-App-Token"] = token;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Socrata ${res.status}: ${await res.text()}`);
  return (await res.json()) as OrlandoRow[];
}

function toPermit(row: OrlandoRow): PermitUpsert | null {
  if (!row.issue_permit_date) return null; // unissued
  if (row.application_status && EXCLUDED_STATUS.test(row.application_status)) return null;
  const situs = normalizeAddress(row.permit_address);
  if (!situs) return null;
  const coords = row.geocoded_column?.coordinates;
  return {
    parcel_number: row.parcel_number ?? null,
    situs_address: situs,
    street_number: streetNumber(situs),
    lng: coords?.[0] ?? null,
    lat: coords?.[1] ?? null,
    permit_number: row.permit_number ?? null,
    permit_date: row.issue_permit_date.slice(0, 10),
    geocode_method: coords ? "source_geocoded" : null,
  };
}

function analyze(rows: OrlandoRow[]): void {
  const permits = rows.map(toPermit);
  const usable = permits.filter(Boolean) as PermitUpsert[];
  const geocoded = usable.filter((p) => p.lng !== null).length;
  const years = new Map<string, number>();
  for (const p of usable) {
    const y = p.permit_date.slice(0, 4);
    years.set(y, (years.get(y) ?? 0) + 1);
  }
  const statuses = new Map<string, number>();
  for (const r of rows) {
    const s = r.application_status ?? "(none)";
    statuses.set(s, (statuses.get(s) ?? 0) + 1);
  }

  console.log(`\n=== Orlando sample analysis ===`);
  console.log(`rows fetched:        ${rows.length}`);
  console.log(`usable (issued, addressed): ${usable.length}`);
  console.log(`pre-geocoded:        ${geocoded} (${Math.round((geocoded / Math.max(usable.length, 1)) * 100)}%)`);
  console.log(`\nstatus breakdown:`);
  for (const [s, n] of [...statuses].sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}`);
  console.log(`\nissue-year spread (sample):`);
  for (const [y, n] of [...years].sort()) console.log(`  ${y}: ${n}`);
  console.log(`\nfirst 5 normalized permits:`);
  for (const p of usable.slice(0, 5)) console.log(" ", JSON.stringify(p));
}

async function lastLoadedDate(jid: number): Promise<string | null> {
  const { data } = await db()
    .from("properties")
    .select("last_permit_date")
    .eq("jurisdiction_id", jid)
    .not("last_permit_date", "is", null)
    .order("last_permit_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.last_permit_date ?? null;
}

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes("--test");
  const isWrite = args.includes("--write");
  const isBackfill = args.includes("--backfill");
  const sinceIdx = args.indexOf("--since");
  const sinceArg = sinceIdx >= 0 ? args[sinceIdx + 1] : undefined;

  if (isTest) {
    console.log("Fetching 1,000-row test sample from Socrata…");
    const rows = await fetchPage(0, 1000);
    analyze(rows);
    if (!isWrite) {
      console.log("\n(no database writes — rerun with --write to upsert this sample)");
      return;
    }
  }

  const jid = await jurisdictionId("orlando");
  let since: string | undefined = sinceArg;
  if (!isTest && !isBackfill && !since) {
    const last = await lastLoadedDate(jid);
    if (!last) {
      console.error("No Orlando data loaded yet. Run with --backfill for the full history, or --since YYYY-MM-DD.");
      process.exit(1);
    }
    since = last;
    console.log(`Incremental mode: issue_permit_date > ${since}`);
  }

  const runId = await startRun(jid, isTest ? "orlando:test" : isBackfill ? "orlando:backfill" : "orlando:incremental");
  let rowsIn = 0;
  let upserted = 0;
  try {
    let offset = 0;
    const limit = isTest ? 1000 : PAGE_SIZE;
    for (;;) {
      const rows = await fetchPage(offset, limit, since);
      if (rows.length === 0) break;
      rowsIn += rows.length;
      await insertRawPermits(jid, "socrata:ryhf-m453", rows);
      const permits = rows.map(toPermit).filter(Boolean) as PermitUpsert[];
      upserted += await upsertPermitProperties(jid, permits);
      console.log(`  offset ${offset}: ${rows.length} rows in, ${permits.length} usable, ${upserted} total upserted`);
      if (isTest || rows.length < limit) break;
      offset += limit;
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
