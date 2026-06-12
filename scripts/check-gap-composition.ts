/**
 * Explain the residual: among MAP-VISIBLE properties still missing building_sqft
 * (→ no roofing_squares) or roof age, how many are VACANT land (DOR use code 00 —
 * no building, so legitimately no roof) vs a real unexplained gap.
 *   npx tsx scripts/check-gap-composition.ts
 */
import { db } from "./lib/db";

const COUNTIES = ["Seminole", "Volusia", "Orange", "Pinellas"];

function base(jids: number[]) {
  return db().from("properties").select("*", { count: "exact", head: true }).in("jurisdiction_id", jids).not("geom", "is", null);
}
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
    if (jids.length === 0) continue;

    const visible = await cnt(base(jids));
    if (visible === 0) continue;

    // No roofing squares, split by vacant (use 00) vs not
    const noSq        = await cnt(base(jids).is("roofing_squares", null));
    const noSqVacant  = await cnt(base(jids).is("roofing_squares", null).like("dor_use_code", "00%"));
    const noSqRealGap = noSq - noSqVacant;

    // No roof age (neither roof_year nor year_built), split by vacant vs not
    const noAge       = await cnt(base(jids).is("roof_year", null).is("year_built", null));
    const noAgeVacant = await cnt(base(jids).is("roof_year", null).is("year_built", null).like("dor_use_code", "00%"));
    const noAgeRealGap = noAge - noAgeVacant;

    const pct = (n: number) => `${((n / visible) * 100).toFixed(2)}%`;
    console.log(`\n=== ${c} — ${visible.toLocaleString()} map-visible ===`);
    console.log(`  no roofing_squares: ${noSq.toLocaleString()} (${pct(noSq)})`);
    console.log(`     vacant land (use 00, no roof): ${noSqVacant.toLocaleString()}`);
    console.log(`     real gap (building, no sqft):  ${noSqRealGap.toLocaleString()} (${pct(noSqRealGap)})`);
    console.log(`  no roof age at all: ${noAge.toLocaleString()} (${pct(noAge)})`);
    console.log(`     vacant land:                   ${noAgeVacant.toLocaleString()}`);
    console.log(`     real gap (building, no age):   ${noAgeRealGap.toLocaleString()} (${pct(noAgeRealGap)})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
