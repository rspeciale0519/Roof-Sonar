/**
 * Shared-password gate (PRD: Auth). The session cookie holds a SHA-256 of the
 * app password + static salt; middleware recomputes and compares. Edge-safe
 * (Web Crypto only). Roles deferred.
 */
export const SESSION_COOKIE = "rr_session";
const SALT = "roofradar-v1";

export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}::${SALT}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
