/** Validate footprint methods against Rob's Planimeter readings on 5 homes.
 *  Compares: living-area (current) vs USA Structures point-in-polygon vs
 *  envelope-largest vs Planimeter truth. */
import { db } from "../../scripts/lib/db";

const SLOPE = 1.30;
const USA = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0";
const UA = "Mozilla/5.0 Chrome/120";

const HOMES = [
  { situs: "8201 46TH ST N PINELLAS PARK", plan: 2245.78 },
  { situs: "5251 39TH AVE N ST PETERSBURG", plan: 1000.72 },
  { situs: "12322 68TH ST PINELLAS PARK", plan: 2246.92 },
  { situs: "11904 69TH WAY PINELLAS PARK", plan: 2351.67 },
  { situs: "10273 109TH AVE LARGO", plan: 1388.72 },
];

async function query(url: string): Promise<{ attributes: { SQFEET: number } }[]> {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const j = (await r.json()) as { features?: { attributes: { SQFEET: number } }[] };
  return j.features ?? [];
}

// building whose polygon contains the exact point
async function pointInPoly(lat: number, lng: number): Promise<number | null> {
  const g = encodeURIComponent(`{"x":${lng},"y":${lat},"spatialReference":{"wkid":4326}}`);
  const f = await query(`${USA}/query?geometry=${g}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=SQFEET&returnGeometry=false&f=json`);
  const s = f.map((x) => Number(x.attributes.SQFEET)).filter((n) => n > 200);
  return s.length ? Math.max(...s) : null; // if >1 (rare overlap) take larger
}

// smallest building within a tight ~12m buffer (fallback when centroid is off the house)
async function nearestSmall(lat: number, lng: number): Promise<number | null> {
  const d = 0.00011;
  const env = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const f = await query(`${USA}/query?geometry=${encodeURIComponent(env)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=SQFEET&returnGeometry=false&f=json`);
  const s = f.map((x) => Number(x.attributes.SQFEET)).filter((n) => n > 200).sort((a, b) => a - b);
  return s.length ? s[0] : null;
}

async function main() {
  const client = db();
  console.log("situs                          | living | cur | pip_sqft | pip_sq | plan_sqft | plan_sq | pip_err | cur_err");
  console.log("-".repeat(115));
  for (const h of HOMES) {
    const { data } = await client.from("properties").select("building_sqft, roofing_squares, geom").eq("situs_address", h.situs).limit(1).single();
    const p = data as { building_sqft: number | null; roofing_squares: number | null } | null;
    // coords via the bbox RPC is overkill; read geom as text
    const { data: g } = await client.rpc("properties_in_bbox", { min_lng: -83, min_lat: 27.5, max_lng: -82, max_lat: 28.3, max_rows: 3000 });
    const hit = (g as { situs_address: string; lng: number; lat: number }[] ?? []).find((r) => r.situs_address === h.situs);
    if (!hit) { console.log(`${h.situs.padEnd(30)} | (no coords)`); continue; }
    let fp = await pointInPoly(hit.lat, hit.lng);
    if (fp == null) fp = await nearestSmall(hit.lat, hit.lng);
    const planSq = Math.round((h.plan * SLOPE) / 100);
    const pipSq = fp ? Math.round((fp * SLOPE) / 100) : null;
    const cur = p?.roofing_squares ?? null;
    const pe = fp ? `${(((fp - h.plan) / h.plan) * 100).toFixed(0)}%` : "?";
    const ce = p?.building_sqft ? `${(((p.building_sqft - h.plan) / h.plan) * 100).toFixed(0)}%` : "?";
    console.log(`${h.situs.padEnd(30)} | ${String(p?.building_sqft ?? "?").padStart(6)} | ${String(cur ?? "?").padStart(3)} | ${String(fp ? Math.round(fp) : "?").padStart(8)} | ${String(pipSq ?? "?").padStart(6)} | ${String(h.plan).padStart(9)} | ${String(planSq).padStart(7)} | ${pe.padStart(7)} | ${ce.padStart(7)}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
