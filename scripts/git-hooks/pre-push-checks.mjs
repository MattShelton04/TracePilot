#!/usr/bin/env node
/**
 * Pre-push checks scoped to what this branch changed since it forked from
 * origin/main (lefthook `pre-push`). CI still runs every check in full.
 *
 *   - file-size budgets on the changed files
 *   - rustfmt on the changed .rs files
 *   - typecheck of the changed workspace packages and their dependents
 *     (the whole workspace when root package/lock/workspace files changed)
 *
 * Without a merge base (no origin/main), it runs the full checks.
 *
 * Usage: node scripts/git-hooks/pre-push-checks.mjs [--base <ref>] [--dry-run]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listChangedFiles } from "../lib/list-tracked-files.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";
const dryRun = args.includes("--dry-run");
const WINDOWS = process.platform === "win32";
const ROOT_TYPECHECK_INPUTS = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]);
const TS_INPUT = /^(apps|packages)\/.+\.(ts|tsx|mts|cts|vue|js|mjs|json)$/;

function mergeBase() {
  try {
    return execFileSync("git", ["merge-base", "HEAD", base], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function plan() {
  const fork = mergeBase();
  const changed = fork ? listChangedFiles(REPO_ROOT, fork, { quiet: true }) : null;
  if (!changed) {
    console.log(`pre-push: no merge base with ${base}; running full checks`);
    return [
      ["file sizes", "node", ["scripts/check-file-sizes.mjs"]],
      ["rustfmt", "cargo", ["fmt", "--all", "--", "--check"]],
      ["typecheck", "pnpm", ["typecheck"]],
    ];
  }
  const steps = [["file sizes", "node", ["scripts/check-file-sizes.mjs", "--since", fork]]];
  const rust = changed.filter((f) => f.endsWith(".rs"));
  if (rust.length > 0) {
    steps.push(["rustfmt", "rustfmt", ["--check", "--edition", "2024", ...rust]]);
  }
  if (changed.some((f) => ROOT_TYPECHECK_INPUTS.has(f))) {
    steps.push(["typecheck", "pnpm", ["typecheck"]]);
  } else {
    // pnpm's own `--filter "...[<ref>]"` matched no packages in a worktree
    // under .claude/worktrees, so map changed files to packages here.
    const filters = changedPackages(changed).flatMap((name) => ["--filter", `...${name}`]);
    if (filters.length > 0) steps.push(["typecheck", "pnpm", ["-r", ...filters, "typecheck"]]);
  }
  return steps;
}

function changedPackages(files) {
  const names = new Set();
  for (const file of files) {
    if (!TS_INPUT.test(file)) continue;
    const dir = file.split("/").slice(0, 2).join("/");
    try {
      names.add(JSON.parse(readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8")).name);
    } catch {
      // Not a workspace package (no package.json); nothing to typecheck.
    }
  }
  return [...names].sort();
}

let failed = 0;
for (const [label, cmd, cmdArgs] of plan()) {
  const shown = `${cmd} ${cmdArgs.join(" ")}`;
  if (dryRun) {
    console.log(`would run ${label}: ${shown.length > 200 ? `${shown.slice(0, 200)}…` : shown}`);
    continue;
  }
  const started = Date.now();
  // pnpm is a .cmd shim on Windows, which needs a shell; the args are shell-safe.
  const result = spawnSync(cmd, cmdArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: WINDOWS && cmd === "pnpm",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  if (!ok) failed++;
  const why = result.error ? ` (${result.error.code ?? result.error.message})` : "";
  console.log(`${ok ? "PASS" : "FAIL"} ${label} (${seconds}s)${why}`);
}

if (failed > 0) {
  console.error("pre-push: fix the failures above, or push with --no-verify if urgent.");
  process.exit(1);
}
