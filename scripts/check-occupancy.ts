/**
 * Quick occupancy distribution check across all counties.
 *   npx tsx scripts/check-occupancy.ts
 */
import { db } from "./lib/db";

async function main() {
  const client = db();

  // Total and unknown counts
  const { count: total } = await client.from("properties").select("*", { count: "exact", head: true });
  const { count: unknown } = await client.from("properties").select("*", { count: "exact", head: true }).is("occupancy", null);
  const { count: unknownStr } = await client.from("properties").select("*", { count: "exact", head: true }).eq("occupancy", "unknown");

  console.log(`Total properties: ${(total ?? 0).toLocaleString()}`);
  console.log(`occupancy IS NULL: ${(unknown ?? 0).toLocaleString()}`);
  console.log(`occupancy = 'unknown': ${(unknownStr ?? 0).toLocaleString()}`);

  // Per-occupancy counts
  const occ = ["owner", "likely_owner", "absentee", "investor"];
  console.log("\nOccupancy breakdown:");
  for (const o of occ) {
    const { count } = await client.from("properties").select("*", { count: "exact", head: true }).eq("occupancy", o);
    console.log(`  ${o}: ${(count ?? 0).toLocaleString()}`);
  }

  // Per-county with-coords counts (via jurisdictions join)
  console.log("\nProperties with coordinates (map-visible) by county:");
  const counties = ["Seminole", "Volusia", "Orange", "Pinellas"];
  for (const c of counties) {
    // Get jurisdiction IDs for this county
    const { data: juris } = await client.from("jurisdictions").select("id").eq("county", c);
    const jids = (juris ?? []).map((j: { id: number }) => j.id);
    if (jids.length === 0) { console.log(`  ${c}: no jurisdictions found`); continue; }

    const { count: withGeom } = await client
      .from("properties")
      .select("*", { count: "exact", head: true })
      .in("jurisdiction_id", jids)
      .not("geom", "is", null);
    const { count: countyTotal } = await client
      .from("properties")
      .select("*", { count: "exact", head: true })
      .in("jurisdiction_id", jids);
    console.log(`  ${c}: ${(withGeom ?? 0).toLocaleString()} / ${(countyTotal ?? 0).toLocaleString()} have coords`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
