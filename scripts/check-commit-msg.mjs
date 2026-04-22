#!/usr/bin/env node
/**
 * Conventional Commits validator for lefthook commit-msg hook.
 *
 * Invoked as: node scripts/check-commit-msg.mjs <path-to-commit-msg-file>
 *
 * Extracted from the inline lefthook command in w103 to avoid YAML escaping
 * fragility (see docs/tech-debt-future-improvements-2026-04.md w103 notes).
 */

import { readFileSync } from "node:fs";

const PATTERN = /^(feat|fix|perf|refactor|chore|docs|style|test|ci|build)(\(.+\))?:\s.+/;

const path = process.argv[2];
if (!path) {
  console.error("ERROR: check-commit-msg.mjs requires a commit-message file path.");
  process.exit(2);
}

const msg = readFileSync(path, "utf8").trim();
if (!PATTERN.test(msg)) {
  console.error("ERROR: Commit message must follow Conventional Commits format");
  console.error("  Format: <type>(<optional scope>): <description>");
  console.error("  Types: feat, fix, perf, refactor, chore, docs, style, test, ci, build");
  process.exit(1);
}
