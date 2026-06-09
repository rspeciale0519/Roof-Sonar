import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );
  }
  return client;
}

export async function jurisdictionId(slug: string): Promise<number> {
  const { data, error } = await db().from("jurisdictions").select("id").eq("slug", slug).single();
  if (error || !data) throw new Error(`Jurisdiction '${slug}' not found — run migrations first. ${error?.message ?? ""}`);
  return data.id;
}

export async function startRun(jurisdiction_id: number | null, source: string): Promise<number> {
  const { data, error } = await db()
    .from("ingest_runs")
    .insert({ jurisdiction_id, source, status: "running" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create ingest_run: ${error?.message}`);
  return data.id;
}

export async function finishRun(
  id: number,
  status: "success" | "error",
  rows_in: number,
  rows_upserted: number,
  errMsg?: string
): Promise<void> {
  await db()
    .from("ingest_runs")
    .update({ status, rows_in, rows_upserted, finished_at: new Date().toISOString(), error: errMsg ?? null })
    .eq("id", id);
}

/** Preserve every raw source row (PRD: file adapter / raw_permits). */
export async function insertRawPermits(
  jurisdiction_id: number,
  source_file: string,
  rows: unknown[]
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map((raw) => ({ jurisdiction_id, source_file, raw }));
    const { error } = await db().from("raw_permits").insert(batch);
    if (error) throw new Error(`raw_permits insert failed: ${error.message}`);
  }
}

export interface PermitUpsert {
  parcel_number: string | null;
  situs_address: string;
  street_number: string | null;
  lng: number | null;
  lat: number | null;
  permit_number: string | null;
  permit_date: string; // ISO date
  geocode_method: string | null;
}

export async function upsertPermitProperties(
  jurisdiction_id: number,
  permits: PermitUpsert[]
): Promise<number> {
  let upserted = 0;
  for (const p of permits) {
    const { error } = await db().rpc("upsert_permit_property", {
      p_jurisdiction_id: jurisdiction_id,
      p_parcel_number: p.parcel_number,
      p_situs_address: p.situs_address,
      p_street_number: p.street_number,
      p_lng: p.lng,
      p_lat: p.lat,
      p_permit_number: p.permit_number,
      p_permit_date: p.permit_date,
      p_geocode_method: p.geocode_method,
    });
    if (error) {
      console.error(`  upsert failed for ${p.situs_address}: ${error.message}`);
    } else {
      upserted++;
    }
  }
  return upserted;
}
