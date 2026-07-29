#!/usr/bin/env node
/**
 * Design-system guard-rail: no backdrop-filter on data or chrome.
 *
 * Closes 00-globals §G2: backdrop-filter is banned everywhere except
 * the modal scrim. Per the spec there is no inline opt-out; the only
 * way to add a new use is to update this script's ALLOW_FILES set
 * (which currently captures the pre-existing migration backlog and
 * the modal scrim).
 *
 * Usage:
 *   node scripts/check-no-backdrop-filter.mjs
 *   node scripts/check-no-backdrop-filter.mjs --staged
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const ROOT = `apps${sep}desktop${sep}src`;
const EXTS = new Set([".vue", ".css", ".scss"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "target", "__tests__", ".git"]);

// Pre-existing backdrop-filter sites at the time this guard-rail was added
// (00-globals §G2 migration backlog). The list is the ratchet — it must
// only shrink. New files using backdrop-filter will fail CI.
const ALLOW_FILES = new Set([
  "apps/desktop/src/styles/overlays.css",
  "apps/desktop/src/styles/features/sdk-steering.css",
  "apps/desktop/src/styles/features/session-launcher.css",
  "apps/desktop/src/styles/features/skill-import-wizard.css",
  "apps/desktop/src/styles/features/skills-manager.css",
  "apps/desktop/src/styles/features/worktree-manager.css",
  "apps/desktop/src/views/SessionListView.vue",
  "apps/desktop/src/views/tabs/ConversationTab.vue",
  "apps/desktop/src/components/WhatsNewModal.vue",
  "apps/desktop/src/components/UpdateInstructionsModal.vue",
  "apps/desktop/src/components/session/SessionDetailPanel.vue",
  "apps/desktop/src/components/SearchPalette.vue",
  "apps/desktop/src/components/mcp/addServer/add-server.css",
  "apps/desktop/src/components/layout/AlertCenterDrawer.vue",
]);

const RE = /(?:^|[^a-z-])(-webkit-)?backdrop-filter\s*:/i;

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
    if (RE.test(lines[i])) {
      violations.push({ file: rel, line: i + 1, src: lines[i].trim() });
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ no-backdrop-filter: ${files.length} file(s) checked, no violations`);
  process.exit(0);
}

console.error(`✗ no-backdrop-filter: ${violations.length} violation(s)`);
for (const v of violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.error(`  ${v.file}:${v.line}: ${v.src.slice(0, 100)}`);
}
console.error(
  "\nFix: use solid surfaces per 00-globals §G2 (canvas-overlay/raised + hairline + shadow).",
);
console.error("Backdrop blur is reserved for the modal scrim only.");
process.exit(1);
