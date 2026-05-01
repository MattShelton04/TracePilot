#!/usr/bin/env node
/**
 * Doc-link lint for TracePilot.
 *
 * Walks every `docs/**\/*.md` and `**\/README.md` tracked by git, extracts
 * relative markdown links (inline `[text](target)` and reference-style
 * `[id]: target`), and verifies that every target resolves on disk.
 *
 * Skips:
 *   - `http(s)://` / `mailto:` / `#anchor-only` links
 *   - links under `node_modules/` / `target/`
 *
 * Usage:
 *   node scripts/check-doc-links.mjs                 # full repo
 *   node scripts/check-doc-links.mjs path/to/a.md    # only given files
 *
 * Exits 1 on any broken link.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// Files intentionally skipped by the checker. Keep short and commented.
//   - docs/multi-window-implementation-plan.md, docs/copilot-sdk-deep-dive.md:
//     reference an unchecked-in `reviews/` subdir (pre-existing; tracked
//     separately — remove once those review docs land or the refs are
//     excised). Added during FU-04 so the live-doc gate can still be useful.
const SKIP_PREFIXES = [];
const SKIP_FILES = new Set([
  "docs/multi-window-implementation-plan.md",
  "docs/copilot-sdk-deep-dive.md",
]);

function gitDocs() {
  const out = execSync("git ls-files", { encoding: "utf8", cwd: REPO_ROOT });
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => f.startsWith("docs/") || f.endsWith("/README.md") || f === "README.md")
    .filter((f) => !f.startsWith("node_modules/") && !f.startsWith("target/"))
    .filter((f) => !SKIP_PREFIXES.some((p) => f.startsWith(p)))
    .filter((f) => !SKIP_FILES.has(f));
}

const argFiles = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const files = (argFiles.length ? argFiles : gitDocs()).map((f) =>
  f.replaceAll("\\", "/").replace(/^\.\//, ""),
);

// [text](target) — allow nested parens in text, stop target at ` ` or `)` or end.
const INLINE_RE = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// Reference-style: `[id]: target "title"`. Excludes footnote defs (`[^...]:`).
const REF_RE = /^\s{0,3}\[([^^\]][^\]]*)\]:\s+(\S+)(?:\s+.*)?$/gm;

const broken = [];

for (const rel of files) {
  const abs = resolve(REPO_ROOT, rel.replaceAll("/", sep));
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  // Strip fenced code blocks (``` ... ```) so we don't lint sample links.
  const stripped = text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));

  const check = (target, source) => {
    const t = target.trim();
    if (!t) return;
    if (/^(https?:|mailto:|tel:|#|data:)/i.test(t)) return;
    // Strip anchor + query.
    const noHash = t.split("#")[0].split("?")[0];
    if (!noHash) return; // anchor-only link.
    const baseDir = dirname(abs);
    const targetAbs = resolve(baseDir, noHash.replaceAll("/", sep));
    if (!existsSync(targetAbs)) {
      broken.push({ file: rel, target: t, line: source });
      return;
    }
    // If target is a directory, require a README.md or index file? No — dir links are fine.
    try {
      statSync(targetAbs);
    } catch {
      broken.push({ file: rel, target: t, line: source });
    }
  };

  // Walk inline links with line numbers.
  const lines = stripped.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(INLINE_RE)) {
      const target = m[2];
      check(target, `${rel}:${i + 1}`);
    }
  }
  // Reference-style can span — regex over whole text, then locate line.
  for (const m of stripped.matchAll(REF_RE)) {
    const target = m[2];
    const offset = m.index ?? 0;
    const lineNo = stripped.slice(0, offset).split(/\r?\n/).length;
    check(target, `${rel}:${lineNo}`);
  }
}

if (broken.length === 0) {
  console.log(`✓ doc-link check passed (${files.length} file(s))`);
  process.exit(0);
}

console.error(`✗ doc-link check: ${broken.length} broken link(s):\n`);
for (const b of broken) {
  console.error(`  ${b.line}  →  ${b.target}`);
}
process.exit(1);
