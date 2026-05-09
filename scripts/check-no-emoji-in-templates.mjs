#!/usr/bin/env node
/**
 * Design-system guard-rail: no emoji in Vue templates.
 *
 * Closes 00-globals §G1: Lucide is the sole icon set; no emoji in
 * application chrome. Scans only the <template> block of each
 * apps/desktop/src/**\/*.vue file (script and style blocks are
 * ignored — emoji in TS strings are out of scope for this script).
 *
 * Allow-list mechanism:
 *   - Per-file opt-out via the comment `<!-- design-system: allow-emoji -->`
 *     placed inside the <template> block. Used for UserContentEmoji
 *     wrappers and other surfaces that render user-supplied emoji.
 *   - Files in ALLOW_FILES (baseline migration backlog).
 *
 * Usage:
 *   node scripts/check-no-emoji-in-templates.mjs
 *   node scripts/check-no-emoji-in-templates.mjs --staged
 */

import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const ROOT = `apps${sep}desktop${sep}src`;
const SKIP_DIRS = new Set(["node_modules", "dist", "target", "__tests__", ".git"]);

// Pre-existing emoji in templates (00-globals §G1 migration backlog).
// Add no new entries; remove as files are migrated to Lucide icons.
//
// Remaining entries are cleaned during D-phase per-view rebuilds. The high-
// traffic conversation/session/settings/banner/agent-tree/timeline surfaces
// were migrated under task A4 (chunk 1) and are no longer allow-listed.
const ALLOW_FILES = new Set([
  "apps/desktop/src/components/configInjector/ConfigInjectorAgentsTab.vue",
  "apps/desktop/src/components/configInjector/ConfigInjectorBackupsTab.vue",
  "apps/desktop/src/components/configInjector/ConfigInjectorGlobalTab.vue",
  "apps/desktop/src/components/configInjector/ConfigInjectorVersionsTab.vue",
  "apps/desktop/src/components/export/ExportTab.vue",
  "apps/desktop/src/components/export/ImportTab.vue",
  "apps/desktop/src/components/mcp/addServer/AddServerAdvanced.vue",
  "apps/desktop/src/components/mcp/McpServerCard.vue",
  "apps/desktop/src/components/mcp/McpTokenSummary.vue",
  "apps/desktop/src/components/replay/ModelSwitchBanner.vue",
  "apps/desktop/src/components/replay/ReplaySidebar.vue",
  "apps/desktop/src/components/replay/ReplayStepContent.vue",
  "apps/desktop/src/components/replay/ReplayTransportBar.vue",
  "apps/desktop/src/components/sessionComparison/ComparisonHeader.vue",
  "apps/desktop/src/components/sessionLauncher/SessionLauncherAdvanced.vue",
  "apps/desktop/src/components/sessionLauncher/SessionLauncherPreview.vue",
  "apps/desktop/src/components/sessionLauncher/SessionLauncherSaveTemplate.vue",
  "apps/desktop/src/components/sessionLauncher/SessionLauncherTemplates.vue",
  "apps/desktop/src/components/skills/import-wizard/SkillImportStep1Local.vue",
  "apps/desktop/src/components/skills/import-wizard/SkillImportStep3File.vue",
  "apps/desktop/src/components/skills/SkillImportWizard.vue",
  "apps/desktop/src/components/timeline/AgentTreeView.vue",
  "apps/desktop/src/components/timeline/TurnWaterfallView.vue",
  "apps/desktop/src/components/TodoDependencyGraph.vue",
  "apps/desktop/src/components/waterfall/TurnWaterfallHeader.vue",
  "apps/desktop/src/components/waterfall/TurnWaterfallTooltip.vue",
  "apps/desktop/src/components/WhatsNewModal.vue",
  "apps/desktop/src/components/wizard/WizardStepDatabase.vue",
  "apps/desktop/src/components/wizard/WizardStepReady.vue",
  "apps/desktop/src/components/wizard/WizardStepSessionDir.vue",
  "apps/desktop/src/views/ModelComparisonView.vue",
  "apps/desktop/src/views/orchestration/ConfigInjectorView.vue",
  "apps/desktop/src/views/orchestration/home/OrchestrationSystemHealth.vue",
  "apps/desktop/src/views/SessionReplayView.vue",
]);

const TEMPLATE_RE = /<template[^>]*>([\s\S]*?)<\/template>/i;
const ALLOW_DIRECTIVE = /<!--\s*design-system:\s*allow-emoji\s*-->/;
// Extended_Pictographic + miscellaneous symbol pictographs and dingbats commonly used as emoji.
const EMOJI_RE = /\p{Extended_Pictographic}/u;

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
    else if (name.endsWith(".vue")) out.push(full);
  }
}

function collectFiles(staged) {
  if (staged) {
    return gitStaged()
      .filter((f) => f.startsWith("apps/desktop/src/") && f.endsWith(".vue"))
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
  const m = TEMPLATE_RE.exec(text);
  if (!m) continue;
  const tpl = m[1];
  if (ALLOW_DIRECTIVE.test(tpl)) continue;
  // Compute starting line number of <template> for accurate reporting.
  const beforeIdx = m.index + m[0].indexOf(m[1]);
  const baseLine = text.slice(0, beforeIdx).split(/\r?\n/).length;
  const tplLines = tpl.split(/\r?\n/);
  for (let i = 0; i < tplLines.length; i++) {
    const line = tplLines[i];
    if (EMOJI_RE.test(line)) {
      const ch = line.match(EMOJI_RE)[0];
      violations.push({
        file: rel,
        line: baseLine + i,
        emoji: ch,
        src: line.trim(),
      });
    }
  }
}

if (violations.length === 0) {
  console.log(`✓ no-emoji-in-templates: ${files.length} file(s) checked, no violations`);
  process.exit(0);
}

console.error(`✗ no-emoji-in-templates: ${violations.length} violation(s)`);
for (const v of violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.error(`  ${v.file}:${v.line}: ${v.emoji}  // ${v.src.slice(0, 100)}`);
}
console.error(
  "\nFix: use Lucide icons via @tracepilot/ui (see 00-globals §G1 migration table),",
);
console.error(
  "or wrap user-supplied emoji in <UserContentEmoji> and add",
);
console.error(
  "`<!-- design-system: allow-emoji -->` inside the template block.",
);
process.exit(1);
