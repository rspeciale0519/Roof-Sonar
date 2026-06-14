#!/usr/bin/env node
// PreToolUse(Edit|Write) hook: block edits to .env files holding secrets
// (Supabase service-role key, SUPABASE_ACCESS_TOKEN, IMAP/SMTP creds).
// .env.example/.sample/.template are allowed (no secrets). Exit 2 blocks the call.
let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const fp = p?.tool_input?.file_path || p?.tool_input?.path || "";
  const base = fp.split(/[\\/]/).pop() || "";
  const isEnv = /^\.env(\.|$)/i.test(base);
  const isTemplate = /\.(example|sample|template)$/i.test(base);
  if (isEnv && !isTemplate) {
    console.error(
      `Blocked: ${fp} is an env file holding secrets (Supabase service-role key, SUPABASE_ACCESS_TOKEN, IMAP/SMTP creds). Edit it manually.`,
    );
    process.exit(2);
  }
  process.exit(0);
});
