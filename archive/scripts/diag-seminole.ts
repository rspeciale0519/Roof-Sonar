import { db } from "./lib/db";
async function main() {
  const client = db();
  const { data: juris } = await client.from("jurisdictions").select("id").eq("county", "Seminole");
  const jids = (juris ?? []).map((j: { id: number }) => j.id);
  const { data: rows } = await client
    .from("properties").select("situs_address, parcel_number")
    .in("jurisdiction_id", jids).is("geom", null).limit(6);
  console.log("Seminole un-geocoded:");
  for (const r of rows ?? []) console.log(`  parcel="${r.parcel_number}"  situs="${r.situs_address}"`);
  const { data: geo } = await client
    .from("properties").select("situs_address, parcel_number")
    .in("jurisdiction_id", jids).not("geom", "is", null).limit(3);
  console.log("Seminole geocoded:");
  for (const r of geo ?? []) console.log(`  parcel="${r.parcel_number}"  situs="${r.situs_address}"`);
}
main().catch((e) => { console.error(e); process.exit(1); });
