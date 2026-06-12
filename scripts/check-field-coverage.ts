/**
 * Field-coverage audit for the three map-facing fields the goal cares about:
 * roof age (roof_year OR year_built fallback), roofing_squares, street_number.
 * Reports counts among MAP-VISIBLE (geom not null) properties, per county.
 *   npx tsx scripts/check-field-coverage.ts
 */
import { db } from "./lib/db";

const COUNTIES = ["Seminole", "Volusia", "Orange", "Pinellas", "Sumter", "Lake", "Marion"];

// Base query: map-visible (geom not null) properties in the given jurisdictions.
function base(jids: number[]) {
  return db().from("properties").select("*", { count: "exact", head: true }).in("jurisdiction_id", jids).not("geom", "is", null);
}

// Accept the awaited result shape (a thenable) rather than the builder type —
// chaining .not()/.or() produces a recursively deep generic that tsc rejects.
type CountResult = PromiseLike<{ count: number | null; error: { message: string } | null }>;
async function cnt(q: CountResult): Promise<number> {
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function main() {
  for (const c of COUNTIES) {
    const { data: juris } = await db().from("jurisdictions").select("id").eq("county", c);
    const jids = (juris ?? []).map((j: { id: number }) => j.id);
    if (jids.length === 0) { console.log(`${c}: no jurisdictions`); continue; }

    const visible = await cnt(base(jids));
    if (visible === 0) { console.log(`\n=== ${c}: 0 map-visible ===`); continue; }

    const roofYear   = await cnt(base(jids).not("roof_year", "is", null));
    const yearBuilt  = await cnt(base(jids).not("year_built", "is", null));
    const roofAgeOk  = await cnt(base(jids).or("roof_year.not.is.null,year_built.not.is.null"));
    const sqft       = await cnt(base(jids).not("building_sqft", "is", null));
    const squares    = await cnt(base(jids).not("roofing_squares", "is", null));
    const streetNum  = await cnt(base(jids).not("street_number", "is", null));

    const pct = (n: number) => `${((n / visible) * 100).toFixed(1)}%`;
    console.log(`\n=== ${c} — ${visible.toLocaleString()} map-visible ===`);
    console.log(`  roof age shown (roof_year OR year_built): ${roofAgeOk.toLocaleString()} (${pct(roofAgeOk)})`);
    console.log(`     roof_year:      ${roofYear.toLocaleString()} (${pct(roofYear)})`);
    console.log(`     year_built:     ${yearBuilt.toLocaleString()} (${pct(yearBuilt)})`);
    console.log(`  roofing_squares:   ${squares.toLocaleString()} (${pct(squares)})`);
    console.log(`     building_sqft:  ${sqft.toLocaleString()} (${pct(sqft)})`);
    console.log(`  street_number:     ${streetNum.toLocaleString()} (${pct(streetNum)})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
