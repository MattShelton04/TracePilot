# TracePilot Tech-Debt — Review Consolidation (April 2026)

**Inputs:** three independent peer reviews of [`tech-debt-audit-2026-04.md`](./tech-debt-audit-2026-04.md) and [`tech-debt-plan-2026-04.md`](./tech-debt-plan-2026-04.md), by Claude Opus 4.7, GPT-5.4, and GPT-5.3-Codex.

Raw reviews:
- Opus 4.7 → [`tech-debt-review-2026-04.md`](./tech-debt-review-2026-04.md)
- GPT-5.4 → inlined below (not separately persisted)
- Codex 5.3 → inlined below (not separately persisted)

This document records **where reviewers agreed, where they disagreed, what the audit got wrong, and the resulting revisions to the plan.** The revised plan of attack lives in [`tech-debt-plan-revised-2026-04.md`](./tech-debt-plan-revised-2026-04.md).

---

## 1. Consensus on audit factual errors

The three reviewers independently flagged the following corrections to the audit. All are now considered authoritative — the audit will be patched to reflect them.

| # | Original audit claim | Correction | Evidence |
|---|---|---|---|
| 1 | `check_session_freshness` missing from `build.rs` | **Present** in both list and handler | `apps/desktop/src-tauri/build.rs:11`, `crates/tracepilot-tauri-bindings/src/lib.rs:114` |
| 2 | 20+ Vue SFCs > 1000 LOC | **17** > 1000 LOC | codex + gpt-5.4 independent counts |
| 3 | `PageShell` used in only 1 view | Used in **≥4** views (`ExportView`, `AnalyticsDashboardView`, `ToolAnalysisView`, `NotFoundView`) | gpt-5.4 + opus |
| 4 | `StatCard` used in 3 of 9 views | Used in **≥11** views (analytics, code-impact, model-comparison, task-dashboard, orchestrator-monitor, overview, metrics, token-flow, …) | gpt-5.4 + opus |
| 5 | `TabNav` is not imported anywhere | Imported by `SessionDetailPanel.vue:15-18` | gpt-5.4 |
| 6 | `useParallelAgentDetection` and `useGitRepository` have zero tests | Both have dedicated `__tests__/*.test.ts` | gpt-5.4 |
| 7 | `spawn_blocking` duplication in `commands/tasks.rs` is "≥14×" | Current count is **10×**; half already use `with_task_db` | all 3 reviewers |
| 8 | `default_subagent_model()` clones across "10+" sites | Current count is **6×** | gpt-5.4 |
| 9 | `packages/client/src/index.ts` is 883 LOC | Current: **~798 LOC** (still too large, still has leaked types + stub) | codex |
| 10 | `search_reader.rs` = 1413 LOC | **1415 LOC** (minor drift) | gpt-5.4 |
| 11 | `bridge/manager.rs` = 1132 LOC | **1135 LOC** (minor drift) | gpt-5.4 |
| 12 | `index_db/mod.rs` = 1060 LOC | **1065 LOC** (minor drift) | gpt-5.4 |
| 13 | CLI `better-sqlite3` is unused | **Used** in `apps/cli/src/commands/show.ts:270-272` | codex |
| 14 | `@tracepilot/ui`'s `vue-router` peer is dead | **Used** by `TabNav.vue:2-3,19-23` via `useRoute()`/`useRouter()` | gpt-5.4 |
| 15 | Plan references `packages/types/src/commands.ts` | No such file; hand-maintained registry lives at `packages/client/src/commands.ts` | gpt-5.4 |
| 16 | PresetManagerView "2365 LOC" (plan) vs "2134 LOC" (codex) | Audit/plan number matches current file; codex's count was partial. Use **2365** | cross-check |
| 17 | `export *` count = 17 | **17** confirmed by gpt-5.4; codex said 14 (probably counted differently — the authoritative index is `packages/types/src/index.ts:1-19`) | gpt-5.4 |

**Overall:** Opus found 20 CONFIRMED / 8 PARTIAL / 3 INCORRECT out of 32 claims; GPT-5.4 found ~28 CONFIRMED / 3 PARTIAL / 7 INCORRECT out of 30+ claims; Codex found 14 CONFIRMED / 3 PARTIAL / 3 INCORRECT of 20 claims. **Directional findings are all correct**; specific LOC and adoption counts had drifted.

## 2. Consensus on missing items (not in original audit)

Each item here was flagged by at least two reviewers independently, with evidence.

### 2.1 Security (elevated to P0 by all reviewers)

