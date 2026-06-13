/**
 * Pick rural single-family homes (Marion/Lake) that currently fall back to the
 * living-area estimate because their parcel-centroid geocode sits beyond the
 * 15 m nearest-footprint radius. We keep only homes with a house-sized USA
 * Structures building 13-55 m away — the exact case a larger, living-area-
 * bounded nearest fallback would fix — so Rob can Planimeter-measure real
 * candidates before we change the matcher. Read-only.
 *
 *   npx tsx scripts/pick-validation-homes.ts
 */
import { sql } from "./lib/sql";

const USA = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36";

interface Cand { county: string; situs_address: string; lng: number; lat: number; building_sqft: number; roofing_squares: number }

async function nearestHouse(lng: number, lat: number): Promise<{ sqft: number; dist: number } | null> {
  const d = 0.0007; // ~77 m envelope
  const env = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const url = `${USA}/query?geometry=${encodeURIComponent(env)}&geometryType=esriGeometryEnvelope&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent("SQFEET,LONGITUDE,LATITUDE")}&returnGeometry=false&f=json`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    const j = (await r.json()) as { features?: { attributes: { SQFEET: number; LONGITUDE: number; LATITUDE: number } }[] };
    const cos = Math.cos((lat * Math.PI) / 180);
    let best: { sqft: number; dist: number } | null = null;
    for (const f of j.features ?? []) {
      const s = Number(f.attributes.SQFEET);
      if (!(s >= 700 && s <= 6000)) continue; // house-sized only (skip barns/sheds)
      const dx = (lng - Number(f.attributes.LONGITUDE)) * cos * 111320;
      const dy = (lat - Number(f.attributes.LATITUDE)) * 111320;
      const m = Math.hypot(dx, dy);
      if (!best || m < best.dist) best = { sqft: s, dist: m };
    }
    return best;
  } catch { return null; }
}

async function main() {
  const rows = await sql<Cand>(
    `select county, situs_address, lng, lat, building_sqft, roofing_squares from (
       select j.county, p.situs_address, st_x(p.geom::geometry) lng, st_y(p.geom::geometry) lat,
              p.building_sqft, p.roofing_squares,
              row_number() over (partition by j.county order by (p.id*2654435761)%1000000) rn
       from properties p join jurisdictions j on j.id=p.jurisdiction_id
       where j.county in ('Marion','Lake') and p.squares_source is null
         and left(coalesce(p.dor_use_code,''),2)='01' and p.geom is not null
         and p.building_sqft between 1300 and 2800
     ) t where rn <= 45`,
  );
  console.log(`probing ${rows.length} candidates…\n`);
  const good: (Cand & { near_sqft: number; near_dist: number })[] = [];
  for (const r of rows) {
    const n = await nearestHouse(Number(r.lng), Number(r.lat));
    if (n && n.dist >= 13 && n.dist <= 55) good.push({ ...r, near_sqft: Math.round(n.sqft), near_dist: Math.round(n.dist) });
    await new Promise((s) => setTimeout(s, 120));
  }
  const byCounty = (c: string) => good.filter((g) => g.county === c);
  const pick = [...byCounty("Marion").slice(0, 3), ...byCounty("Lake").slice(0, 3)];
  console.log("county  | situs                         | lat,lng                 | living_sq | bldg_sqft | near_sqft | near_dist");
  console.log("-".repeat(112));
  for (const g of pick) {
    console.log(
      `${g.county.padEnd(7)} | ${g.situs_address.padEnd(29)} | ${Number(g.lat).toFixed(6)},${Number(g.lng).toFixed(6)} | ` +
      `${String(g.roofing_squares).padStart(9)} | ${String(g.building_sqft).padStart(9)} | ${String(g.near_sqft).padStart(9)} | ${String(g.near_dist).padStart(6)} m`,
    );
  }
  console.log(`\n(${good.length} of ${rows.length} candidates had a house 13-55m away; showing ${pick.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
