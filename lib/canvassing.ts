import type { MapProperty } from "./types";

const EARTH_M = 6371000;

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(a));
}

/** Snap a tap to the closest loaded property within maxMeters (wrong-house guard). */
export function nearestProperty(
  properties: Pick<MapProperty, "id" | "lng" | "lat">[],
  lng: number,
  lat: number,
  maxMeters: number
): Pick<MapProperty, "id" | "lng" | "lat"> | null {
  let best: Pick<MapProperty, "id" | "lng" | "lat"> | null = null;
  let bestD = Infinity;
  for (const p of properties) {
    const d = haversineMeters(lng, lat, p.lng, p.lat);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return bestD <= maxMeters ? best : null;
}
