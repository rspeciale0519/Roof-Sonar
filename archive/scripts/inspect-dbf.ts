import * as shapefile from "shapefile";
async function main() {
  const src = await shapefile.openDbf(process.argv[2]);
  for (let n = 0; n < 3; n++) {
    const r = await src.read();
    if (r.done) break;
    if (n === 0) console.log("KEYS:", Object.keys(r.value as object).join(", "));
    console.log(`Row ${n}:`, JSON.stringify(r.value));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
