import * as shapefile from "shapefile";
async function main() {
  const shp = process.argv[2];
  const source = await shapefile.open(shp);
  let n = 0;
  while (n < 2) {
    const r = await source.read();
    if (r.done) break;
    if (n === 0) {
      console.log("PROPERTY KEYS:", Object.keys(r.value.properties as object).join(", "));
      console.log("GEOMETRY TYPE:", (r.value.geometry as { type: string } | null)?.type);
    }
    console.log(`Feature ${n}:`, JSON.stringify(r.value.properties));
    n++;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
