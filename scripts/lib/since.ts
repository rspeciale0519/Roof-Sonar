/**
 * Parse a --since value into an ISO date (YYYY-MM-DD) lower bound, or null.
 * Accepts an absolute date ("2026-03-01") or a relative window ("90d" = 90 days
 * ago). Used by the weekly cron to re-apply only recently-issued permits — a safe
 * overlapping window, since apply_roof_permits / upsert only advance roof dates.
 */
export function parseSince(arg: string | undefined): string | null {
  if (!arg) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  const m = arg.match(/^(\d+)d$/i);
  if (m) {
    const d = new Date();
    d.setDate(d.getDate() - Number(m[1]));
    return d.toISOString().slice(0, 10);
  }
  throw new Error(`--since must be YYYY-MM-DD or Nd (e.g. 90d), got: ${arg}`);
}

/** Read --since from process.argv. */
export function sinceArg(): string | null {
  const i = process.argv.indexOf("--since");
  return parseSince(i >= 0 ? process.argv[i + 1] : undefined);
}
