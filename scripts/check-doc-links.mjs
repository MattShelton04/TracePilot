#!/usr/bin/env node
/**
 * Doc-link lint for TracePilot.
 *
 * Walks repository Markdown (including newly created files), extracts
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

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

// Used only when this environment disallows child processes. Normal runs use
// Git's ignore rules to include new docs without scanning ignored local data.
const GENERATED_DIRS = new Set([
  ".git",
  ".agent",
  ".jules",
  ".playwright-cli",
  ".pnpm-store",
  ".tracepilot",
  ".vscode",
  ".idea",
  ".cache",
  "node_modules",
  "target",
  "dist",
  "test-results",
  "blob-report",
  "playwright-report",
]);
const IGNORED_SOURCE_DIRS = new Set([
  "scripts/e2e/screenshots",
]);

function sourceTreeDocsFallback() {
  const found = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const child = join(dir, entry.name);
        const rel = relative(REPO_ROOT, child).replaceAll("\\", "/");
        if (!GENERATED_DIRS.has(entry.name) && !IGNORED_SOURCE_DIRS.has(rel)) visit(child);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = relative(REPO_ROOT, join(dir, entry.name)).replaceAll("\\", "/");
        if (!rel.startsWith("docs/perf/results/") || entry.name === "README.md") {
          found.push(rel);
        }
      }
    }
  };
  visit(REPO_ROOT);
  return found.sort();
}

function repoDocs() {
  try {
    return execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean)
      .filter((file) => existsSync(resolve(REPO_ROOT, file)))
      .sort();
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    // Restricted sandboxes may block Git subprocesses. Keep the doc check
    // useful there while excluding known dependency, build, and session dirs.
    return sourceTreeDocsFallback();
  }
}

const argFiles = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const files = (argFiles.length ? argFiles : repoDocs()).map((f) =>
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
