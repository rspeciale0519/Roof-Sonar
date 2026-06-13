/**
 * PROTOTYPE: compare roofing squares from (a) the current method
 * (living_area x slope) vs (b) a building-FOOTPRINT polygon x slope — the
 * automated equivalent of tracing the roof in Planimeter. Footprints come from
 * OpenStreetMap via Overpass (free, queryable); county/Microsoft footprints
 * would be the production source. Geodesic polygon area, no projection needed.
 *
 *   npx tsx archive/scripts/proto-footprint-squares.ts            # built-in sample
 *   npx tsx archive/scripts/proto-footprint-squares.ts "ADDR|lat|lng" ...
 */
import { db } from "../../scripts/lib/db";

const SLOPE = 1.30; // matches settings.roof_slope_multiplier default
// FEMA / Oak Ridge "USA Structures" — US-wide building footprints with a
// precomputed SQFEET (plan/footprint area) + HEIGHT. Free, queryable.
const USA = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0";

async function footprint(lat: number, lng: number): Promise<number | null> {
  // small envelope (~35m) around the stored centroid; the house is the largest
  // footprint (ignore sheds/pools under ~250 sqft).
  const d = 0.00032;
  const env = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  const url = `${USA}/query?geometry=${encodeURIComponent(env)}&geometryType=esriGeometryEnvelope&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=SQFEET&returnGeometry=false&f=json`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Chrome/120" } });
    if (!res.ok) return null;
    const j = (await res.json()) as { features?: { attributes: { SQFEET: number } }[] };
    const sqfts = (j.features ?? []).map((f) => Number(f.attributes.SQFEET)).filter((n) => n > 250);
    return sqfts.length ? Math.max(...sqfts) : null;
  } catch { return null; }
}

async function main() {
  const client = db();
  let samples: { situs: string; lat: number; lng: number; living: number | null; squares: number | null }[] = [];

  const cli = process.argv.slice(2);
  if (cli.length) {
    samples = cli.map((s) => { const [situs, lat, lng] = s.split("|"); return { situs, lat: +lat, lng: +lng, living: null, squares: null }; });
  } else {
    // a spread of single-family homes with coords + living area
    const { data } = await client.rpc("properties_in_bbox", {
      min_lng: -82.78, min_lat: 27.74, max_lng: -82.62, max_lat: 27.90, // St Petersburg
      use_buckets: ["single"], max_rows: 3000,
    });
    const rows = (data as { situs_address: string; lng: number; lat: number; roofing_squares: number | null; year_built: number | null }[] ?? [])
      .filter((r) => r.roofing_squares && r.roofing_squares > 8);
    for (let i = 0; i < rows.length && samples.length < 8; i += Math.floor(rows.length / 8) + 1) {
      const r = rows[i];
      const { data: p } = await client.from("properties").select("building_sqft, roofing_squares").eq("situs_address", r.situs_address).limit(1).single();
      samples.push({ situs: r.situs_address, lat: r.lat, lng: r.lng, living: (p as { building_sqft: number | null })?.building_sqft ?? null, squares: r.roofing_squares });
    }
  }

  console.log("situs | living_sqft | current_sqrs | footprint_sqft | footprint_sqrs | delta");
  console.log("-".repeat(100));
  for (const s of samples) {
    const fp = await footprint(s.lat, s.lng);
    const fpSqrs = fp ? Math.round((fp * SLOPE) / 100) : null;
    const cur = s.squares ?? (s.living ? Math.floor((s.living * SLOPE) / 100) : null);
    const delta = fpSqrs != null && cur != null ? `${fpSqrs - cur > 0 ? "+" : ""}${fpSqrs - cur}` : "?";
    console.log(`${s.situs.slice(0, 30).padEnd(30)} | ${String(s.living ?? "?").padStart(10)} | ${String(cur ?? "?").padStart(11)} | ${String(fp ? Math.round(fp) : "no bldg").padStart(13)} | ${String(fpSqrs ?? "?").padStart(13)} | ${delta}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
