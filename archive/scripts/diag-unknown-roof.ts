/** Why are so many properties "Unknown/original"? Quantify roof_year null vs year_built present. */
import { db } from "../../scripts/lib/db";
async function main() {
  const client = db();
  const base = () => client.from("properties").select("*", { count: "exact", head: true }).not("geom", "is", null);
  const visible = (await base()).count ?? 0;
  const noRoofYear = (await base().is("roof_year", null)).count ?? 0;
  const noRoofYearHasYB = (await base().is("roof_year", null).not("year_built", "is", null)).count ?? 0;
  const trulyUnknown = (await base().is("roof_year", null).is("year_built", null)).count ?? 0;
  const pct = (n: number) => `${((n / visible) * 100).toFixed(1)}%`;
  console.log(`Map-visible properties:        ${visible.toLocaleString()}`);
  console.log(`Show "Unknown" (roof_year null): ${noRoofYear.toLocaleString()} (${pct(noRoofYear)})`);
  console.log(`  ...but HAVE a build year:      ${noRoofYearHasYB.toLocaleString()} (${pct(noRoofYearHasYB)})  <- fixable: color by year_built`);
  console.log(`  ...truly unknown (no year):    ${trulyUnknown.toLocaleString()} (${pct(trulyUnknown)})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
