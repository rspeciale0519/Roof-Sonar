#!/usr/bin/env node
// PostToolUse(Edit|Write) hook: warn when an edited non-markdown source file
// exceeds RoofRadar's 450-LOC limit (CLAUDE.md, non-negotiable). Docs are exempt.
// Reads the hook payload as JSON on stdin; exit 2 surfaces stderr back to Claude.
import fs from "fs";

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
  if (!fp || /\.(md|markdown)$/i.test(fp)) process.exit(0); // docs exempt
  let txt;
  try {
    txt = fs.readFileSync(fp, "utf8");
  } catch {
    process.exit(0);
  }
  const loc = txt.split("\n").length;
  const LIMIT = 450;
  if (loc > LIMIT) {
    console.error(
      `⚠ ${fp} is ${loc} lines — exceeds the ${LIMIT}-LOC limit (CLAUDE.md, non-negotiable). Split it into focused modules.`,
    );
    process.exit(2);
  }
  process.exit(0);
});
