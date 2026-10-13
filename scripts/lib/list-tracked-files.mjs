/**
 * Repository file enumeration for the `scripts/check-*.mjs` guards.
 *
 * Git is the source of truth, but restricted sandboxes (Codex) can block child
 * processes with `spawn EPERM`. When Git can't run, fall back to a filesystem
 * walk that skips dependency, build, agent and session-data directories, so
 * the checks stay useful instead of crashing.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Directory names never descended into by the filesystem fallback. */
export const IGNORED_DIRS = new Set([
  ".agent",
  ".claude",
  ".git",
  ".jules",
  ".playwright-cli",
  ".pnpm-store",
  ".tracepilot",
  "blob-report",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "target",
  "test-results",
]);

function git(root, args, gitBin) {
  return execFileSync(gitBin, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\0")
    .filter(Boolean);
}

function note(message, quiet) {
  if (!quiet) console.error(`note: ${message}`);
}

/** Every file under `root` (repo-relative, `/`-separated), skipping IGNORED_DIRS. */
export function walkRepoFiles(root, { ignoredDirs = IGNORED_DIRS } = {}) {
  const found = [];
  const visit = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) visit(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        found.push(rel);
      }
    }
  };
  visit(root, "");
  return found.sort();
}

/**
 * Tracked files (`git ls-files`), or a filesystem walk when Git can't run.
 * Paths are repo-relative with `/` separators.
 */
export function listTrackedFiles(root, { gitBin = "git", quiet = false } = {}) {
  try {
    return git(root, ["ls-files", "-z"], gitBin);
  } catch (err) {
    note(`git ls-files unavailable (${err.code ?? err.message}); scanning the filesystem`, quiet);
    return walkRepoFiles(root);
  }
}

/**
 * Staged added/copied/modified/renamed files, or `null` when Git can't run
 * (callers then check the full tree instead).
 */
export function listStagedFiles(root, { gitBin = "git", quiet = false } = {}) {
  try {
    return git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], gitBin);
  } catch (err) {
    note(`git diff --cached unavailable (${err.code ?? err.message}); checking all files`, quiet);
    return null;
  }
}

/**
 * Files added/copied/modified/renamed on HEAD since it forked from `base`
 * (`git diff base...HEAD`), or `null` when Git can't run or `base` is unknown.
 */
export function listChangedFiles(root, base, { gitBin = "git", quiet = false } = {}) {
  try {
    return git(
      root,
      ["diff", "--name-only", "--diff-filter=ACMR", "-z", `${base}...HEAD`, "--"],
      gitBin,
    );
  } catch (err) {
    note(
      `git diff ${base}...HEAD unavailable (${err.code ?? err.message}); checking all files`,
      quiet,
    );
    return null;
  }
}
