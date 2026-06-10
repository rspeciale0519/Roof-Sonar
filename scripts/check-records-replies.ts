/**
 * Records-request reply checker. Scans the rob@roofsonar.com inbox over IMAP
 * for replies from the 33 request jurisdictions, classifies each (data /
 * fee quote / question / acknowledgment), files data attachments into
 * data/inbox/<slug>/ for ingest-file.ts, and prints a digest.
 *
 *   npm run records:replies            # check new mail since the last run
 *   npm run records:replies -- --all   # rescan everything since the campaign start
 *
 * Idempotent: processed message UIDs live in data/records-replies-log.json
 * and are never handled twice. Reuses the SMTP_* creds (IMAP on :993).
 */
import fs from "node:fs";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type Attachment } from "mailparser";
import { requireEnv } from "./lib/env";

const CAMPAIGN_START = new Date("2026-06-10");
const LOG_PATH = path.join("data", "records-replies-log.json");
const DATA_EXT = /\.(csv|xlsx?|zip|txt)$/i;
const PDF_EXT = /\.pdf$/i;
// records portals send confirmations from their own domains, not the city's
const PORTAL_DOMAINS = ["justfoia.com", "nextrequest.com", "govqa.us", "mycusthelp.com"];

interface Recipient {
  slug: string;
  name: string;
  to: string;
  cc: string[];
}

interface ReplyEntry {
  uid: number;
  slug: string;
  from: string;
  subject: string;
  classification: "data" | "fee" | "question" | "ack" | "bounce" | "portal";
  attachments: string[];
  date: string;
}

function loadRecipients(): Recipient[] {
  return (JSON.parse(fs.readFileSync(path.join("scripts", "records", "recipients.json"), "utf8")) as {
    recipients: Recipient[];
  }).recipients;
}

function loadLog(): ReplyEntry[] {
  return fs.existsSync(LOG_PATH) ? (JSON.parse(fs.readFileSync(LOG_PATH, "utf8")) as ReplyEntry[]) : [];
}

