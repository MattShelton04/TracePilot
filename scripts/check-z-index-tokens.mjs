#!/usr/bin/env node
/**
 * Design-system guard-rail: z-index from tokens only.
 *
 * Closes 00-globals §G10: z-index must use one of the --z-* tokens
 * (--z-sidebar, --z-header, --z-fab, --z-overlay, --z-modal, --z-tooltip)
 * defined in packages/ui/src/styles/tokens.css. The literal values
 * 0, auto, -1, and 1 are permitted because they only create a stacking
 * context and don't contend with token-managed layers.
 *
 * Usage:
 *   node scripts/check-z-index-tokens.mjs
 *   node scripts/check-z-index-tokens.mjs --staged
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const ROOT = `apps${sep}desktop${sep}src`;
const EXTS = new Set([".vue", ".css"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "target", "__tests__", ".git"]);

const ALLOWED_LITERALS = new Set(["0", "auto", "-1", "1"]);

// Pre-existing numeric z-index values at the time this guard-rail was added
// (00-globals §G10 migration backlog). Ratchet only — list must shrink.
const ALLOW_FILES = new Set([
  "apps/desktop/src/styles/chart-shared.css",
  "apps/desktop/src/components/conversation/ChatViewMode.vue",
  "apps/desktop/src/styles/layout.css",
  "apps/desktop/src/styles/features/export.css",
  "apps/desktop/src/styles/features/waterfall.css",
  "apps/desktop/src/styles/features/skill-editor.css",
  "apps/desktop/src/styles/features/todo-dependency-graph.css",
  "apps/desktop/src/styles/features/session-search.css",
  "apps/desktop/src/styles/features/session-launcher.css",
  "apps/desktop/src/styles/features/model-comparison.css",
  "apps/desktop/src/components/indexing/IndexingOrbitalScene.vue",
  "apps/desktop/src/components/IndexingLoadingScreen.vue",
  "apps/desktop/src/styles/features/skill-import-wizard.css",
  "apps/desktop/src/components/layout/SessionTabContextMenu.vue",
  "apps/desktop/src/components/layout/SessionTab.vue",
  "apps/desktop/src/components/conversation/SubagentPanel.vue",
  "apps/desktop/src/views/tabs/ConversationTab.vue",
  "apps/desktop/src/components/SearchPalette.vue",
  "apps/desktop/src/components/SetupWizard.vue",
  "apps/desktop/src/components/session/SessionDetailPanel.vue",
  "apps/desktop/src/styles/features/skills-manager.css",
  "apps/desktop/src/views/SessionListView.vue",
  "apps/desktop/src/components/WhatsNewModal.vue",
  "apps/desktop/src/components/search/SearchSyntaxHelpModal.vue",
  "apps/desktop/src/components/UpdateBanner.vue",
  "apps/desktop/src/components/UpdateInstructionsModal.vue",
]);

const RE = /(^|[^a-z-])z-index\s*:\s*([^;]+);/gi;

function gitStaged() {
  const out = execSync(
    "git diff --cached --name-only --diff-filter=ACMR",
    { encoding: "utf8", cwd: REPO_ROOT },
  );
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

function lineNumber(text, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
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
  const re = new RegExp(RE.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = m[2].trim();
    if (value.startsWith("var(")) continue;
    if (ALLOWED_LITERALS.has(value)) continue;
    violations.push({
      file: rel,
      line: lineNumber(text, m.index),
      value,
    });
  }
}

if (violations.length === 0) {
  console.log(`✓ z-index-tokens: ${files.length} file(s) checked, no violations`);
  process.exit(0);
}

console.error(`✗ z-index-tokens: ${violations.length} violation(s)`);
for (const v of violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.error(`  ${v.file}:${v.line}: z-index: ${v.value};`);
}
console.error(
  "\nFix: use a token from MASTER §7 (--z-sidebar | --z-header | --z-fab |",
);
console.error(
  "--z-overlay | --z-modal | --z-tooltip). Literal 0/auto/-1/1 are allowed",
);
console.error(
  "for stacking-context creation only.",
);
process.exit(1);
