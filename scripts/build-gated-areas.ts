/**
 * Build gated-community suggestion polygons per county (plan:
 * .claude/plans/feature-gated-communities.md).
 *
 * Stages private-road segments (county GIS where available, OSM private-access
 * ways otherwise) + OSM gate nodes into gated_road_segments/gated_gate_points,
 * then calls the build_gated_areas() RPC which clusters segments (DBSCAN),
 * buffers them into polygons, and tiers them: gate nearby = high, else medium.
 *
 *   npx tsx scripts/build-gated-areas.ts            # all configured counties
 *   npx tsx scripts/build-gated-areas.ts Orange     # one county
 */
import { db } from "./lib/db";

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const OVERPASS_UA = "RoofSonar-gated-areas/1.0 (contact: rob@roofsonar.com)";
const GATE_FILTER = `["barrier"~"^(gate|lift_gate|swing_gate)$"]`;
// residential street classes only — drops driveways/parking aisles tagged `service`
const OSM_ROAD_FILTER = `["highway"~"^(residential|unclassified|tertiary|living_street|secondary)$"]["access"~"^(private|no)$"]`;

interface CountyConfig {
  county: "Orange" | "Seminole" | "Volusia";
  bbox: [number, number, number, number]; // s, w, n, e
  roads: { kind: "arcgis"; url: string; where: string } | { kind: "osm" };
}

const COUNTIES: CountyConfig[] = [
  {
    county: "Orange",
    bbox: [28.34, -81.66, 28.79, -80.86],
    roads: {
      kind: "arcgis",
      url: "https://ocgis4.ocfl.net/arcgis/rest/services/AGOL_Open_Data/MapServer/67",
      where: "MAINTENANCE='Private'",
    },
  },
  {
    county: "Seminole",
    bbox: [28.55, -81.46, 28.9, -80.95],
    roads: { kind: "osm" }, // county publishes no maintained-by roads layer
  },
  {
    county: "Volusia",
    bbox: [28.78, -81.51, 29.44, -80.73],
    roads: {
      kind: "arcgis",
      url: "https://maps5.vcgov.org/arcgis/rest/services/Open_Data/Open_Data_4/FeatureServer/7",
      // HOA = private; NO COUNTY MAINTENANCE = private unincorporated roads.
      // City-limits streets carry no maintenance attribution (known gap).
      where: "Maintenance IN ('HOMEOWNERS ASSOCIATION','NO COUNTY MAINTENANCE')",
    },
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lineWkt = (coords: [number, number][]) =>
  `SRID=4326;LINESTRING(${coords.map(([x, y]) => `${x} ${y}`).join(",")})`;

interface OverpassElement {
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
}
interface OverpassResponse {
  elements?: OverpassElement[];
}

async function overpass(query: string, attempt = 0): Promise<OverpassResponse> {
  const url = OVERPASS[attempt % OVERPASS.length];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": OVERPASS_UA },
      body: new URLSearchParams({ data: query }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as OverpassResponse;
  } catch (err) {
    if (attempt >= 6) throw err;
    const backoff = Math.min(30000 * (attempt + 1), 120000); // 429s want a real pause
    console.warn(`  overpass ${url.split("/")[2]} failed (${err instanceof Error ? err.message : err}); retry in ${backoff / 1000}s`);
    await sleep(backoff);
    return overpass(query, attempt + 1);
  }
}

async function fetchArcgisSegments(cfg: { url: string; where: string }): Promise<string[]> {
  const wkts: string[] = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({
      f: "json",
      where: cfg.where,
      outFields: "OBJECTID",
      returnGeometry: "true",
      outSR: "4326",
      resultOffset: String(offset),
      resultRecordCount: "1000",
    });
    const res = await fetch(`${cfg.url}/query?${qs}`);
    if (!res.ok) throw new Error(`arcgis HTTP ${res.status}`);
    const json = (await res.json()) as { features?: { geometry?: { paths?: [number, number][][] } }[]; error?: unknown };
    if (json.error) throw new Error(JSON.stringify(json.error));
    const feats = json.features ?? [];
    for (const f of feats) {
      for (const path of f.geometry?.paths ?? []) {
        if (path.length >= 2) wkts.push(lineWkt(path));
      }
    }
    if (feats.length < 1000) break;
    offset += feats.length;
    await sleep(500);
  }
  return wkts;
}

async function fetchOsmSegments(bbox: CountyConfig["bbox"]): Promise<string[]> {
  const q = `[out:json][timeout:180];way${OSM_ROAD_FILTER}(${bbox.join(",")});out geom;`;
  const json = await overpass(q);
  const wkts: string[] = [];
  for (const el of json.elements ?? []) {
    const geom = (el.geometry ?? []) as { lat: number; lon: number }[];
    // split long ways into pairwise mini-segments so DBSCAN density behaves
    // like the county block-level centerlines
    for (let i = 0; i + 1 < geom.length; i++) {
      wkts.push(lineWkt([[geom[i].lon, geom[i].lat], [geom[i + 1].lon, geom[i + 1].lat]]));
    }
  }
  return wkts;
}

async function fetchGates(bbox: CountyConfig["bbox"]): Promise<string[]> {
  const q = `[out:json][timeout:180];node${GATE_FILTER}(${bbox.join(",")});out;`;
  const json = await overpass(q);
  return (json.elements ?? [])
    .filter((el) => el.lat != null && el.lon != null)
    .map((el) => `SRID=4326;POINT(${el.lon} ${el.lat})`);
}

async function stage(table: string, county: string, wkts: string[]): Promise<void> {
  const client = db();
  const del = await client.from(table).delete().eq("county", county);
  if (del.error) throw new Error(`${table} clear failed: ${del.error.message}`);
  const BATCH = 500;
  for (let i = 0; i < wkts.length; i += BATCH) {
    const { error } = await client.from(table).insert(wkts.slice(i, i + BATCH).map((geom) => ({ county, geom })));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function main() {
  const only = process.argv[2];
  const targets = COUNTIES.filter((c) => !only || c.county.toLowerCase() === only.toLowerCase());
  if (targets.length === 0) {
    console.error(`Unknown county '${only}'. Configured: ${COUNTIES.map((c) => c.county).join(", ")}`);
    process.exit(1);
  }
  const client = db();
  for (const cfg of targets) {
    console.log(`=== ${cfg.county} ===`);
    const segments = cfg.roads.kind === "arcgis" ? await fetchArcgisSegments(cfg.roads) : await fetchOsmSegments(cfg.bbox);
    console.log(`  ${segments.length} private-road segments (${cfg.roads.kind})`);
    await stage("gated_road_segments", cfg.county, segments);

    await sleep(2000); // politeness between overpass calls
    const gates = await fetchGates(cfg.bbox);
    console.log(`  ${gates.length} gate points (osm)`);
    await stage("gated_gate_points", cfg.county, gates);

    const { data, error } = await client.rpc("build_gated_areas", { p_county: cfg.county });
    if (error) {
      console.error(`  build_gated_areas RPC failed (${error.message}).`);
      console.error(`  Run via CLI instead: npx supabase db query "SET statement_timeout = '30min'; SELECT * FROM build_gated_areas('${cfg.county}')" --linked`);
      process.exitCode = 1;
      continue;
    }
    const r = Array.isArray(data) ? data[0] : data;
    console.log(`  areas inserted: ${r.inserted} (high ${r.high_count}, medium ${r.medium_count})`);
    await sleep(2000);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
