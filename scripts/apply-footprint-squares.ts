/**
 * Footprint-based roofing squares for one county. The living-area estimate runs
 * 20-33% low vs a real roof trace; the actual roof plan area is the building
 * FOOTPRINT (FEMA / Oak Ridge "USA Structures", precomputed SQFEET) — the
 * automated equivalent of tracing the roof in Planimeter.
 *
 * For a county we (1) bulk-download every footprint inside the county bbox via
 * OBJECTID-paged ArcGIS queries, (2) build an in-memory grid index, (3) for
 * each geocoded property point match the footprint that CONTAINS the point
 * (ray-cast point-in-polygon), else the nearest footprint within ~15 m, then
 * SQFEET x slope / 100 = roofing squares, written via set_footprint_squares.
 * Living-area stays the fallback wherever no footprint matches.
 *
 *   npx tsx scripts/apply-footprint-squares.ts --selftest        # offline, vs Planimeter
 *   npx tsx scripts/apply-footprint-squares.ts Pinellas --dry    # match only, no write
 *   npx tsx scripts/apply-footprint-squares.ts Pinellas --limit 20000
 *   npx tsx scripts/apply-footprint-squares.ts Pinellas
 *
 * Big counties: NODE_OPTIONS=--max-old-space-size=4096 npx tsx ... Hillsborough
 */
import { db } from "./lib/db";

const USA = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/USA_Structures_View/FeatureServer/0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36";
const SLOPE = 1.3; // display only; the DB recomputes from settings.roof_slope_multiplier
const MIN_SQFT = 200; // ignore sheds/pools
const MAX_NEAR = 0.000135; // ~15 m, nearest-building fallback radius (degrees lat)
const CELL = 0.003; // ~330 m grid cell
const PAGE = 2000; // USA Structures maxRecordCount
const POOL = 8; // concurrent tile downloads
const TILE = 0.03; // ~3.3 km download tile — parallelism + keeps OID paging shallow

interface BBox { minLng: number; minLat: number; maxLng: number; maxLat: number }
interface Foot { sqft: number; ring: number[]; minLng: number; minLat: number; maxLng: number; maxLat: number; cx: number; cy: number }
interface Feature { attributes: { OBJECTID: number; SQFEET: number }; geometry?: { rings?: number[][][] } }

async function fetchJson(url: string): Promise<Feature[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { features?: Feature[]; error?: { message: string } };
      if (j.error) throw new Error(j.error.message);
      return j.features ?? [];
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return [];
}

/** Split a bbox into ~TILE-degree tiles so downloads parallelize and OID paging stays shallow. */
function tilesOf(b: BBox): BBox[] {
  const out: BBox[] = [];
  for (let lng = b.minLng; lng < b.maxLng; lng += TILE)
    for (let lat = b.minLat; lat < b.maxLat; lat += TILE)
      out.push({ minLng: lng, minLat: lat, maxLng: Math.min(lng + TILE, b.maxLng), maxLat: Math.min(lat + TILE, b.maxLat) });
  return out;
}

/** All footprints intersecting one tile, OBJECTID-paged (stable, no deep-offset cap). */
async function downloadTile(t: BBox): Promise<Feature[]> {
  const env = `${t.minLng},${t.minLat},${t.maxLng},${t.maxLat}`;
  const all: Feature[] = [];
  let lastOid = 0;
  for (;;) {
    const url = `${USA}/query?where=${encodeURIComponent(`OBJECTID>${lastOid}`)}` +
      `&geometry=${encodeURIComponent(env)}&geometryType=esriGeometryEnvelope&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent("OBJECTID,SQFEET")}` +
      `&returnGeometry=true&geometryPrecision=6&outSR=4326&orderByFields=OBJECTID&resultRecordCount=${PAGE}&f=json`;
    const feats = await fetchJson(url);
    if (feats.length === 0) break;
    all.push(...feats);
    lastOid = feats[feats.length - 1].attributes.OBJECTID;
    if (feats.length < PAGE) break;
  }
  return all;
}

/** Run fn over items with a fixed concurrency pool. */
async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>): Promise<void> {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await fn(items[i], i); }
  }));
}

class Grid {
  foot: Foot[] = [];
  private map = new Map<string, number[]>();
  private static EMPTY: number[] = [];