function saveLog(log: ReplyEntry[]): void {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

/** address -> slug (exact first), then domain -> slug. */
function buildMatchers(recipients: Recipient[]): { byAddress: Map<string, string>; byDomain: Map<string, string> } {
  const byAddress = new Map<string, string>();
  const byDomain = new Map<string, string>();
  for (const r of recipients) {
    for (const addr of [r.to, ...r.cc]) {
      const a = addr.toLowerCase();
      if (!byAddress.has(a)) byAddress.set(a, r.slug);
      const domain = a.split("@")[1];
      if (domain && !byDomain.has(domain)) byDomain.set(domain, r.slug);
    }
  }
  return { byAddress, byDomain };
}

function classify(parsed: ParsedMail, dataFiles: string[]): ReplyEntry["classification"] {
  if (dataFiles.length > 0) return "data";
  const text = (parsed.text ?? "").toLowerCase();
  if (/\$\s?\d|fee|invoice|cost estimate|payment|deposit required/.test(text)) return "fee";
  if (/\?\s*$|could you clarify|please specify|which format|more information|narrow the scope/m.test(text)) return "question";
  return "ack";
}

function isBounce(fromAddr: string, parsed: ParsedMail): boolean {
  return /^(mailer-daemon|postmaster)@/.test(fromAddr) || /mail delivery (system|failed)/i.test(parsed.from?.text ?? "");
}

/** Map a bounce/portal message to a jurisdiction by scanning text for known addresses or city names. */
function slugFromText(text: string, recipients: Recipient[], byAddress: Map<string, string>): string | null {
  const lower = text.toLowerCase();
  for (const [addr, slug] of byAddress) if (lower.includes(addr)) return slug;
  for (const r of recipients) {
    const city = r.name.replace(/^(City|Town) of /i, "").replace(/ \(.*\)$/, "").toLowerCase();
    if (city.length > 3 && lower.includes(city)) return r.slug;
  }
  return null;
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(0, 120);
}

async function main() {
  const rescanAll = process.argv.includes("--all");
  const recipients = loadRecipients();
  const { byAddress, byDomain } = buildMatchers(recipients);
  const log = loadLog();
  const seen = new Set(log.map((e) => e.uid));

  const client = new ImapFlow({
    host: requireEnv("SMTP_HOST"),
    port: 993,
    secure: true,
    auth: { user: requireEnv("SMTP_USER"), pass: requireEnv("SMTP_PASS") },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const fresh: ReplyEntry[] = [];
  try {
    const uids = await client.search({ since: CAMPAIGN_START }, { uid: true });
    const todo = (uids || []).filter((uid) => rescanAll || !seen.has(uid));
    for (const uid of todo) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      const fromAddr = (parsed.from?.value?.[0]?.address ?? "").toLowerCase();
      const fromDomain = fromAddr.split("@")[1] ?? "";
      const text = parsed.text ?? "";

      let slug = byAddress.get(fromAddr) ?? byDomain.get(fromDomain) ?? null;
      let classification: ReplyEntry["classification"] | null = null;
      if (!slug && isBounce(fromAddr, parsed)) {
        slug = slugFromText(text, recipients, byAddress) ?? "unknown";
        classification = "bounce";
      }
      if (!slug && PORTAL_DOMAINS.some((d) => fromDomain.endsWith(d))) {
        slug = slugFromText(`${parsed.subject ?? ""}\n${text}`, recipients, byAddress) ?? "unmatched-portal";
        classification = "portal";
      }
      if (!slug) continue; // unrelated mail

      const dataFiles: string[] = [];
      for (const att of parsed.attachments as Attachment[]) {
        const fname = att.filename ?? "attachment";
        if (!DATA_EXT.test(fname) && !PDF_EXT.test(fname)) continue;
        const dir = path.join("data", "inbox", slug);
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${safeName(fname)}`);
        fs.writeFileSync(dest, att.content);
        if (classification !== "bounce" && (DATA_EXT.test(fname) || (PDF_EXT.test(fname) && att.size > 100_000))) {
          dataFiles.push(dest); // large PDFs are data deliveries; tiny ones are letterhead
        }
      }

      const entry: ReplyEntry = {
        uid,
        slug,
        from: fromAddr,
        subject: parsed.subject ?? "(no subject)",
        classification: classification ?? classify(parsed, dataFiles),
        attachments: dataFiles,
        date: (parsed.date ?? new Date()).toISOString(),
      };
      if (!seen.has(uid)) {
        log.push(entry);
        seen.add(uid);
      }
      fresh.push(entry);
    }
  } finally {
    lock.release();
    await client.logout();
  }
  saveLog(log);

  if (fresh.length === 0) {
    console.log("No new replies from request jurisdictions.");
  } else {
    const groups: Record<ReplyEntry["classification"], ReplyEntry[]> = { data: [], fee: [], question: [], ack: [], bounce: [], portal: [] };
    for (const e of fresh) groups[e.classification].push(e);
    if (groups.bounce.length) {
      console.log("BOUNCES — request did NOT reach these; use their portal or a corrected address:");
      for (const e of groups.bounce) console.log(`  ${e.slug}: ${e.subject}`);
    }
    if (groups.data.length) {
      console.log("DATA RECEIVED — ready to ingest (PDFs need table extraction first):");
      for (const e of groups.data) console.log(`  ${e.slug}: ${e.attachments.join(", ")}`);
    }
    if (groups.fee.length) {
      console.log("FEE QUOTES — need your approval:");
      for (const e of groups.fee) console.log(`  ${e.slug} (${e.from}): ${e.subject}`);
    }
    if (groups.question.length) {
      console.log("QUESTIONS — need a reply:");
      for (const e of groups.question) console.log(`  ${e.slug} (${e.from}): ${e.subject}`);
    }
    if (groups.portal.length) {
      console.log("Portal confirmations:");
      for (const e of groups.portal) console.log(`  ${e.slug}: ${e.subject}`);
    }
    if (groups.ack.length) {
      console.log("Acknowledgments:");
      for (const e of groups.ack) console.log(`  ${e.slug}: ${e.subject}`);
    }
  }
  const replied = new Set(log.map((e) => e.slug));
  const silent = recipients.filter((r) => !replied.has(r.slug)).map((r) => r.slug);
  console.log(`\n${replied.size}/${recipients.length} jurisdictions have replied; silent: ${silent.length ? silent.join(", ") : "none"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
