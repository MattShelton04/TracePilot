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
 *   node scripts/check-file-sizes.mjs             # check (CI)
 *   node scripts/check-file-sizes.mjs --list      # print current violations
 *
 * See: docs/archive/2026-04/tech-debt-plan-revised-2026-04.md § Phase 0.11
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, sep } from "node:path";

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
const ALLOWLIST = new Set([
  // ── Vue SFCs (Phase 4 decomposition targets) ───────────────────

  // ── TS stores (Wave 102 — biome formatter expansion) ───────────
  // TODO(w102): decompose try/catch helpers; expanded past budget by biome 2.4 formatter.
  "apps/desktop/src/stores/sdk/connection.ts",

  // ── Rust god-modules (Phase 4 decomposition targets) ───────────
  // TODO(FI-w123-error-variants): split ErrorCode variants into domain submodules when BindingsError grows further
  "crates/tracepilot-tauri-bindings/src/error.rs",
  "crates/tracepilot-orchestrator/src/bridge/manager.rs",
  // TODO(wave-2): decompose — see Phase 4 of docs/archive/2026-04/tech-debt-plan-revised-2026-04.md
  "crates/tracepilot-indexer/src/index_db/helpers.rs",
  "crates/tracepilot-tauri-bindings/src/commands/tasks.rs",
  "crates/tracepilot-orchestrator/src/task_db/operations.rs",
  "crates/tracepilot-orchestrator/src/worktrees.rs",
  "crates/tracepilot-tauri-bindings/src/commands/search.rs",
  "crates/tracepilot-orchestrator/src/task_context/sources.rs",
  "crates/tracepilot-core/src/utils/sqlite.rs",
  "crates/tracepilot-indexer/src/index_db/analytics_queries.rs",
  "crates/tracepilot-core/src/analytics/dashboard.rs",
  "crates/tracepilot-indexer/src/index_db/search_writer/content_extraction.rs",
  "crates/tracepilot-core/src/summary/mod.rs",
  "crates/tracepilot-bench/src/lib.rs",
  "crates/tracepilot-export/src/import/writer.rs",
  // TODO(FI-w123-migrations-module): split run_migrations out into a dedicated module
  "crates/tracepilot-indexer/src/index_db/migrations.rs",

  // ── Rust test files ─────────────────────────────────────────────
  "crates/tracepilot-core/src/turns/tests/builders.rs",
  "crates/tracepilot-core/src/turns/tests/model_tracking.rs",
  "crates/tracepilot-core/src/turns/tests/session_events.rs",
  "crates/tracepilot-core/src/turns/tests/subagent_lifecycle.rs",
  "crates/tracepilot-export/tests/integration.rs",
  "crates/tracepilot-indexer/src/index_db/search_writer/tests.rs",

  // ── Pinia stores (Phase 4/5) ────────────────────────────────────
  "apps/desktop/src/stores/worktrees.ts",
  "apps/desktop/src/stores/skills.ts",
  "apps/desktop/src/stores/tasks.ts",
  "apps/desktop/src/stores/mcp.ts",

  // ── Test files (allow-listed; not a Phase 4 priority) ──────────
  "apps/desktop/src/__tests__/stores/worktrees.test.ts",
  "apps/desktop/src/__tests__/stores/mcp.test.ts",
  "apps/desktop/src/__tests__/stores/sessionDetail.test.ts",
  "apps/desktop/src/__tests__/stores/skills.test.ts",
  "apps/desktop/src/__tests__/stores/configInjector.test.ts",
  "apps/desktop/src/__tests__/stores/search.test.ts",
  "apps/desktop/src/__tests__/stores/orchestrationHome.test.ts",
  "apps/desktop/src/__tests__/stores/launcher.test.ts",
  "apps/desktop/src/__tests__/stores/analytics.test.ts",
  "apps/desktop/src/__tests__/components/timeline/AgentTreeView.test.ts",
  "apps/desktop/src/__tests__/composables/useCachedFetch.test.ts",
  "apps/desktop/src/__tests__/composables/useImportFlow.test.ts",
  "apps/desktop/src/composables/__tests__/useGitRepository.test.ts",
  "apps/desktop/src/composables/__tests__/useTimelineToolState.test.ts",
  "apps/desktop/src/composables/__tests__/useAsyncData.test.ts",
  "apps/desktop/src/__tests__/views/analytics-views.test.ts",
]);

function gitLsFiles() {
  try {
    const out = execSync("git ls-files", { encoding: "utf8", cwd: REPO_ROOT });
    return out.split(/\r?\n/).filter(Boolean);
  } catch (err) {
    console.error("ERROR: failed to enumerate files via `git ls-files`:", err.message);
    process.exit(2);
  }
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

const files = gitLsFiles();
const violations = [];

for (const f of files) {
  if (f.includes("/node_modules/") || f.startsWith("node_modules/")) continue;
  if (f.startsWith("target/")) continue;
  if (f.startsWith("docs/")) continue;
  if (f.startsWith("assets/")) continue;

  const budget = budgetFor(f);
  if (!budget) continue;

  const abs = `${REPO_ROOT}${sep}${f.replaceAll("/", sep)}`;
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
  console.log(`✓ file-size check passed (${violations.length} allow-listed violation(s))`);
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
console.error(
  "\nSee docs/archive/2026-04/tech-debt-plan-revised-2026-04.md § Phase 4 for decomposition targets.",
);
process.exit(1);
