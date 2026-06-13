/**
 * Verify footprint-squares coverage for a county and (for Pinellas) spot-check
 * the 5 Planimeter homes. Read-only.
 *
 *   npx tsx scripts/verify-footprint-squares.ts Pinellas
 */
import { sql } from "./lib/sql";

const HOMES: Record<string, number> = {
  "8201 46TH ST N PINELLAS PARK": 2245.78,
  "5251 39TH AVE N ST PETERSBURG": 1000.72,
  "12322 68TH ST PINELLAS PARK": 2246.92,
  "11904 69TH WAY PINELLAS PARK": 2351.67,
  "10273 109TH AVE LARGO": 1388.72,
};

async function main() {
  const county = (process.argv[2] ?? "Pinellas");
  const cov = await sql<{ squares_source: string | null; n: number }>(
    `select p.squares_source, count(*)::int n
     from properties p join jurisdictions j on j.id = p.jurisdiction_id
     where j.county = '${county}' and p.geom is not null
     group by 1 order by 2 desc`,
  );
  const total = cov.reduce((s, r) => s + Number(r.n), 0);
  console.log(`${county}: ${total.toLocaleString()} geocoded properties`);
  for (const r of cov) {
    const label = r.squares_source ?? "living_area (fallback)";
    const n = Number(r.n);
    console.log(`  ${label.padEnd(24)} ${n.toLocaleString().padStart(9)}  ${((n / total) * 100).toFixed(1)}%`);
  }

  if (county === "Pinellas") {
    const list = Object.keys(HOMES).map((h) => `'${h}'`).join(",");
    const rows = await sql<{ situs_address: string; footprint_sqft: number | null; roofing_squares: number | null; squares_source: string | null; building_sqft: number | null }>(
      `select situs_address, footprint_sqft, roofing_squares, squares_source, building_sqft
       from properties where situs_address in (${list}) order by situs_address`,
    );
    console.log("\nPlanimeter spot-check:");
    console.log("situs                          | fp_sqft | planim | err  | roof_sq | source");
    console.log("-".repeat(86));
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.situs_address)) continue; // skip dup parcels
      seen.add(r.situs_address);
      const plan = HOMES[r.situs_address];
      const err = r.footprint_sqft ? `${(((r.footprint_sqft - plan) / plan) * 100).toFixed(0)}%` : "—";
      console.log(
        `${r.situs_address.padEnd(30)} | ${String(r.footprint_sqft ?? "—").padStart(7)} | ${String(plan).padStart(6)} | ${err.padStart(4)} | ${String(r.roofing_squares ?? "—").padStart(7)} | ${r.squares_source ?? "—"}`,
      );
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
