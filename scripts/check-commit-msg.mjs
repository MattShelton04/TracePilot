#!/usr/bin/env node
/**
 * Conventional Commits validator for lefthook commit-msg hook.
 *
 * Invoked as: node scripts/check-commit-msg.mjs <path-to-commit-msg-file>
 *
 * Extracted from the inline lefthook command to avoid YAML escaping
 * fragility. Git's own default merge (`Merge branch 'x'`, `Merge pull
 * request #1 …`) and revert (`Revert "feat: x"`) messages are accepted too.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "chore",
  "docs",
  "style",
  "test",
  "ci",
  "build",
];
const PATTERN = new RegExp(`^(${TYPES.join("|")})(\\(.+\\))?:\\s.+`);
const GIT_DEFAULT = /^Merge \S|^Revert ".+"/;

/** Whether a commit message is accepted; only its first line has to match. */
export function isValidCommitMessage(message) {
  const msg = message.trim();
  return PATTERN.test(msg) || GIT_DEFAULT.test(msg);
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("ERROR: check-commit-msg.mjs requires a commit-message file path.");
    process.exit(2);
  }
  if (!isValidCommitMessage(readFileSync(path, "utf8"))) {
    console.error("ERROR: Commit message must follow Conventional Commits format");
    console.error("  Format: <type>(<optional scope>): <description>");
    console.error(`  Types: ${TYPES.join(", ")}`);
    console.error('  Git\'s default "Merge …" and "Revert \\"…\\"" messages are also accepted.');
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