- **Filesystem path trust boundary.** `open_in_explorer`, `open_in_terminal`, `launch_session`, and orchestration commands accept user paths with only existence checks. A `is_subpath`-style jail helper already exists (`crates/tracepilot-tauri-bindings/src/helpers.rs:241-312`) but is inconsistently applied.
- **MCP URL policy / SSRF surface.** `crates/tracepilot-orchestrator/src/mcp/health.rs:185-227` POSTs to any user-supplied URL. No scheme allow-list, no loopback/private-range blocking.
- **`run_hidden_shell` shell injection.** `crates/tracepilot-orchestrator/src/process.rs:219-237` passes the raw `full_command` to `powershell -Command`; the plan flagged it but didn't give it P0 weight.

### 2.2 Database migration safety

- No migration fixture tests. `IndexDb` runs 11 ordered migrations on open (`crates/tracepilot-indexer/src/index_db/migrations.rs:357-395`); `TaskDb` uses key-value versioning (`crates/tracepilot-orchestrator/src/task_db/mod.rs:66-100`). Config also auto-migrates and auto-saves (`crates/tracepilot-tauri-bindings/src/config.rs:426-505`). No backup, no rollback, no N-1 snapshot test.
- Must land **before** any refactor that touches these modules.

### 2.3 Async / lifecycle

- **Listener ownership.** `App.vue:59-78` registers Tauri listeners without retaining unlisten handles. Stores eagerly register long-lived listeners; only `sdk` has cleanup.
- **Status broadcast channel size = 16.** `bridge/manager.rs:49` — undersized; can drop events under load (flagged by Opus).
- **Polling discipline.** `SessionSearchView.vue:214-226` polls every 5s; `orchestrator.ts:185-191` polls on interval. Neither gates on `document.hidden` / `visibilitychange`.
- **`SharedTaskDb` + `factory_reset`.** `OnceCell<TaskDb>` is **wrong** for a handle the user can wipe at runtime. Use `ArcSwapOption<TaskDb>` (Opus) or keep `RwLock<Option<T>>` with tighter scope (Codex). Consensus: apply `OnceCell` **only** to truly one-time init.

### 2.4 Cross-platform parity

- CI is Ubuntu-only (`.github/workflows/ci.yml:13-15`) but product is Windows-first (`README.md:13`).
- Release build is Windows-only (`.github/workflows/release.yml:63-90`).
- Desktop dev script is `cmd.exe`-specific (`apps/desktop/package.json:13`).
- CLI has path-separator assumptions visible in its own tests (`apps/cli/src/__tests__/commands/utils.test.ts:56-82`).
- **Must move to Phase 0.**

### 2.5 Quality gates & supply chain

- No test-coverage gate (CI runs tests but no threshold).
- Bundle and benchmark budget workflows warn only (`bundle-analysis.yml:76-81`, `benchmark.yml:109-113,134`); must hard-fail.
- GitHub Actions pinned by moving tag (`@v4`, `@v2`), not SHA.
- Rust toolchain on moving `stable`.
- `copilot-sdk` pinned to git SHA, not a crate release.
- Release signing-key password is an empty string (`release.yml:89`).

### 2.6 Accessibility & i18n

- No axe-based a11y tooling; only one aria assertion in tests.
- No i18n framework; locale formatting is ad-hoc. Decide: ADR for English-only, or introduce boundary.

### 2.7 Performance (frontend)

- `SearchPalette.vue:244-246,315-318` recomputes `uniqueSessionCount()` twice and allocates a Set over all results per render.
- `AgentTreeView.vue:1011-1029` re-filters/joins the same `messages` array inside the template.
- Phase 4 must include "template hot-path extraction," not just LOC reduction.

## 3. Disagreements between reviewers

| Topic | Opus 4.7 | GPT-5.4 | Codex 5.3 |
|---|---|---|---|
| Phase 4 visual-regression harness | **Mandatory blocker** | Recommended (coupled to a11y/perf outcomes) | Recommended |
| `OnceCell<TaskDb>` safety | **Breaks on `factory_reset` — use `ArcSwapOption`** | Use for true one-time init; `RwLock` for restartable | Use hybrid; `RwLock` for lifecycle |
| Phase 1.1 vs 1.4 order | 1.4 (capabilities) before 1.1 (codegen) | Split Phase 1 into 1A (security) + 1B (codegen) | Keep 1.1 early; add path/URL validation in same phase |
| Tokens to `@tracepilot/ui` | Yes, with bridge | Yes, **earlier** | Yes, with bridge |
| CLI Option A vs B | Not scored | **B now, A as future ADR** | **B first** |
| PageShell/StatCard severity | Downgrade (already adopted) | Downgrade (already adopted) | Downgrade |
| `cargo clippy --fix` in pre-push | Not called out | **Remove — too invasive** | Not called out |

