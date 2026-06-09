/**
 * Batch-generate FL Ch. 119 records-request email drafts (PRD: P0) — one per
 * jurisdiction — from the PRD template + docs/records-requests/contacts.csv.
 *
 *   npx tsx scripts/generate-records-requests.ts
 *
 * Output: docs/records-requests/drafts/<slug>.md. Review each, fill in the
 * recipient (verify on the jurisdiction website — column may be TBD), and send.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

const DIR = path.join("docs", "records-requests");
const OUT = path.join(DIR, "drafts");

const SIGNATURE = `[YOUR NAME]
[COMPANY]
[PHONE] · [EMAIL]`;

function body(name: string): string {
  return `Per Florida Statutes Chapter 119, I request the following in electronic format (CSV or Excel preferred):

1. All issued roofing/re-roof permits from January 1, 2000 to present, including: permit number, parcel ID, site address, permit type/work description, application date, issue date, final date, and status.
2. The same report monthly going forward (the prior month's issued roofing permits) as a standing request, if your office can accommodate it.

Please advise of any fees before fulfilling. If any portion of this request is unclear or would be easier to fulfill in a different format, I'm happy to adjust — a raw export from your permitting system (${name} permit records) works fine.

Thank you.

${SIGNATURE}`;
}

interface Contact {
  slug: string;
  name: string;
  county: string;
  department: string;
  email: string;
  website: string;
}

const contacts = parse(fs.readFileSync(path.join(DIR, "contacts.csv")), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
}) as Contact[];

fs.mkdirSync(OUT, { recursive: true });
for (const c of contacts) {
  const md = `# Records request — ${c.name}

| | |
|---|---|
| **To** | ${c.email || `TBD — find the ${c.department} / records contact at ${c.website}`} |
| **Department** | ${c.department} |
| **County** | ${c.county} |
| **Subject** | Public Records Request — Roofing Permit Data |

---

${body(c.name)}
`;
  fs.writeFileSync(path.join(OUT, `${c.slug}.md`), md);
}
console.log(`${contacts.length} drafts written to ${OUT}/`);
