import { sameAddress } from "./normalize";

export type Occupancy = "owner" | "likely_owner" | "absentee" | "investor" | "unknown";

const CORPORATE_PATTERN =
  /\b(LLC|L L C|INC|CORP|CORPORATION|COMPANY|LTD|LP|LLP|HOLDINGS|PROPERTIES|INVESTMENTS?|VENTURES?|CAPITAL|HOMES OF|RENTALS?|REALTY|REIT|PARTNERS(HIP)?|ENTERPRISES?|GROUP|ASSOC(IATES|IATION)?|BANK|MORTGAGE|HOA)\b/;

/**
 * Owner-occupancy logic per the PRD Owner & Occupancy Module:
 *  - corporate/LLC owner name        -> investor
 *  - homestead exemption             -> owner (strongest signal: FL homestead
 *                                       requires primary residence)
 *  - mailing address == situs        -> likely_owner
 *  - otherwise                       -> absentee (tenant likely answers; the
 *                                       decision-maker is at the mailing addr)
 */
export function classifyOccupancy(
  ownerName: string | null,
  homestead: boolean,
  ownerMailingAddress: string | null,
  situsAddress: string | null
): Occupancy {
  const name = (ownerName ?? "").toUpperCase();
  if (name && CORPORATE_PATTERN.test(name) && !homestead) return "investor";
  if (homestead) return "owner";
  if (ownerMailingAddress && situsAddress && sameAddress(ownerMailingAddress, situsAddress)) {
    return "likely_owner";
  }
  if (!ownerName && !ownerMailingAddress) return "unknown";
  return "absentee";
}
