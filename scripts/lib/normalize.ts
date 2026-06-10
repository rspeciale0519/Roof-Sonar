/**
 * USPS-style address normalization. Every situs/mailing address is run
 * through normalizeAddress() before any join or comparison (PRD: Geocoding).
 * This is a dependency-free normalizer; swap in libpostal later if needed.
 */

const SUFFIXES: Record<string, string> = {
  AVENUE: "AVE", AVENU: "AVE", AVNUE: "AVE", AV: "AVE",
  BOULEVARD: "BLVD", BOULV: "BLVD", BLVRD: "BLVD",
  CIRCLE: "CIR", CIRCL: "CIR", CRCLE: "CIR",
  COURT: "CT", CRT: "CT",
  COVE: "CV",
  DRIVE: "DR", DRV: "DR", DRIV: "DR",
  EXPRESSWAY: "EXPY",
  HIGHWAY: "HWY", HIWAY: "HWY", HWAY: "HWY",
  LANE: "LN", LANES: "LN",
  LOOP: "LOOP",
  PARKWAY: "PKWY", PKWAY: "PKWY", PARKWY: "PKWY",
  PLACE: "PL",
  POINT: "PT", POINTE: "PT",
  ROAD: "RD",
  SQUARE: "SQ",
  STREET: "ST", STR: "ST", STRT: "ST",
  TERRACE: "TER", TERR: "TER",
  TRAIL: "TRL", TRAILS: "TRL", TRL: "TRL",
  WAY: "WAY",
  RUN: "RUN", PATH: "PATH", PASS: "PASS", BEND: "BND", GLEN: "GLN",
  CROSSING: "XING",
};

const DIRECTIONS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
  "N.": "N", "S.": "S", "E.": "E", "W.": "W",
};

const UNIT_WORDS = /\b(APT|APARTMENT|UNIT|STE|SUITE|BLDG|BUILDING|LOT|TRLR|RM|ROOM|FL|FLOOR)\b\.?\s*#?\s*[\w-]*/g;

export function normalizeAddress(input: string | null | undefined): string {
  if (!input) return "";
  let a = input.toUpperCase().trim();
  a = a.replace(/[.,]/g, " ");
  a = a.replace(UNIT_WORDS, " ");      // strip unit designators + their values
  a = a.replace(/#\s*[\w-]+/g, " ");   // bare "# 12B"
  a = a.replace(/\s+/g, " ").trim();

  const tokens = a.split(" ").map((t) => {
    if (DIRECTIONS[t]) return DIRECTIONS[t];
    if (SUFFIXES[t]) return SUFFIXES[t];
    return t;
  });
  return tokens.join(" ").trim();
}

/** Leading house number of a normalized situs address ("1234 N MAIN ST" -> "1234"). */
export function streetNumber(situs: string | null | undefined): string | null {
  if (!situs) return null;
  const m = situs.trim().match(/^(\d+)/);
  return m ? m[1] : null;
}

/**
 * Loose equality for "owner mailing address == situs address". Compares
 * normalized house number + street tokens, ignoring city/state/zip tails
 * when one side carries them.
 */
export function sameAddress(aRaw: string, bRaw: string): boolean {
  const a = normalizeAddress(aRaw);
  const b = normalizeAddress(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 8 && longer.startsWith(shorter);
}
