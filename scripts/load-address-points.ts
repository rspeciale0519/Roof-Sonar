/**
 * Load a county address-point layer into the address_points staging table and
 * run the geocode join (PRD: Geocoding — parcel-ID join, situs fallback).
 *
 *   npx tsx scripts/load-address-points.ts <seminole|volusia|orange> <file> [--parcel COL] [--situs COL] [--lng COL] [--lat COL]
 *
 * Accepts GeoJSON (FeatureCollection of points) or CSV with lon/lat columns.
 * Sources: Seminole GIS Addresses layer, Volusia open-data address layer
 * (opendata-volusiacountyfl.hub.arcgis.com), Orange OCPA PARCELS_SITUS point
 * layer (OCPA GIS downloads / ocgis4.ocfl.net) — export each as GeoJSON/CSV.
 */
import fs from "node:fs";
import { parse } from "csv-parse/sync";
import { db } from "./lib/db";
import { normalizeAddress } from "./lib/normalize";

const COUNTY: Record<string, string> = { seminole: "Seminole", volusia: "Volusia", orange: "Orange" };

interface Point {
  parcel_number: string | null;
  situs_address: string | null;
  lng: number;
  lat: number;
  dor_use_code: string | null;
}

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function fromGeojson(file: string, parcelCol: string, situsCol: string, useCol: string): Point[] {
  const fc = JSON.parse(fs.readFileSync(file, "utf8"));
  const out: Point[] = [];
  for (const f of fc.features ?? []) {
    if (f.geometry?.type !== "Point") continue;
    const [lng, lat] = f.geometry.coordinates;
    out.push({
      parcel_number: f.properties?.[parcelCol] ?? null,
      situs_address: normalizeAddress(f.properties?.[situsCol]) || null,
      lng,
      lat,
      dor_use_code: f.properties?.[useCol] ?? null,
    });
  }
  return out;
}

function fromCsv(file: string, parcelCol: string, situsCol: string, lngCol: string, latCol: string, useCol: string): Point[] {
  const rows = parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  return rows
    .map((r) => ({
      parcel_number: r[parcelCol] || null,
      situs_address: normalizeAddress(r[situsCol]) || null,
      lng: parseFloat(r[lngCol]),
      lat: parseFloat(r[latCol]),
      dor_use_code: r[useCol] || null,
    }))
    .filter((p) => !isNaN(p.lng) && !isNaN(p.lat));
}

async function main() {
  const [countyArg, file] = process.argv.slice(2);
  const county = COUNTY[countyArg?.toLowerCase() ?? ""];
  if (!county || !file) {
    console.error("Usage: npx tsx scripts/load-address-points.ts <seminole|volusia|orange> <file.geojson|csv> [--parcel COL] [--situs COL] [--lng COL] [--lat COL]");
    process.exit(1);
  }
  const parcelCol = arg("--parcel", "PARCEL_ID");
  const situsCol = arg("--situs", "ADDRESS");
  const lngCol = arg("--lng", "LON");
  const latCol = arg("--lat", "LAT");
  const useCol = arg("--usecode", "DOR_USE_CODE");

  const points = /\.(geojson|json)$/i.test(file)
    ? fromGeojson(file, parcelCol, situsCol, useCol)
    : fromCsv(file, parcelCol, situsCol, lngCol, latCol, useCol);
  console.log(`${points.length} address points parsed; replacing ${county} staging rows…`);

  const client = db();
  await client.from("address_points").delete().eq("county", county);
  const BATCH = 2000;
  for (let i = 0; i < points.length; i += BATCH) {
    const { error } = await client.from("address_points").insert(points.slice(i, i + BATCH).map((p) => ({ ...p, county })));
    if (error) throw new Error(error.message);
    if (i % 50000 === 0) console.log(`  ${i + Math.min(BATCH, points.length - i)} staged…`);
  }

  console.log("Running geocode join…");
  const { data, error } = await client.rpc("geocode_join_address_points", { p_county: county });
  if (error) throw new Error(error.message);
  const r = Array.isArray(data) ? data[0] : data;
  console.log(`parcel joins: ${r.matched_parcel}, situs joins: ${r.matched_situs}, new failures logged: ${r.failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
