/**
 * Apply a .sql file (e.g. a migration) to the linked Supabase project via the
 * Management API. DDL and small/medium statements only — anything that runs
 * past ~100s trips a Cloudflare 524 (chunk those in a dedicated script).
 *
 *   npx tsx scripts/run-sql.ts supabase/migrations/0016_footprint_squares.sql
 */
import fs from "node:fs";
import { sql } from "./lib/sql";

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/run-sql.ts <path-to.sql>");
    process.exit(1);
  }
  const text = fs.readFileSync(file, "utf8");
  console.log(`Applying ${file} (${text.length} chars)…`);
  const rows = await sql(text);
  console.log(`OK. ${Array.isArray(rows) ? rows.length : 0} row(s) returned.`);
  if (Array.isArray(rows) && rows.length) console.log(rows.slice(0, 20));
}

main().catch((e) => { console.error(e); process.exit(1); });
