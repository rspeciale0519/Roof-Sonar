/**
 * FL Ch. 119 records-request sender (PRD: records requests; recipients verified
 * in docs/records-requests/send-list.md).
 *
 *   npm run records -- --dry-run              # render all emails to docs/temp/records-preview/, send NOTHING
 *   npm run records -- --test you@example.com # send ONE sample email to an address you control
 *   npm run records -- --send                 # real send, throttled; resumable via the log
 *   npm run records -- --send --include-flagged   # also send the verify_first jurisdictions
 *   npm run records -- --status               # show the send log
 *
 * Spam/relay safety: authenticated SMTPS (465) to our own mailbox host; one
 * plain-text email per jurisdiction (no blasts, no HTML, no attachments);
 * 45-90s jitter between sends so a 30-recipient run stays far under any
 * provider rate limit; every send logged to data/records-send-log.json and
 * never repeated on re-run.
 */
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { requireEnv, optionalEnv } from "./lib/env";

interface Recipient {
  slug: string;
  name: string;
  county: string;
  to: string;
  cc: string[];
  system: string;
  scope_note?: string;
  verify_first?: string;
}

interface SendLogEntry {
  slug: string;
  to: string;
  cc: string[];
  message_id: string;
  sent_at: string;
}

const LOG_PATH = path.join("data", "records-send-log.json");
const PREVIEW_DIR = path.join("docs", "temp", "records-preview");
const SUBJECT = "Public Records Request — Roofing Permit Data";

function loadRecipients(): Recipient[] {
  const raw = JSON.parse(fs.readFileSync(path.join("scripts", "records", "recipients.json"), "utf8")) as {
    recipients: Recipient[];
  };
  return raw.recipients;
}

function loadLog(): SendLogEntry[] {
  if (!fs.existsSync(LOG_PATH)) return [];
  return JSON.parse(fs.readFileSync(LOG_PATH, "utf8")) as SendLogEntry[];
}

