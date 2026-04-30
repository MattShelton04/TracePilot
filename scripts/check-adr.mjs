#!/usr/bin/env node
/**
 * ADR template + index linter for TracePilot.
 *
 * For each `docs/adr/NNNN-*.md`:
 *   - Must have a `Date:` line (any reasonable YYYY-MM-DD).
 *   - Must have a `Status:` line.
 *   - Must contain the canonical sections used by the template
 *     (see `docs/adr/README.md` §Template):
 *       ## Context
 *       ## Decision
 *       ## Consequences
 *       ## Alternatives considered
 *   - Must appear in `docs/adr/README.md`'s index table.
 *
 * Reserved / intentional numbering gaps are permitted — we iterate over
 * files that exist rather than a contiguous range.
 *
 * Usage:
 *   node scripts/check-adr.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const ADR_DIR = join(REPO_ROOT, "docs", "adr");

const REQUIRED_HEADINGS = [
  "## Context",
  "## Decision",
  "## Consequences",
  "## Alternatives considered",
];

// ADRs predating w115's template lint. These are tracked by FU-18 for
// backfill into template conformance; until then we skip the `Alternatives
// considered` + date-format checks for them but still enforce headings that
// are known to be present. Remove entries as FU-18 lands.
const PENDING_BACKFILL = new Set([
  "0010-supported-platforms.md",
  "0011-tauri-capability-scoping.md",
  "0012-filesystem-trust-boundary.md",
  "0013-db-migration-policy.md",
]);

function listAdrFiles() {
  return readdirSync(ADR_DIR)
    .filter((f) => /^\d{4}-.+\.md$/.test(f))
    .sort();
}

const errors = [];

const adrFiles = listAdrFiles();
let indexText = "";
try {
  indexText = readFileSync(join(ADR_DIR, "README.md"), "utf8");
} catch {
  errors.push({ file: "docs/adr/README.md", msg: "missing" });
}

for (const f of adrFiles) {
  const rel = `docs/adr/${f}`;
  const text = readFileSync(join(ADR_DIR, f), "utf8");
  const pending = PENDING_BACKFILL.has(f);

  // Accept plain `Date: ...`, bold `**Date:** ...`, or bullet `- **Date:** ...`.
  // Allow YYYY-MM or YYYY-MM-DD (w115 template wants full date, but some
  // pre-template ADRs use YYYY-MM — FU-18 will normalise).
  const dateRe = /^(?:[-*]\s+)?(?:\*\*)?Date:(?:\*\*)?\s*\d{4}-\d{2}(?:-\d{2})?\s*$/m;
  const statusRe = /^(?:[-*]\s+)?(?:\*\*)?Status:(?:\*\*)?\s*\S+/m;
  if (!dateRe.test(text)) {
    errors.push({ file: rel, msg: "missing or malformed `Date:` line" });
  }
  if (!statusRe.test(text)) {
    errors.push({ file: rel, msg: "missing `Status:` line" });
  }
  for (const h of REQUIRED_HEADINGS) {
    if (pending && h === "## Alternatives considered") continue;
    const re = new RegExp(`^${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
    if (!re.test(text)) {
      errors.push({ file: rel, msg: `missing required heading \`${h}\`` });
    }
  }
  // Index membership: the filename (basename) must appear somewhere in
  // `docs/adr/README.md` (either as a link target or plain reference).
  if (indexText && !indexText.includes(f)) {
    errors.push({
      file: rel,
      msg: `not listed in docs/adr/README.md index (filename \`${f}\` not found)`,
    });
  }
}

// Reverse check: every ADR filename referenced in the index must exist on disk.
if (indexText) {
  const refRe = /\(([0-9]{4}-[A-Za-z0-9-]+\.md)\)/g;
  const onDisk = new Set(adrFiles);
  for (const m of indexText.matchAll(refRe)) {
    if (!onDisk.has(m[1])) {
      errors.push({
        file: "docs/adr/README.md",
        msg: `references \`${m[1]}\` but no such ADR file exists`,
      });
    }
  }
}

if (errors.length === 0) {
  console.log(`✓ adr check passed (${adrFiles.length} ADR(s))`);
  process.exit(0);
}

console.error(`✗ adr check: ${errors.length} issue(s):\n`);
for (const e of errors) {
  console.error(`  ${e.file}: ${e.msg}`);
}
process.exit(1);
