import type { MapProperty } from "./types";
import { roofAgeLabel, occLabel } from "./types";

/** Route CSV per PRD: stop #, address, roof age, squares, owner, occupancy, lat, lon. */
export function routeCsv(ordered: MapProperty[]): string {
  const header = ["Stop", "Address", "Roof Age", "Roofing Squares", "Owner Name", "Occupancy", "Lat", "Lon"];
  const rows = ordered.map((p, i) => [
    String(i + 1),
    p.situs_address,
    roofAgeLabel(p),
    p.roofing_squares != null ? `${p.roofing_squares} sqrs` : "",
    p.owner_name ?? "",
    occLabel(p.occupancy),
    p.lat.toFixed(6),
    p.lng.toFixed(6),
  ]);
  return [header, ...rows]
    .map((r) => r.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(","))
    .join("\n");
}

/**
 * Google Maps directions links, chunked to <=10 waypoints per leg (Maps URL
 * limit). Legs overlap by one stop so reps drive a continuous route.
 */
export function googleMapsLinks(ordered: MapProperty[]): string[] {
  const links: string[] = [];
  const MAX = 10;
  for (let i = 0; i < ordered.length - 1; i += MAX - 1) {
    const leg = ordered.slice(i, i + MAX);
    if (leg.length < 2) break;
    const path = leg.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("/");
    links.push(`https://www.google.com/maps/dir/${path}`);
  }
  return links;
}

export function downloadFile(filename: string, content: string, mime = "text/csv"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