function appendLog(entry: SendLogEntry): void {
  const log = loadLog();
  log.push(entry);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function signature(): { name: string; company: string; phone: string; email: string; complete: boolean } {
  const name = optionalEnv("SENDER_NAME") ?? "[[SENDER_NAME]]";
  const company = optionalEnv("SENDER_COMPANY") ?? "[[SENDER_COMPANY]]";
  const phone = optionalEnv("SENDER_PHONE") ?? "[[SENDER_PHONE]]";
  const email = optionalEnv("SMTP_USER") ?? "[[SMTP_USER]]";
  return { name, company, phone, email, complete: !name.startsWith("[[") && !company.startsWith("[[") && !phone.startsWith("[[") };
}

function renderBody(r: Recipient): string {
  const sig = signature();
  const scope = r.scope_note ? ` for ${r.scope_note}` : "";
  return `To the Records Custodian, ${r.name}:

Per Florida Statutes Chapter 119, I request the following in electronic format (CSV or Excel preferred):

1. All issued roofing/re-roof permits${scope} from January 1, 2000 to present, including: permit number, parcel ID, site address, permit type/work description, application date, issue date, final date, and status.

2. The same report monthly going forward (the prior month's issued roofing permits) as a standing request, if your office can accommodate it.

Please advise of any fees before fulfilling. If any portion of this request is unclear or would be easier to fulfill in a different format, I'm happy to adjust — a raw export from your permitting system (${r.system}) works fine.

Thank you.

${sig.name}
${sig.company}
${sig.phone} · ${sig.email}
`;
}

function transporter() {
  return nodemailer.createTransport({
    host: requireEnv("SMTP_HOST"),
    port: Number(optionalEnv("SMTP_PORT") ?? 465),
    secure: true,
    auth: { user: requireEnv("SMTP_USER"), pass: requireEnv("SMTP_PASS") },
  });
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const jitterMs = () => 45_000 + Math.floor(Math.random() * 45_000);

async function main() {
  const args = process.argv.slice(2);
  const recipients = loadRecipients();
  const log = loadLog();
  const sentSlugs = new Set(log.map((e) => e.slug));
  const includeFlagged = args.includes("--include-flagged");

  if (args.includes("--status")) {
    console.log(`${log.length} sent so far:`);
    for (const e of log) console.log(`  ${e.sent_at}  ${e.slug.padEnd(22)} -> ${e.to}`);
    const pending = recipients.filter((r) => !sentSlugs.has(r.slug));
    console.log(`${pending.length} pending: ${pending.map((r) => r.slug + (r.verify_first ? "(flagged)" : "")).join(", ")}`);
    return;
  }

  if (args.includes("--dry-run")) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
    for (const r of recipients) {
      const flag = r.verify_first ? `\n[VERIFY FIRST: ${r.verify_first}]\n` : "";
      const content = `To: ${r.to}\nCc: ${r.cc.join(", ") || "(none)"}\nSubject: ${SUBJECT}\n${flag}\n${renderBody(r)}`;
      fs.writeFileSync(path.join(PREVIEW_DIR, `${r.slug}.txt`), content);
    }
    const sig = signature();
    console.log(`${recipients.length} previews written to ${PREVIEW_DIR}/`);
    if (!sig.complete) {
      console.log("SIGNATURE INCOMPLETE: set SENDER_NAME, SENDER_COMPANY, SENDER_PHONE in .env.local — sending is blocked until then.");
    }
    return;
  }

  const testIdx = args.indexOf("--test");
  if (testIdx >= 0) {
    const addr = args[testIdx + 1];
    if (!addr || !addr.includes("@")) {
      console.error("Usage: npm run records -- --test someone@example.com");
      process.exit(1);
    }
    const sample = recipients[0];
    const info = await transporter().sendMail({
      from: { name: signature().name, address: requireEnv("SMTP_USER") },
      to: addr,
      subject: `[TEST] ${SUBJECT}`,
      text: renderBody(sample),
    });
    console.log(`Test sent to ${addr}: ${info.messageId}`);
    return;
  }

  if (args.includes("--send")) {
    const sig = signature();
    if (!sig.complete) {
      console.error("Refusing to send: SENDER_NAME / SENDER_COMPANY / SENDER_PHONE missing from .env.local.");
      process.exit(1);
    }
    const queue = recipients.filter((r) => !sentSlugs.has(r.slug)).filter((r) => includeFlagged || !r.verify_first);
    const skippedFlagged = recipients.filter((r) => !sentSlugs.has(r.slug) && r.verify_first && !includeFlagged);
    console.log(`Sending ${queue.length} requests (${sentSlugs.size} already sent, ${skippedFlagged.length} flagged held back).`);
    const t = transporter();
    for (const [i, r] of queue.entries()) {
      const info = await t.sendMail({
        from: { name: sig.name, address: requireEnv("SMTP_USER") },
        to: r.to,
        cc: r.cc.length ? r.cc : undefined,
        replyTo: requireEnv("SMTP_USER"),
        subject: SUBJECT,
        text: renderBody(r),
      });
      appendLog({ slug: r.slug, to: r.to, cc: r.cc, message_id: info.messageId, sent_at: new Date().toISOString() });
      console.log(`  [${i + 1}/${queue.length}] ${r.slug} -> ${r.to} (${info.messageId})`);
      if (i < queue.length - 1) {
        const wait = jitterMs();
        console.log(`    waiting ${Math.round(wait / 1000)}s…`);
        await sleep(wait);
      }
    }
    console.log(`Done. ${queue.length} sent this run; log at ${LOG_PATH}.`);
    if (skippedFlagged.length) {
      console.log(`Held back (verify first): ${skippedFlagged.map((r) => r.slug).join(", ")} — re-run with --include-flagged after confirming.`);
    }
    return;
  }

  console.error("Pick a mode: --dry-run | --test <addr> | --send [--include-flagged] | --status");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
