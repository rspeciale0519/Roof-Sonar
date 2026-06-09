export interface MapProperty {
  id: number;
  lng: number;
  lat: number;
  situs_address: string;
  street_number: string | null;
  roof_year: number | null;
  year_built: number | null;
  roofing_squares: number | null;
  owner_name: string | null;
  occupancy: "owner" | "likely_owner" | "absentee" | "investor" | "unknown";
  jurisdiction: string;
  last_permit_date: string | null;
}

export type AgeBucket = "0-5" | "6-10" | "11-15" | "16+" | "unknown";

export const AGE_BUCKETS: { key: AgeBucket; label: string; color: string }[] = [
  { key: "0-5", label: "0–5 yrs", color: "#22c55e" },
  { key: "6-10", label: "6–10 yrs", color: "#eab308" },
  { key: "11-15", label: "11–15 yrs", color: "#f97316" },
  { key: "16+", label: "16+ yrs", color: "#ef4444" },
  { key: "unknown", label: "Unknown / orig.", color: "#9ca3af" },
];

export const OCCUPANCIES: { key: MapProperty["occupancy"]; label: string }[] = [
  { key: "owner", label: "Owner-occupied" },
  { key: "likely_owner", label: "Likely owner" },
  { key: "absentee", label: "Rental / absentee" },
  { key: "investor", label: "Investor-owned" },
  { key: "unknown", label: "Unknown" },
];

export function ageBucket(roofYear: number | null): AgeBucket {
  if (roofYear == null) return "unknown";
  const age = new Date().getFullYear() - roofYear;
  if (age <= 5) return "0-5";
  if (age <= 10) return "6-10";
  if (age <= 15) return "11-15";
  return "16+";
}

/** Map label line 2: "18 yrs" from a permit, else "orig. '94" from year_built. */
export function roofAgeLabel(p: Pick<MapProperty, "roof_year" | "year_built">): string {
  if (p.roof_year != null) return `${new Date().getFullYear() - p.roof_year} yrs`;
  if (p.year_built != null) return `orig. '${String(p.year_built).slice(-2)}`;
  return "—";
}

export interface SavedRoute {
  id: number;
  name: string;
  created_at: string;
  stop_count?: number;
}