**Resolved positions** (incorporated into revised plan):
- Use `ArcSwapOption<TaskDb>` for the reset-capable handle; `OnceCell` only for config; `RwLock`/`Mutex` for truly-mutable runtime state. (Synthesises Opus + GPT-5.4.)
- Split Phase 1 into **1A (security + errors + path policy)** and **1B (codegen + registries)**. (GPT-5.4's framing.)
- Add a Playwright-based visual + a11y harness as a Phase 0 deliverable so Phase 4 has a safety net. (Opus's blocker, operationalised.)
- Remove `clippy --fix` from pre-push; keep it as a pre-push optional `lefthook run --commands fix`.
- Adopt CLI Option B (subprocess + JSON contract). Option A stays an ADR-tracked future decision.

## 4. Plan sequencing — revised

The revised plan reorders to put correctness/security ahead of mechanical cleanup. Original was 0 → 1 → 2/3 → 4 → 5 → 6. Revised is:

```
0 → 1A → 1B → 3.8/3.4/3.5 (safety-critical backend) → 2 → 4 → 5.2 → 5.5(B) → 3.2/3.3 (decomposition) → 3.6/3.7/3.9 → 6.1/6.3 (release+xplatform) → 6.2 → 6.4 (docs)
```

Key moves:
- **Capability scoping, structured errors, path-jail policy** → move from Phase 1.4/1.5 to **Phase 1A** (immediately after Phase 0).
- **Migration fixture tests + async/lifecycle cleanups + path/shell hardening** → moved ahead of file-decomposition (was Phase 3.8/3.4/3.5, now before Phase 2).
- **Cross-platform CI matrix + action SHA pinning** → pulled into Phase 0.
- **Coverage gate + a11y smoke gate + visual-regression harness** → pulled into Phase 0.
- **Tokens out of desktop into `@tracepilot/ui`** → moved from Phase 5.2 to after Phase 2 adoption sweep (was late; should precede mega-SFC decomposition).
- **Docs reorg (6.4)** → demoted to last (was P0; reviewers agreed it's low risk and churn-prone).

## 5. Metric replacements (Appendix A)

Reviewers unanimously flagged that LOC-based and count-based metrics are gameable. Replacements in the revised plan:

| Gameable metric | Replaced with |
|---|---|
| "Rust files > 500 LOC = 0" | Generated binding diff clean in CI; destructive commands tested-absent from viewer capability |
| "`runAction` usage ≥ 90%" | ESLint/Biome rule banning raw `try/catch + toErrorMessage` in stores |
| "Raw `page-content`/`stat-card` usages = 0" | CSS lint rule; visual-regression tests cover top-10 views |
| "`:style` inline bindings < 10" | CSP `'unsafe-inline'` removed from `style-src` and desktop smoke passes |
| "Packages without README = 0" | Each package README contains token list / public API / mock policy sections (validated by script) |
| "Docs flat top-level ≤ 5" | Broken-link check clean + generated docs index |
| N/A (missing) | **Migration:** N-1 DB/config snapshots open cleanly on Windows + Linux |
| N/A (missing) | **Path safety:** traversal/symlink fuzz tests for every path-taking IPC |
| N/A (missing) | **Error stability:** zero frontend substring-matches on error messages; all branch on `code` |
| N/A (missing) | **Parity:** CI green on Windows + Linux for typecheck/tests; macOS build lane succeeds |

## 6. Technical-choice verdicts (reviewer-validated)

| Choice | Verdict |
|---|---|
| `specta` + `tauri-specta` vs `ts-rs`/`typeshare` | **specta + tauri-specta** — unanimous (covers commands + events + DTOs, not just DTOs) |
| `OnceCell<T>` vs `Arc<Mutex<Option<T>>>` | **Hybrid** — `OnceCell` only for TaskDb init; `ArcSwapOption<T>` for the reset-capable handle; `RwLock<TracePilotConfig>` for config; `Mutex/RwLock` for restartable orchestrator state |
| Tokens in `@tracepilot/ui` | **Yes, early** — unanimous; ship `@tracepilot/ui/tokens.css` with desktop compatibility shim |
| CLI Option A (N-API/WASM) vs B (subprocess+JSON) | **Option B now** — unanimous; A becomes a future ADR after contract stabilises |
| `cargo clippy --fix` in pre-push | **Drop from pre-push**; keep as optional `lefthook run --commands fix` (GPT-5.4) |

## 7. #1 concern per reviewer

- **Opus 4.7:** `AllowAllCommands` + viewer-* capability + markdown rendering is a live security surface; ship capability scoping + path validation as hotfixes before any codegen work.
- **GPT-5.4:** The plan sequences mechanical cleanup ahead of correctness/security. Correct the sequencing to pull capabilities, path-jail, structured errors, migration safety, and cross-platform parity earlier.
- **Codex 5.3:** Appendix A baselines are stale and gameable; input-validation/migration safety are under-prioritised; generate metrics from CI instead of hand-maintaining them.

**Synthesised #1 concern:** Security + runtime-safety work (capability scoping, path jail, structured errors, migration fixtures) must land before or alongside codegen, not after mechanical refactors. The revised plan reflects this.
