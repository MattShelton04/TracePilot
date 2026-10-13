#!/usr/bin/env node
/**
 * File-size guard-rails for TracePilot.
 *
 * Enforces per-file-type line budgets to prevent "god module" regressions.
 * Existing violations are allow-listed in ALLOWLIST below so the list can
 * only shrink — new files exceeding budget fail CI.
 *
 * Budgets (lines, non-test / test where applicable):
 *   - Rust .rs         : 500 / 700
 *   - Vue SFC          : 400 (template+script) or 1000 total hard cap
 *   - TypeScript store : 300
 *   - Other TS/JS      : 500
 *
 * Usage:
 *   node scripts/check-file-sizes.mjs             # every tracked file (CI)
 *   node scripts/check-file-sizes.mjs --list      # print current violations
 *   node scripts/check-file-sizes.mjs --staged    # staged files only
 *   node scripts/check-file-sizes.mjs --since origin/main  # changed on this branch
 *   node scripts/check-file-sizes.mjs <paths...>  # just these files (hooks)
 *
 * The landing page (site/) is exempt; see the skip list below.
 * Existing exceptions and their review notes are listed in ALLOWLIST below.
 */

import { readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { listChangedFiles, listStagedFiles, listTrackedFiles } from "./lib/list-tracked-files.mjs";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// Per-file-type budgets (hard cap for CI-blocking).
const BUDGETS = {
  rs: 500,
  "rs.test": 700,
  vue: 1000,
  ts: 500,
  "ts.store": 300,
  tsx: 500,
  js: 500,
  mjs: 500,
};

// Existing violations at the point of enabling this guard. New violations
// are fatal; existing ones are accepted but must only shrink over time.
// Populate this list by running `node scripts/check-file-sizes.mjs --list`
// after the first CI run and committing the output, then removing entries
// as files are split.
const ALLOWLIST = new Set([]);

// Explicit paths (repo-relative or absolute), --staged or --since <ref> narrow
// the check to those files; otherwise every tracked file is checked.
function filesToCheck(args) {
  const sinceAt = args.indexOf("--since");
  if (sinceAt !== -1) {
    const changed = listChangedFiles(REPO_ROOT, args[sinceAt + 1]);
    return changed ?? listTrackedFiles(REPO_ROOT);
  }
  const paths = args.filter((a) => !a.startsWith("--"));
  if (paths.length > 0) {
    return paths.map((p) => {
      const rel = isAbsolute(p) ? relative(REPO_ROOT, p) : p;
      return rel.replaceAll(sep, "/").replace(/^\.\//, "");
    });
  }
  if (args.includes("--staged")) {
    const staged = listStagedFiles(REPO_ROOT);
    if (staged) return staged;
  }
  return listTrackedFiles(REPO_ROOT);
}

function countLines(absPath) {
  try {
    const text = readFileSync(absPath, "utf8");
    // Count lines the "cat" way: number of newlines + 1 if no trailing NL.
    let n = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
    if (text.length > 0 && text[text.length - 1] !== "\n") n++;
    return n;
  } catch {
    return 0;
  }
}

function budgetFor(relPath) {
  const norm = relPath.replaceAll(sep, "/");
  if (norm.endsWith(".vue")) return { key: "vue", lines: BUDGETS.vue };
  if (norm.endsWith(".rs")) {
    if (/\/tests?\//.test(norm) || /_test(s)?\.rs$/.test(norm) || norm.startsWith("tests/")) {
      return { key: "rs.test", lines: BUDGETS["rs.test"] };
    }
    return { key: "rs", lines: BUDGETS.rs };
  }
  if (norm.endsWith(".ts")) {
    if (/\/stores?\//.test(norm)) return { key: "ts.store", lines: BUDGETS["ts.store"] };
    return { key: "ts", lines: BUDGETS.ts };
  }
  const ext = extname(norm).slice(1);
  if (BUDGETS[ext] != null) return { key: ext, lines: BUDGETS[ext] };
  return null;
}

const wantList = process.argv.includes("--list");

const files = filesToCheck(process.argv.slice(2));
const violations = [];

for (const f of files) {
  if (f.includes("/node_modules/") || f.startsWith("node_modules/")) continue;
  if (f.startsWith("target/")) continue;
  if (f.startsWith("docs/")) continue;
  if (f.startsWith("assets/")) continue;
  // The landing page renders static HTML replicas of app views; its modules are
  // illustrative, not product code, so they are exempt from these budgets.
  if (f.startsWith("site/")) continue;

  const budget = budgetFor(f);
  if (!budget) continue;

  const abs = resolve(REPO_ROOT, f);
  const lines = countLines(abs);
  if (lines <= budget.lines) continue;

  const normalized = f.replaceAll(sep, "/");
  violations.push({ path: normalized, lines, budget: budget.lines, key: budget.key });
}

if (wantList) {
  for (const v of violations.sort((a, b) => b.lines - a.lines)) {
    console.log(`${v.path}\t${v.lines} > ${v.budget} (${v.key})`);
  }
  process.exit(0);
}

const nonAllowed = violations.filter((v) => !ALLOWLIST.has(v.path));

if (nonAllowed.length === 0) {
  console.log(
    `✓ file-size check passed (${files.length} file(s), ${violations.length} allow-listed violation(s))`,
  );
  process.exit(0);
}

console.error(
  `✗ file-size guard-rail: ${nonAllowed.length} file(s) exceed budget and are not allow-listed:\n`,
);
for (const v of nonAllowed.sort((a, b) => b.lines - a.lines)) {
  console.error(`  ${v.path}  ${v.lines} > ${v.budget}  (${v.key})`);
}
console.error("\nOptions:");
console.error("  1. Split the file (preferred).");
console.error(
  "  2. Add the path to ALLOWLIST in scripts/check-file-sizes.mjs with a TODO and owner.",
);
console.error("\nReview the existing ALLOWLIST notes before changing a budget or exception.");
process.exit(1);
