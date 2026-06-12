import { db } from "../../scripts/lib/db";
async function main() {
  const client = db();
  for (const c of ["Volusia", "Orange"]) {
    const { data: juris } = await client.from("jurisdictions").select("id").eq("county", c);
    const jids = (juris ?? []).map((j: { id: number }) => j.id);
    const { data: rows } = await client
      .from("properties")
      .select("parcel_number, situs_address, roof_year, dor_use_code, building_sqft")
      .in("jurisdiction_id", jids).not("geom", "is", null)
      .is("building_sqft", null).not("dor_use_code", "like", "00%")
      .not("roof_year", "is", null).limit(10);
    console.log(`\n=== ${c} real-gap sample (building, no sqft, has permit) ===`);
    for (const r of rows ?? []) console.log(`  parcel="${r.parcel_number}" use=${r.dor_use_code} roof=${r.roof_year} situs="${r.situs_address}"`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
