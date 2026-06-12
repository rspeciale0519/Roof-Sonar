/**
 * Post-crash cleanup: truncate address_points staging rows and report
 * table sizes. Uses supabase-js (PostgREST) so no direct Postgres port needed.
 *
 *   npx tsx scripts/db-cleanup.ts [--dry-run]
 */
import { db } from "./lib/db";

const DRY = process.argv.includes("--dry-run");

async function main() {
  const client = db();

  // --- Row counts for the big tables ---
  const tables = ["address_points", "properties", "raw_permits", "ingest_runs"];
  console.log("=== Row counts ===");
  for (const t of tables) {
    const { count, error } = await client.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t}: ${error ? "ERROR " + error.message : (count ?? 0).toLocaleString()}`);
  }

  const { count: apCount } = await client
    .from("address_points")
    .select("*", { count: "exact", head: true });

  if ((apCount ?? 0) === 0) {
    console.log("\naddress_points is already empty — nothing to clean.");
    return;
  }

  if (DRY) {
    console.log(`\n[dry-run] Would delete ${(apCount ?? 0).toLocaleString()} address_points rows.`);
    return;
  }

  console.log(`\nDeleting ${(apCount ?? 0).toLocaleString()} address_points rows…`);
  // PostgREST requires a filter — neq on a non-existent value matches everything
  const { error } = await client.from("address_points").delete().neq("county", "__never__");
  if (error) throw new Error(`Delete failed: ${error.message}`);
  console.log("address_points cleared.");

  // Verify
  const { count: after } = await client
    .from("address_points")
    .select("*", { count: "exact", head: true });
  console.log(`Rows remaining: ${after ?? 0}`);
  console.log("\nDone. Disk IO pressure should subside in a few minutes as buffer cache warms.");
  console.log("Next: re-run NAL ingests (Volusia → Pinellas).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
