#!/usr/bin/env node
/**
 * Design-system guard-rail: no hex literals in desktop component CSS.
 *
 * Closes 00-globals §G6: every color must come from a token in
 * packages/ui/src/styles/tokens.css. New hex literals in
 * apps/desktop/src/**\/*.{vue,css,scss} fail CI.
 *
 * Allow-list mechanisms:
 *   1. Files explicitly listed in ALLOW_FILES (canonical exceptions:
 *      mask compositing, brand seed color, computed comparison color).
 *   2. A line-scoped directive on the same line:
 *        // design-system: allow-hex (reason)
 *      or for CSS:
 *        /* design-system: allow-hex (reason) *\/
 *
 * Usage:
 *   node scripts/check-no-hex-colors.mjs            # all matching files
 *   node scripts/check-no-hex-colors.mjs --staged   # staged only (lefthook)
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const ROOT = `apps${sep}desktop${sep}src`;
const EXTS = new Set([".vue", ".css", ".scss"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "target", "__tests__", ".git"]);

// Files allowed to contain hex literals (canonical exceptions from §G6).
const ALLOW_FILES = new Set([
  "apps/desktop/src/styles/features.css", // #000 in mask radial-gradient compositing
  "apps/desktop/src/utils/orbitalGeometry.ts",
  "apps/desktop/src/composables/useSessionComparison.ts",
]);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const ALLOW_DIRECTIVE = /design-system:\s*allow-hex/;

function gitStaged() {
  const out = execSync("git diff --cached --name-only --diff-filter=ACMR", {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  return out.split(/\r?\n/).filter(Boolean);
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.has(name.slice(name.lastIndexOf(".")))) out.push(full);
  }
}

function collectFiles(staged) {
  if (staged) {
    return gitStaged()
      .filter((f) => f.startsWith("apps/desktop/src/"))
      .filter((f) => !f.includes("/__tests__/"))
      .filter((f) => EXTS.has(f.slice(f.lastIndexOf("."))))
      .map((f) => join(REPO_ROOT, f.replaceAll("/", sep)));
  }
  const out = [];
  walk(join(REPO_ROOT, ROOT), out);
  return out;
}

const staged = process.argv.includes("--staged");
const files = collectFiles(staged);
const violations = [];

for (const abs of files) {
  const rel = relative(REPO_ROOT, abs).replaceAll(sep, "/");
  if (ALLOW_FILES.has(rel)) continue;
  let text;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!HEX_RE.test(line)) continue;
    if (ALLOW_DIRECTIVE.test(line)) continue;
    const match = line.match(HEX_RE);
    violations.push({ file: rel, line: i + 1, hex: match[0], src: line.trim() });
  }
}

if (violations.length === 0) {
  console.log(`✓ no-hex-colors: ${files.length} file(s) checked, no violations`);
  process.exit(0);
}

console.error(`✗ no-hex-colors: ${violations.length} violation(s)`);
for (const v of violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.error(`  ${v.file}:${v.line}: ${v.hex}  // ${v.src.slice(0, 100)}`);
}
console.error("\nFix: replace with a token from packages/ui/src/styles/tokens.css,");
console.error(
  "or add `// design-system: allow-hex (reason)` to the offending line if intentional.",
);
process.exit(1);
