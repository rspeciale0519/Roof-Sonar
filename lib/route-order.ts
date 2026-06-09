import type { MapProperty } from "./types";

/**
 * Nearest-neighbor route ordering from a chosen start (PRD: Route Export Spec
 * — no paid optimization API). Good enough for door-knocking loops.
 */
export function nearestNeighborOrder(stops: MapProperty[], startId?: number): MapProperty[] {
  if (stops.length <= 2) return [...stops];
  const remaining = [...stops];
  const startIdx = startId != null ? Math.max(0, remaining.findIndex((s) => s.id === startId)) : 0;
  const ordered: MapProperty[] = remaining.splice(startIdx, 1);

  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = sqDist(last, remaining[i]);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    ordered.push(remaining.splice(best, 1)[0]);
  }
  return ordered;
}

function sqDist(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  // Equirectangular approximation is plenty at neighborhood scale.
  const x = (a.lng - b.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = a.lat - b.lat;
  return x * x + y * y;
}
