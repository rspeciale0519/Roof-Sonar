/**
 * Validate PARCEL-POLYGON footprint assignment against Rob's Planimeter traces.
 * For each home: fetch the county parcel polygon containing its geocode, then
 * the largest USA Structures footprint whose centroid lies INSIDE that parcel —
 * unambiguous (a building in a parcel belongs to it), so a far-off geocode no
 * longer grabs a neighbor's roof. Read-only.
 *
 *   npx tsx scripts/validate-parcel-polygon.ts
 */
const UA = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120" } };
const USA = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0";
const LAYERS: Record<string, string> = {
  Marion: "https://www.pa.marion.fl.us/arcgis/rest/services/MCPA_Services/Parcels/MapServer/0",
  Lake: "https://gis.lakecountyfl.gov/lakegis/rest/services/OpenData/OpenData1/FeatureServer/12",
};

const HOMES = [
  { county: "Marion", situs: "7 HEMLOCK CIR OCALA", lng: -82.033450, lat: 29.139900, plan: 2449.11 },
  { county: "Marion", situs: "4002 SW 115TH TER OCALA", lng: -82.312150, lat: 29.148500, plan: 3216.04 },
  { county: "Marion", situs: "9547 SE 61ST TER BELLEVIEW", lng: -82.046875, lat: 29.083350, plan: 3840.70 },
  { county: "Lake", situs: "56341 ACORN RD", lng: -81.534940, lat: 29.176142, plan: 1505.92 },
  { county: "Lake", situs: "25255 VANBUREN ST", lng: -81.729562, lat: 28.713550, plan: 3614.39 },
];

interface Poly { rings: number[][][] }
const inRing = (ring: number[][], x: number, y: number): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inParcel = (rings: number[][][], x: number, y: number): boolean => rings.some((r) => inRing(r, x, y));

async function parcel(county: string, lng: number, lat: number): Promise<Poly | null> {
  const g = encodeURIComponent(JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
  const url = `${LAYERS[county]}/query?geometry=${g}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=true&outSR=4326&f=json`;
  const j = (await (await fetch(url, UA)).json()) as { features?: { geometry: Poly }[] };
  return j.features?.[0]?.geometry ?? null;
}

async function footprintsIn(rings: number[][][]): Promise<number> {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const env = `${minX},${minY},${maxX},${maxY}`;
  const url = `${USA}/query?geometry=${encodeURIComponent(env)}&geometryType=esriGeometryEnvelope&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=SQFEET&returnGeometry=true&geometryPrecision=6&outSR=4326&f=json`;
  const j = (await (await fetch(url, UA)).json()) as { features?: { attributes: { SQFEET: number }; geometry?: { rings?: number[][][] } }[] };
  let largest = 0;
  for (const f of j.features ?? []) {
    const s = Number(f.attributes.SQFEET);
    const ring = f.geometry?.rings?.[0];
    if (!(s >= 200) || !ring) continue;
    let sx = 0, sy = 0;
    for (let i = 0; i < ring.length - 1; i++) { sx += ring[i][0]; sy += ring[i][1]; }
    const n = ring.length - 1;
    if (inParcel(rings, sx / n, sy / n) && s > largest) largest = s;
  }
  return largest;
}

async function main() {
  console.log("situs                          | parcel_fp | planim | err  | vs near-grab (old)");
  console.log("-".repeat(92));
  const OLD: Record<string, number> = { "56341 ACORN RD": 2891, "25255 VANBUREN ST": 3733, "7 HEMLOCK CIR OCALA": 2649, "4002 SW 115TH TER OCALA": 2984, "9547 SE 61ST TER BELLEVIEW": 4553 };
  for (const h of HOMES) {
    const p = await parcel(h.county, h.lng, h.lat);
    const fp = p ? await footprintsIn(p.rings) : 0;
    const err = fp ? `${(((fp - h.plan) / h.plan) * 100).toFixed(0)}%` : "—";
    const old = OLD[h.situs];
    console.log(`${h.situs.padEnd(30)} | ${String(fp || "—").padStart(9)} | ${String(Math.round(h.plan)).padStart(6)} | ${err.padStart(4)} | old nearest grabbed ${old}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
