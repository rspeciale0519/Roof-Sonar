export interface Jurisdiction {
  slug: string;
  name: string;
  county: "Seminole" | "Volusia" | "Orange";
}

/** Mirrors the seeded jurisdictions table (PRD matrix). */
export const JURISDICTIONS: Jurisdiction[] = [
  { slug: "seminole-county", name: "Seminole County (unincorp.)", county: "Seminole" },
  { slug: "sanford", name: "Sanford", county: "Seminole" },
  { slug: "oviedo", name: "Oviedo", county: "Seminole" },
  { slug: "lake-mary", name: "Lake Mary", county: "Seminole" },
  { slug: "altamonte-springs", name: "Altamonte Springs", county: "Seminole" },
  { slug: "casselberry", name: "Casselberry", county: "Seminole" },
  { slug: "longwood", name: "Longwood", county: "Seminole" },
  { slug: "winter-springs", name: "Winter Springs", county: "Seminole" },
  { slug: "volusia-county", name: "Volusia County (unincorp.)", county: "Volusia" },
  { slug: "daytona-beach", name: "Daytona Beach", county: "Volusia" },
  { slug: "deltona", name: "Deltona", county: "Volusia" },
  { slug: "port-orange", name: "Port Orange", county: "Volusia" },
  { slug: "ormond-beach", name: "Ormond Beach", county: "Volusia" },
  { slug: "deland", name: "DeLand", county: "Volusia" },
  { slug: "new-smyrna-beach", name: "New Smyrna Beach", county: "Volusia" },
  { slug: "edgewater", name: "Edgewater", county: "Volusia" },
  { slug: "debary", name: "DeBary", county: "Volusia" },
  { slug: "orange-city", name: "Orange City", county: "Volusia" },
  { slug: "holly-hill", name: "Holly Hill", county: "Volusia" },
  { slug: "south-daytona", name: "South Daytona", county: "Volusia" },
  { slug: "daytona-beach-shores", name: "Daytona Beach Shores", county: "Volusia" },
  { slug: "ponce-inlet", name: "Ponce Inlet", county: "Volusia" },
  { slug: "lake-helen", name: "Lake Helen", county: "Volusia" },
  { slug: "oak-hill", name: "Oak Hill", county: "Volusia" },
  { slug: "pierson", name: "Pierson", county: "Volusia" },
  { slug: "orange-county", name: "Orange County (unincorp.)", county: "Orange" },
  { slug: "orlando", name: "Orlando", county: "Orange" },
  { slug: "winter-park", name: "Winter Park", county: "Orange" },
  { slug: "apopka", name: "Apopka", county: "Orange" },
  { slug: "ocoee", name: "Ocoee", county: "Orange" },
  { slug: "winter-garden", name: "Winter Garden", county: "Orange" },
  { slug: "maitland", name: "Maitland", county: "Orange" },
  { slug: "belle-isle", name: "Belle Isle", county: "Orange" },
  { slug: "edgewood", name: "Edgewood", county: "Orange" },
  { slug: "eatonville", name: "Eatonville", county: "Orange" },
  { slug: "oakland", name: "Oakland", county: "Orange" },
  { slug: "windermere", name: "Windermere", county: "Orange" },
  { slug: "bay-lake", name: "Bay Lake", county: "Orange" },
  { slug: "lake-buena-vista", name: "Lake Buena Vista", county: "Orange" },
];

export const COUNTIES = ["Seminole", "Volusia", "Orange"] as const;
