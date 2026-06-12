/**
 * Diagnostic: sample un-geocoded properties per county and show their
 * situs_address + parcel_number, so we can see which join key (parcel vs
 * situs) will actually match the address-point file formats.
 *   npx tsx scripts/diag-geocode-keys.ts
 */
import { db } from "./lib/db";

async function main() {
  const client = db();
  const counties = ["Volusia", "Orange", "Seminole"];

  for (const c of counties) {
    const { data: juris } = await client.from("jurisdictions").select("id").eq("county", c);
    const jids = (juris ?? []).map((j: { id: number }) => j.id);

    const { data: rows } = await client
      .from("properties")
      .select("situs_address, parcel_number")
      .in("jurisdiction_id", jids)
      .is("geom", null)
      .limit(5);

    console.log(`\n=== ${c} — sample un-geocoded properties ===`);
    for (const r of rows ?? []) {
      console.log(`  parcel="${r.parcel_number}"  situs="${r.situs_address}"`);
    }

    // Also show a geocoded one for format comparison
    const { data: geo } = await client
      .from("properties")
      .select("situs_address, parcel_number")
      .in("jurisdiction_id", jids)
      .not("geom", "is", null)
      .limit(3);
    console.log(`  --- already geocoded (for format reference) ---`);
    for (const r of geo ?? []) {
      console.log(`  parcel="${r.parcel_number}"  situs="${r.situs_address}"`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
