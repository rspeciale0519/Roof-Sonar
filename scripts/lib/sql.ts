import { requireEnv } from "./env";

/** Project ref from the Supabase URL (https://<ref>.supabase.co). */
function projectRef(): string {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!m) throw new Error(`Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL: ${url}`);
  return m[1];
}

/**
 * Run arbitrary SQL via the Supabase Management API query endpoint — the same
 * Cloudflare-fronted path the dashboard SQL editor uses. Good for DDL and
 * admin queries the service-role PostgREST client can't issue. Note: a single
 * statement that runs past ~100s trips a Cloudflare 524, so chunk big writes.
 */
export async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const token = requireEnv("SUPABASE_ACCESS_TOKEN");
  const url = `https://api.supabase.com/v1/projects/${projectRef()}/database/query`;
  let lastErr = "";
  // The Management API's gateway flakes intermittently (500 "Failed to check
  // user auth status", 502/503/504); retry those. 4xx is a real SQL/request
  // error — surface it immediately.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (res.ok) return text ? (JSON.parse(text) as T[]) : [];
    if (res.status < 500) throw new Error(`Management API ${res.status}: ${text.slice(0, 800)}`);
    lastErr = `${res.status}: ${text.slice(0, 200)}`;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`Management API failed after retries — ${lastErr}`);
}
