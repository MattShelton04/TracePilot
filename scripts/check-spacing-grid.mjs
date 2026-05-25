#!/usr/bin/env node
/**
 * Design-system guard-rail: 4px spacing grid (warn-only in v1).
 *
 * Closes 00-globals §G8: padding/margin/gap/inset values must come
 * from the 4px grid {4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80}.
 * v1 reports off-grid values but always exits 0 — the codebase has
 * many off-grid sites and we want a triage list, not a blocker.
 *
 * Usage:
 *   node scripts/check-spacing-grid.mjs
 *   node scripts/check-spacing-grid.mjs --staged
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const ROOT = `apps${sep}desktop${sep}src`;
const EXT = ".css";
const SKIP_DIRS = new Set(["node_modules", "dist", "target", "__tests__", ".git"]);

const GRID = new Set([0, 1, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80]);

const PROP_RE =
  /(^|[^a-z-])(padding(?:-top|-right|-bottom|-left|-inline|-block|-inline-start|-inline-end|-block-start|-block-end)?|margin(?:-top|-right|-bottom|-left|-inline|-block|-inline-start|-inline-end|-block-start|-block-end)?|gap|column-gap|row-gap|top|bottom|left|right|inset(?:-block|-inline)?)\s*:\s*([^;{}]+);/gi;
const PX_RE = /(-?\d*\.?\d+)px/g;

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
    else if (name.endsWith(EXT)) out.push(full);
  }
}

function collectFiles(staged) {
  if (staged) {
    return gitStaged()
      .filter((f) => f.startsWith("apps/desktop/src/") && f.endsWith(EXT))
      .map((f) => join(REPO_ROOT, f.replaceAll("/", sep)));
  }
  const out = [];
  walk(join(REPO_ROOT, ROOT), out);
  return out;
}

function lineNumber(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const staged = process.argv.includes("--staged");
const files = collectFiles(staged);
const offGrid = [];

for (const abs of files) {
  const rel = relative(REPO_ROOT, abs).replaceAll(sep, "/");
  let text;
  try {
    text = await readFile(abs, "utf8");
  } catch {
    continue;
  }
  const re = new RegExp(PROP_RE.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    const prop = m[2];
    const value = m[3];
    const line = lineNumber(text, m.index);
    let pm;
    PX_RE.lastIndex = 0;
    while ((pm = PX_RE.exec(value)) !== null) {
      const n = Number.parseFloat(pm[1]);
      if (!Number.isFinite(n)) continue;
      if (!GRID.has(Math.abs(n))) {
        offGrid.push({ file: rel, line, prop, value: `${pm[1]}px` });
      }
    }
  }
}

offGrid.sort(
  (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.prop.localeCompare(b.prop),
);

if (offGrid.length === 0) {
  console.log(`✓ spacing-grid: ${files.length} file(s) checked, no off-grid values`);
  process.exit(0);
}

console.warn(`⚠ spacing-grid: ${offGrid.length} off-grid value(s) (warn-only in v1)`);
for (const v of offGrid) {
  console.warn(`  ${v.file}:${v.line}: ${v.prop}: ${v.value}`);
}
console.warn("\nGrid: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80 (00-globals §G8).");
process.exit(0);