  add(f: Foot): void {
    const i = this.foot.length;
    this.foot.push(f);
    const x0 = Math.floor(f.minLng / CELL), x1 = Math.floor(f.maxLng / CELL);
    const y0 = Math.floor(f.minLat / CELL), y1 = Math.floor(f.maxLat / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x}:${y}`;
      let a = this.map.get(k);
      if (!a) { a = []; this.map.set(k, a); }
      a.push(i);
    }
  }
  cell(lng: number, lat: number): number[] {
    return this.map.get(`${Math.floor(lng / CELL)}:${Math.floor(lat / CELL)}`) ?? Grid.EMPTY;
  }
  *neighborhood(lng: number, lat: number): Generator<number> {
    const cx = Math.floor(lng / CELL), cy = Math.floor(lat / CELL);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      const a = this.map.get(`${x}:${y}`);
      if (a) yield* a;
    }
  }
}

function toFoot(f: Feature): Foot | null {
  const sqft = Number(f.attributes.SQFEET);
  const ring0 = f.geometry?.rings?.[0];
  if (!ring0 || ring0.length < 4 || !(sqft > 0)) return null;
  const ring: number[] = [];
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity, sx = 0, sy = 0, n = 0;
  for (let i = 0; i < ring0.length; i++) {
    const x = ring0[i][0], y = ring0[i][1];
    ring.push(x, y);
    if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
    if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
    // skip the closing vertex (== first) when averaging the centroid
    if (i < ring0.length - 1) { sx += x; sy += y; n++; }
  }
  return { sqft, ring, minLng, minLat, maxLng, maxLat, cx: sx / n, cy: sy / n };
}

function pointInRing(ring: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Footprint area for a point: containing polygon (largest if overlap), else nearest within ~15 m. */
function match(grid: Grid, lng: number, lat: number): { sqft: number; near: boolean } | null {
  let bestSqft = 0;
  for (const idx of grid.cell(lng, lat)) {
    const f = grid.foot[idx];
    if (f.sqft < MIN_SQFT || lng < f.minLng || lng > f.maxLng || lat < f.minLat || lat > f.maxLat) continue;
    if (pointInRing(f.ring, lng, lat) && f.sqft > bestSqft) bestSqft = f.sqft;
  }
  if (bestSqft > 0) return { sqft: Math.round(bestSqft), near: false };

  let nd = Infinity, ns = 0;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const idx of grid.neighborhood(lng, lat)) {
    const f = grid.foot[idx];
    if (f.sqft < MIN_SQFT) continue;
    const dx = (lng - f.cx) * cosLat, dy = lat - f.cy;
    const d = Math.hypot(dx, dy);
    if (d < nd) { nd = d; ns = f.sqft; }
  }
  return nd <= MAX_NEAR ? { sqft: Math.round(ns), near: true } : null;
}

async function buildGrid(b: BBox, label: string): Promise<Grid> {
  const grid = new Grid();
  const seen = new Set<number>(); // dedup footprints that straddle tile borders
  const tiles = tilesOf(b);
  let done = 0;
  await pool(tiles, POOL, async (t) => {
    const feats = await downloadTile(t);
    for (const f of feats) {
      const oid = f.attributes.OBJECTID;
      if (seen.has(oid)) continue;
      seen.add(oid);
      const ft = toFoot(f);
      if (ft) grid.add(ft);
    }
    if (++done % 20 === 0 || done === tiles.length) {
      console.log(`  ${label}: ${done}/${tiles.length} tiles, ${grid.foot.length.toLocaleString()} footprints…`);
    }
  });
  console.log(`  ${label}: ${grid.foot.length.toLocaleString()} footprints loaded`);
  return grid;
}

interface Pt { id: number; lng: number; lat: number }

async function loadCountyPoints(county: string, limit: number): Promise<Pt[]> {
  const pts: Pt[] = [];
  let after = 0;
  // PostgREST caps RPC result rows (db-max-rows), so page until a call returns
  // ZERO rows — never assume a short page is the last one.
  for (;;) {
    const { data, error } = await db().rpc("county_property_points", { p_county: county, p_after_id: after, p_limit: 50000 });
    if (error) throw new Error(`county_property_points: ${error.message}`);
    const rows = (data as Pt[]) ?? [];
    if (rows.length === 0) break;
    for (const r of rows) { pts.push({ id: Number(r.id), lng: Number(r.lng), lat: Number(r.lat) }); }
    after = Number(rows[rows.length - 1].id);
    if (limit && pts.length >= limit) return pts.slice(0, limit);
    if (pts.length % 100000 < rows.length) console.log(`  loaded ${pts.length.toLocaleString()} points…`);
  }
  return pts;
}

function bboxOf(pts: Pt[]): BBox {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const p of pts) {
    if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
  }
  const pad = 0.003;
  return { minLng: minLng - pad, minLat: minLat - pad, maxLng: maxLng + pad, maxLat: maxLat + pad };
}

async function writeUpdates(rows: { id: number; sqft: number; near: boolean }[]): Promise<number> {
  let written = 0;
  const BATCH = 1000;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data, error } = await db().rpc("set_footprint_squares", { p_rows: rows.slice(i, i + BATCH) });
    if (error) throw new Error(`set_footprint_squares: ${error.message}`);
    written += Number(data) || 0;
    if ((i / BATCH) % 20 === 0) console.log(`  wrote ${written.toLocaleString()}…`);
  }
  return written;
}

// Rob's Planimeter readings (roof plan area, sq ft) + the stored coords.
const SELFTEST = [
  { situs: "8201 46TH ST N PINELLAS PARK", lng: -82.6957006, lat: 27.8466835, plan: 2245.78, living: 1707 },
  { situs: "5251 39TH AVE N ST PETERSBURG", lng: -82.7051366, lat: 27.8075657, plan: 1000.72, living: 801 },
  { situs: "12322 68TH ST PINELLAS PARK", lng: -82.7332063, lat: 27.8845087, plan: 2246.92, living: 1686 },
  { situs: "11904 69TH WAY PINELLAS PARK", lng: -82.735650, lat: 27.8805527, plan: 2351.67, living: 1568 },
  { situs: "10273 109TH AVE LARGO", lng: -82.7810709, lat: 27.8721644, plan: 1388.72, living: 998 },
];

async function selftest(): Promise<void> {
  const pad = 0.002;
  const b: BBox = {
    minLng: Math.min(...SELFTEST.map((h) => h.lng)) - pad,
    minLat: Math.min(...SELFTEST.map((h) => h.lat)) - pad,
    maxLng: Math.max(...SELFTEST.map((h) => h.lng)) + pad,
    maxLat: Math.max(...SELFTEST.map((h) => h.lat)) + pad,
  };
  console.log("Self-test: bulk-download grid path vs Planimeter (5 homes)\n");
  const grid = await buildGrid(b, "selftest");
  console.log("\nsitus                          | fp_sqft | fp_sq | plan_sq | living_sq | fp_err | living_err | src");
  console.log("-".repeat(104));
  for (const h of SELFTEST) {
    const m = match(grid, h.lng, h.lat);
    const fpSq = m ? Math.round((m.sqft * SLOPE) / 100) : null;
    const planSq = Math.round((h.plan * SLOPE) / 100);
    const livingSq = Math.round((h.living * SLOPE) / 100);
    const fpErr = m ? `${(((m.sqft - h.plan) / h.plan) * 100).toFixed(0)}%` : "—";
    const livErr = `${(((h.living - h.plan) / h.plan) * 100).toFixed(0)}%`;
    const src = m ? (m.near ? "near" : "pip") : "none";
    console.log(
      `${h.situs.padEnd(30)} | ${String(m ? m.sqft : "—").padStart(7)} | ${String(fpSq ?? "—").padStart(5)} | ` +
      `${String(planSq).padStart(7)} | ${String(livingSq).padStart(9)} | ${fpErr.padStart(6)} | ${livErr.padStart(10)} | ${src}`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) { await selftest(); return; }

  const dry = args.includes("--dry");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? parseInt(args[limIdx + 1], 10) : 0;
  const county = args.find((a) => !a.startsWith("--") && a !== String(limit));
  if (!county) { console.error("usage: tsx scripts/apply-footprint-squares.ts <County> [--dry] [--limit N] | --selftest"); process.exit(1); }
  const County = county.charAt(0).toUpperCase() + county.slice(1).toLowerCase();

  console.log(`Footprint squares for ${County}${dry ? " (dry run)" : ""}${limit ? ` (limit ${limit})` : ""}`);
  const pts = await loadCountyPoints(County, limit);
  if (pts.length === 0) { console.error(`No geocoded property points for county '${County}'.`); process.exit(1); }
  const b = bboxOf(pts);
  console.log(`${pts.length.toLocaleString()} property points; bbox ${b.minLng.toFixed(3)},${b.minLat.toFixed(3)} → ${b.maxLng.toFixed(3)},${b.maxLat.toFixed(3)}`);

  const grid = await buildGrid(b, County);

  const updates: { id: number; sqft: number; near: boolean }[] = [];
  let pip = 0, near = 0, none = 0;
  for (const p of pts) {
    const m = match(grid, p.lng, p.lat);
    if (!m) { none++; continue; }
    if (m.near) near++; else pip++;
    updates.push({ id: p.id, sqft: m.sqft, near: m.near });
  }
  const matched = pip + near;
  const pct = (n: number) => `${((n / pts.length) * 100).toFixed(1)}%`;
  console.log(`Matched ${matched.toLocaleString()}/${pts.length.toLocaleString()} (${pct(matched)}) — pip ${pip.toLocaleString()} (${pct(pip)}), near ${near.toLocaleString()} (${pct(near)}), none ${none.toLocaleString()} (${pct(none)})`);

  if (dry) { console.log("Dry run — no writes."); return; }
  const written = await writeUpdates(updates);
  console.log(`Done. ${written.toLocaleString()} properties updated with footprint squares.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
