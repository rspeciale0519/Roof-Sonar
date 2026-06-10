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
  do_not_knock: boolean;
  pin_type_id: number | null;
  pin_label: string | null;
  pin_color: string | null;
  pin_knocked_at: string | null;
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

export type RouteStatus = "draft" | "assigned" | "in_progress" | "completed";

export interface SavedRoute {
  id: number;
  name: string;
  created_at: string;
  stop_count?: number;
  status: RouteStatus;
  rep_id: number | null;
  rep_name: string | null;
}

export interface SalesRep {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
}

export interface PinType {
  id: number;
  label: string;
  color: string;
  icon: string | null;
  expires_after_days: number | null;
  is_do_not_knock: boolean;
  counts_as_contact: boolean;
  counts_as_lead: boolean;
  archived: boolean;
  sort_order: number;
}

export interface Tag {
  id: number;
  label: string;
  archived: boolean;
}

export interface Visit {
  id: number;
  pin_type_id: number;
  pin_label: string;
  pin_color: string;
  rep_id: number | null;
  rep_name: string | null;
  route_id: number | null;
  note: string | null;
  knocked_at: string;
}

export interface PropertyNote {
  id: number;
  body: string;
  rep_name: string | null; // null = admin
  created_at: string;
}
