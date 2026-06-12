/** Quick: do permits_061026.csv parcels match Seminole properties? */
import fs from "node:fs";
import { parse } from "csv-parse";
import { db } from "../../scripts/lib/db";

async function main() {
  const file = "data/inbox/unsorted/permits_061026.csv";
  const parcels = new Set<string>();
  const parser = fs.createReadStream(file).pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }));
  let n = 0;
  for await (const r of parser as AsyncIterable<Record<string, string>>) {
    const p = (r.Parcel ?? "").trim();
    if (p) parcels.add(p);
    if (++n >= 20000) break;
  }
  const sample = [...parcels].slice(0, 200);
  const client = db();
  const { data: juris } = await client.from("jurisdictions").select("id").eq("county", "Seminole");
  const jids = (juris ?? []).map((j: { id: number }) => j.id);
  const { data: hits } = await client.from("properties").select("parcel_number").in("jurisdiction_id", jids).in("parcel_number", sample);
  console.log(`Distinct parcels in first 20k permit rows: ${parcels.size}`);
  console.log(`Of 200 sampled, ${(hits ?? []).length} matched Seminole properties.`);
  console.log(`Sample permit parcels: ${sample.slice(0, 5).join(", ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
