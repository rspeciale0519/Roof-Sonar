/**
 * Scrape Marion County's legacy CDPlus permit system (1995 – Nov 2025, frozen
 * at the Tyler migration) for roofing permits, via the public "Report by Type
 * and Date Range" form. Single issuing authority county-wide, so this is the
 * whole county incl. The Villages' Marion portion.
 *
 *   npx tsx scripts/fetch-marion-permits.ts   # -> data/inbox/marion-roof-permits.csv
 *
 * Result rows have no date column, but permit numbers encode YYYYMM; rows
 * where that decode is implausible fall back to the query window's year.
 * Cancelled/void rows are kept in the CSV (STATUS column) — the ingest
 * filters them — so the raw scrape stays a faithful archive.
 */
import fs from "node:fs";
import path from "node:path";

const URL = "https://bcc.marionfl.org/cdplus/PermitInquiry.aspx?SearchType=T";
const OUT = path.join("data", "inbox", "marion-roof-permits.csv");
const TYPES = ["R23ROF", "R18ROF", "R074", "C23ROF", "C18ROF"];
const FIRST_YEAR = 1995;
const LAST_YEAR = 2026; // system frozen ~Nov 2025; 2026 window catches stragglers
const DELAY_MS = 1500;
const SPLIT_THRESHOLD = 4000; // suspiciously large result -> re-query quarters

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

interface FormState { viewstate: string; generator: string; validation: string; cookie: string }

function extractState(html: string, cookie: string): FormState {
  const grab = (name: string) => html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1] ?? "";
  return { viewstate: grab("__VIEWSTATE"), generator: grab("__VIEWSTATEGENERATOR"), validation: grab("__EVENTVALIDATION"), cookie };
}

async function getForm(): Promise<FormState> {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`GET form: HTTP ${res.status}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return extractState(await res.text(), cookie);
}

interface Row { permit: string; status: string; type: string; parcel: string; address: string; owner: string; contractor: string }

function parseRows(html: string, typeCode: string): Row[] {
  const rows: Row[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()
    );
    if (cells.length < 6 || cells[0] === "Permit Number") continue;
    const statusType = cells[1];
    const marker = ` - ${typeCode} - `;
    const idx = statusType.indexOf(marker);
    rows.push({
      permit: cells[0],
      status: idx >= 0 ? statusType.slice(0, idx) : statusType,
      type: typeCode,
      parcel: cells[2],
      address: cells[3],
      owner: cells[4],
      contractor: cells[5] ?? "",
    });
  }
  return rows;
}

async function query(state: FormState, type: string, from: string, to: string, attempt = 1): Promise<{ rows: Row[]; state: FormState }> {
  try {
    const body = new URLSearchParams({
      __VIEWSTATE: state.viewstate,
      __VIEWSTATEGENERATOR: state.generator,
      __EVENTVALIDATION: state.validation,
      ddlType: type,
      tbxFrmDate: from,
      tbxToDate: to,
      btnQuery: "Query",
    });
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: state.cookie },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return { rows: parseRows(html, type), state: extractState(html, state.cookie) };
  } catch (err) {
    if (attempt >= 4) throw err;
    console.warn(`  ${type} ${from}-${to} failed (${err instanceof Error ? err.message : err}); retry ${attempt}/3`);
    await sleep(attempt * 5000);
    return query(await getForm(), type, from, to, attempt + 1);
  }
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out = fs.createWriteStream(OUT);
  out.write("PERMIT_NUMBER,STATUS,TYPE,PARCEL,ADDRESS,OWNER,CONTRACTOR,WINDOW_YEAR\n");
  let total = 0;
  let state = await getForm();

  for (const type of TYPES) {
    let typeTotal = 0;
    for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
      const windows: [string, string][] = [[`01/01/${year}`, `12/31/${year}`]];
      while (windows.length) {
        const [from, to] = windows.shift()!;
        const r = await query(state, type, from, to);
        state = r.state;
        if (r.rows.length >= SPLIT_THRESHOLD && from.startsWith("01/01") && to.startsWith("12/31")) {
          windows.unshift(
            [`01/01/${year}`, `03/31/${year}`], [`04/01/${year}`, `06/30/${year}`],
            [`07/01/${year}`, `09/30/${year}`], [`10/01/${year}`, `12/31/${year}`]
          );
          console.log(`  ${type} ${year}: ${r.rows.length} rows >= threshold, splitting to quarters`);
          await sleep(DELAY_MS);
          continue;
        }
        for (const row of r.rows) {
          out.write([row.permit, row.status, row.type, row.parcel, row.address, row.owner, row.contractor, String(year)].map(csvCell).join(",") + "\n");
        }
        total += r.rows.length;
        typeTotal += r.rows.length;
        await sleep(DELAY_MS);
      }
    }
    console.log(`${type}: ${typeTotal} rows`);
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));
  console.log(`Done: ${total} roof permit rows -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
