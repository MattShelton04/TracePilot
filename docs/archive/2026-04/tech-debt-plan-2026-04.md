# TracePilot Architecture Consolidation — Plan of Attack (April 2026)

**Companion document to:** [`tech-debt-audit-2026-04.md`](./tech-debt-audit-2026-04.md)
**Goal:** Move TracePilot from its current AI-assisted, organically-grown state to a deliberate, single-source-of-truth architecture that is easy to reason about, safe to change, and contributor-friendly.

This plan is organised as six **phases**, each with an objective, a checklist of workstreams, a definition of done, and the blast radius / risk. Phases are ordered so earlier work unlocks later work (e.g., codegen before SFC decomposition, helper adoption before view splitting).

## Guiding principles

1. **Codegen before hand-mirror.** Rust is the source of truth for IPC; TS types/commands are generated, never hand-written.
2. **Adopt before author.** Before writing new code, verify a shared helper/component/composable exists. If one exists and isn't used, use it.
3. **No new mega-files.** Enforce line-count budgets: Rust `.rs` ≤ 500 LOC (tests ≤ 700), Vue SFC ≤ 400 LOC total / 500 LOC style, TS store/composable ≤ 300 LOC.
4. **Single key registries.** All string-keyed identifiers (routes, feature flags, storage keys, model IDs, event names, permission IDs) live in `as const` registries.
5. **Fail closed.** Capabilities, CSP, lints, audits default to restrictive; allow-lists are explicit.
6. **One doc per topic.** Each topic has exactly one current doc; superseded docs go to `docs/archive/` with a pointer to the replacement.

Severity legend: 🔴 High · 🟡 Medium · 🟢 Low.

---

## Phase 0 — Scaffolding & Safety Net (prerequisite for everything)

**Objective:** Re-enable the gates that will keep subsequent refactors safe; add the tooling we'll rely on.

| Workstream | Detail |
|---|---|
| 0.1 CI hardening | Re-enable `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`, `biome lint`, `cargo audit`, `pnpm audit --prod`. Add `concurrency` groups. Add Windows to the matrix (keep Ubuntu for speed). Cache pnpm/cargo properly. |
| 0.2 Rust lint config | Add `[workspace.lints]` block (rust + clippy) with `unsafe_code = "forbid"`, `unwrap_used = "warn"`, `expect_used = "warn"`, `print_stdout = "warn"`. Add `rustfmt.toml` (max_width=100, group_imports="StdExternalCrate"). Add minimal `deny.toml` (banned, duplicates, sources, advisories). |
| 0.3 Biome tightening | Flip `noExplicitAny`, `noNonNullAssertion` from `warn` → `error` for new code (use `overrides` to keep legacy). Re-enable `noUnusedImports`/`noUnusedVariables` in Vue override. |
| 0.4 Lefthook parity | Add `cargo fmt` (write), `cargo clippy --fix`, `pnpm typecheck` to pre-push. Keep pre-commit fast (Biome + fmt only). |
| 0.5 File-size guardrails | Add a small Node script in `scripts/check-file-sizes.mjs` wired into CI that fails on new files exceeding budgets. Allow-list existing violations explicitly so the list only shrinks. |
| 0.6 Governance scaffolding | Add `CODEOWNERS`, `SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/{bug,feature,config}.yml`. |
| 0.7 Re-enable Dependabot | `dependabot.yml` with weekly npm + cargo + github-actions updates. Group by patch/minor. |

**Definition of done:** CI fails if lint/fmt/audit/typecheck/size-budget fails; governance files in place; dev machines pick up new hooks on next `lefthook install`.

**Risk:** Low — additive only. May surface existing lint violations; fix in the same PR set with `clippy --fix` / `biome check --fix`.

---

## Phase 1 — Single Source of Truth Foundations

**Objective:** Eliminate the biggest drift surfaces before any refactor.

### 1.1 Rust ↔ TS contract codegen 🔴

- Adopt **`specta` + `tauri-specta`** (preferred over ts-rs because it covers command signatures, not just types).
- Derive `specta::Type` on every DTO in `tauri-bindings/src/types.rs`, `tracepilot-core` public types, and shared orchestrator types.
- Wire `tauri-specta::collect_commands!` in `tauri-bindings/src/lib.rs` and emit to `packages/client/src/generated/{bindings,commands}.ts` at build time.
- Replace the hand-written `packages/types/src/commands.ts` and `packages/types/src/ipc-events.ts` command/event constants with generated artifacts (keep hand-written runtime constants only for things that are genuinely TS-only).
- Add a CI job: `cargo run -p tauri-bindings --bin gen-bindings && git diff --exit-code`.
- Delete the regex-based `commandContract.test.ts` once generation is authoritative.

### 1.2 TS key registries 🔴

Create under `apps/desktop/src/config/`:

- `routes.ts` — `export const ROUTES = { sessions: "/", …} as const; export type RouteName = keyof typeof ROUTES;` plus a typed `pushRoute(name, params)` helper.
- `featureFlags.ts` — `export const FEATURE_FLAGS = [...] as const; export type FeatureFlag = typeof FEATURE_FLAGS[number];`. Regenerate/validate against `@tracepilot/types` `DEFAULT_FEATURES`.
- `storageKeys.ts` — unified `"tracepilot:"` prefix. Migrate all 9 current keys; provide one-shot migration for old `tracepilot-*` keys.
- `sidebarIds.ts` — typed union used in `router/index.ts` meta.
- `tuning.ts` — named constants for `MAX_EVENTS`, `POLL_FAST_MS`, etc.

### 1.3 Rust constants module 🔴

- New `tracepilot-core::constants` with: `DEFAULT_CLI_COMMAND`, `DEFAULT_MODEL_ID`, `DEFAULT_SUBAGENT_MODEL`, `CREATE_NO_WINDOW` (moved from `process.rs`, made `pub`).
- Delete duplicates in `tauri-bindings/src/config.rs:357`, `orchestrator/src/types.rs:102`, `commands/tasks.rs:710`.
- Replace `default_subagent_model()` clones (10+ sites in `commands/tasks.rs`) with a single `cfg.default_subagent_model()` resolver.

### 1.4 Capability scoping 🔴

- Replace `.default_permission(AllowAllCommands)` (`build.rs:176`) with an explicit generated permission set.
- Split permissions into `main-capabilities.json` (all destructive ops) and `viewer-capabilities.json` (read-only: `get_session_*`, `search_*`, event emit listeners). Audit every `commands/window.rs` popup path.
- Add a CI test asserting viewer capabilities do not contain any `task_*`/`factory_reset`/`rebuild_*` command.

### 1.5 Rust error surface 🔴

- Redesign `BindingsError::serialize` to emit `{ code: "ALREADY_INDEXING", message, details? }` JSON with stable codes.
- Define `ErrorCode` enum in shared crate, derive `specta::Type` → generated TS discriminated union.
- Replace `isAlreadyIndexingError` substring match in `utils/backendErrors.ts` with code comparison.

**Definition of done:** a single change in a Rust IPC DTO produces a TS compile error in one and only one place (the consumer). All command/event/route/flag keys live in one registry each. `AllowAllCommands` removed.

**Risk:** Medium — touches every IPC call and every route. Do it in one branch, with codemods, then adopt incrementally.

---

## Phase 2 — Helper Adoption Sweep (Frontend)

**Objective:** Use what we've already built. Zero new abstractions.

### 2.1 Store error handling 🔴

- Mass-migrate 13 stores from manual try/catch/`toErrorMessage` to `runAction`/`runMutation` from `@tracepilot/ui`. ~90 call sites → ~15.
- Add a codemod (`scripts/codemods/run-action.mjs`) plus an ESLint/Biome custom rule to prevent regressions.

### 2.2 Composable adoption 🟡

- Mandate `useAsyncData` for new loading patterns; migrate the 13 `ref<T[]>([]) + loading + error` trios.
- Add `useInflightPromise<T>()` to `@tracepilot/ui/composables`, replacing the 3 manual dedup promises in `sessions.ts`.
- Add `usePersistedRef(key, default)` to `@tracepilot/ui/composables`; migrate `sdk.ts`, `alerts.ts`, `sessionTabs.ts`, `preferences.ts` persistence sites. Use the new `storageKeys.ts` registry.
- Convert `useAlertWatcher` from module-singleton state to a Pinia store (remove `alertInitDone` defensive guard from `App.vue`).

### 2.3 Shared-component adoption 🔴

- Adopt `PageShell` in all 16 views currently hand-rolling `.page-content > .page-content-inner`.
- Adopt `StatCard` in the 6 views with hand-rolled `.stat-card` DOM.
- Adopt `TabNav` in `ConfigInjectorView`, `TaskDetailView`, `McpServerDetailView`, `ExportView`.
- Adopt `SegmentedControl`, `FilterSelect`, `SearchInput` in `PresetManagerView`.
- Adopt `PageHeader` in `PresetManagerView`, `OrchestratorMonitorView`, `SessionLauncherView`, `ConfigInjectorView`.
- Add deprecation comments on the raw CSS classes (`.page-content`, `.stat-card`) with a CI lint to flag new usage.

**Definition of done:** grep for raw CSS scaffolding returns ≤ 0–2 hits; `runAction` usage ≥ 90% of async store actions; no module-level mutable state outside Pinia stores.

**Risk:** Low — these are mechanical substitutions with shared tests. Run Vitest per store after migration.

---

## Phase 3 — Backend Refactors

**Objective:** Break god-modules, dedupe SQL/process helpers, unify errors.

### 3.1 Kill legacy export modules 🔴

- Delete `crates/tracepilot-export/src/markdown.rs` and `src/json.rs` (the ones outside `render/`).
- Remove `anyhow` from workspace if no longer used; update import sites to `ExportError`.

### 3.2 `commands/tasks.rs` decomposition 🔴

- Split into `commands/tasks/{crud, jobs, orchestrator, ingest, presets}.rs` using glob re-exports (pattern from `memories`).
- Migrate every `spawn_blocking { db.lock() … ok_or_else(…"TaskDb not init"…) }` to `with_task_db`.
- Remove `is_process_alive` from this module to `orchestrator::process::is_alive`.
- Add unit tests for each submodule.

### 3.3 `bridge/manager.rs` decomposition 🔴

- Split into `bridge/{lifecycle, raw_rpc, session_tasks, ui_server, tests}.rs`.
- Extract `launch_ui_server` to `ui_server.rs` using the shared `process::run_hidden_stdout`.
- Replace `cli_url: Option<String>` with `enum ConnectionMode { Stdio, Tcp { url } }`.
- Audit `unlink_session`/`destroy_session` for `.abort()` calls on `event_tasks`; add regression test.

### 3.4 SQLite helpers consolidation 🟡

- Extend `core::utils::sqlite` with: `configure_readonly_connection`, `attach_slow_query_profiler(label)`, `Migrator` trait.
- Unify `IndexDb`/`TaskDb` PRAGMA + migration runner through these helpers.
- Unify `schema_version` convention across both DBs.

### 3.5 Process helpers consolidation 🟡

- Promote `CREATE_NO_WINDOW` to public in `tracepilot-core::constants` (see 1.3).
- Centralise `which`/`where` probing in `process::find_executable`.
- Replace inline `Command::new` in `bridge/manager.rs:807-840` and `bridge/discovery.rs` with shared helpers.
- Audit callers of `run_hidden_shell`; prefer `run_hidden(program, args)` for everything except explicit shell scripts.

### 3.6 LRU + broadcast forwarder generics 🟡

- Replace 2× hard-coded LRU cache constructors in `tauri-bindings/src/lib.rs:40-50` with `build_session_lru::<T>(cap)`.
- Replace 2× broadcast→emit loops with `forward_broadcast<T: Serialize>(rx, app, event_name)`.

### 3.7 Newtypes & validation 🟡

- Introduce `SessionId`, `PresetId`, `SkillName` in `tracepilot-core`; `validate_session_id` returns `SessionId`.
- Add uniform validation in command entrypoints (enum range, struct shape) via a `#[validate]` helper or small trait.

### 3.8 Concurrency cleanups 🟡

- Migrate `SharedTaskDb`/`SharedOrchestratorState`/config from `Arc<Mutex<Option<T>>>` to `tokio::sync::OnceCell<T>`.
- Review `commands/tasks.rs:52-90` — release the `SharedOrchestratorState` lock before FS/IO.
- Audit `bridge/manager.rs` RwLock usage: read-only ops should `.read()`.

### 3.9 Shared test support crate 🟢

- New `crates/tracepilot-test-support` (`[dev-dependencies]`) hosting `builders.rs`, `analytics/test_helpers.rs`, `export/test_helpers.rs`.
- Delete duplicate fixtures.

**Definition of done:** no Rust file > 500 LOC (non-test) / 700 LOC (test); clippy clean at `-D warnings`; Windows + Linux CI green; no `Mutex<Option<T>>` lazy-init idiom remaining in async paths.

**Risk:** Medium — mechanical splits are safe; newtypes and OnceCell changes need careful migration. Do 3.2 and 3.3 as separate PRs.

---

## Phase 4 — Frontend Decomposition

**Objective:** Break mega-SFCs and mega-stores. Line budgets enforced by Phase 0.5.

### 4.1 Top mega-SFCs (ordered by ROI) 🔴

Each decomposition extracts 3–6 child SFCs, moves CSS > 500 LOC to `styles/features/<name>.css` or child scoped styles, and adds at least one component test.

| File | LOC | Target children |
|---|---:|---|
| PresetManagerView.vue | 2365 | PresetStatsStrip, PresetFilterBar, PresetGrid, PresetList, NewPresetModal, EditPresetModal, DeletePresetConfirm |
| ConfigInjectorView.vue | 2020 | ConfigInjectorAgentsTab, …GlobalTab, …VersionsTab, …BackupsTab; move `AGENT_META` to shared registry |
| WorktreeManagerView.vue | 1990 | CreateWorktreeModal, WorktreeDetailsPanel, RegisteredReposList |
| AgentTreeView.vue | 1928 | composables/useAgentTreeLayout, useAgentTreeKeyboard, pure agentTreeRender utilities |
| SessionLauncherView.vue | 1855 | LauncherForm, LaunchTemplateList, LaunchTemplateFormModal |
| SessionSearchView.vue | 1734 | move 1157 LOC CSS out; already has children |
| OrchestratorMonitorView.vue | 1690 | OrchestratorStatsStrip, RunningJobsPanel, RecentJobsPanel |
| SkillEditorView.vue | 1635 | SkillFrontmatterEditor, SkillAssetsPanel, SkillPreviewPane |
| TaskCreateView.vue | 1566 | WizardStep1Preset, WizardStep2Variables, WizardStep3Submit, useTaskWizard composable |
| ExportView.vue | 1481 | ExportTab, ImportTab siblings under PageShell |
| TaskDetailView.vue | 1441 | TaskHeader, TaskResultsPanel, TaskJobsPanel, TaskLogsPanel |
| SdkSteeringPanel.vue | 1364 | SteeringControls, SteeringSessionsList, SteeringMessageEditor |
| McpServerDetailView.vue | 1360 | McpStatusCard, McpToolsList, McpConfigPanel |
| SkillImportWizard.vue | 1350 | SkillImportSource, SkillImportPreview, SkillImportConfirm |
| SessionComparisonView.vue | 1186 | ComparisonHeader, ComparisonMetricsGrid, ComparisonTimeline |
| TodoDependencyGraph.vue | 1125 | useTodoGraphLayout + TodoGraphNode, TodoDetailSlideover |
| ModelComparisonView.vue | 1120 | ModelStatsGrid, ModelLeaderboard, ModelDetailDrawer |
| TurnWaterfallView.vue | 1070 | useWaterfallLayout, WaterfallRow |
| NestedSwimlanesView.vue | 1063 | useSwimlaneLayout, SwimlaneRow |
| ChatViewMode.vue | 1010 | ChatTurnRow, ChatSubagentBlock |

### 4.2 Mega stores / composables 🔴

| File | Split plan |
|---|---|
| `useSessionDetail.ts` (698) | `session/cache.ts`, `useSessionTurnsRefresh.ts`, `useSessionSections.ts`, pure `sessionFingerprint.ts` |
| `stores/search.ts` (668) | `stores/search/{query, facets, indexing, maintenance}.ts` |
| `stores/sdk.ts` (615) | `stores/sdk/{connection, messaging, settings}.ts` + extract listeners into composable |
| `useOrbitalAnimation.ts` (602) | Pure `orbitalGeometry.ts` + animation controller |
| `stores/preferences.ts` (548) | Domain slices: `uiPrefs`, `pricingPrefs`, `alertsPrefs`, `featureFlags` |
| `useAlertWatcher.ts` (451) | Convert module state → Pinia store (see 2.2) |

### 4.3 Styling 🟡

- Replace static `:style="{ background: CHART_COLORS.x }"` bindings with class + `--color` custom CSS property pattern. Keep dynamic (e.g., progress bar width) as `:style`.
- Remove hardcoded hex fallbacks in `SearchResultCard.vue`, `designTokens.ts:65-78`, `SearchGroupedResults.vue`, `App.vue:339`.
- Move `designTokens.css` from `apps/desktop/src/styles/` to `packages/ui/src/styles/tokens.css` and export from package. Desktop imports it.
- After ≤ 10 `:style` remain, tighten Tauri CSP: drop `'unsafe-inline'` from `style-src`.

### 4.4 Router improvements 🟡

- Adopt `ROUTES` registry + `pushRoute` helper (from 1.2) across all `router.push` call sites (10+).
- Type `RouteMeta` (title, sidebarId, featureFlag) via module augmentation; remove `as string` casts.
- Extract breadcrumb logic from `App.vue:237-270` into `composables/useBreadcrumbs.ts`.
- Extract bootstrap phase state-machine (`App.vue:39 AppPhase`) into `useBootstrapPhase()`.

### 4.5 Tauri event boundary 🟡

- Wrap `App.vue:59,74` dynamic imports in `composables/useWindowLifecycle.ts`.
- Add `"popup-session-closed"` to the generated IPC events (Phase 1.1); remove raw string usage.

### 4.6 Component tests 🟡

Add at least a smoke + key-flow test per decomposed mega-SFC. Priority: `PresetManagerView`, `ConfigInjectorView`, `WorktreeManagerView`, `SessionLauncherView`, `SkillEditorView`, `TaskCreateView`, `TaskDetailView`, `SdkSteeringPanel`.

Add unit tests for the 6 previously-untested stores/composables: `sdk`, `presets`, `sessionTabs`, `alerts`, `useAlertWatcher`, `useOrbitalAnimation`.

**Definition of done:** no Vue SFC > 1000 LOC; no style block > 500 LOC; `runAction` universal; route/flag/storage registries universal; component tests for top-10 views; CSP `'unsafe-inline'` removable.

**Risk:** Medium — visual regressions possible. Use Playwright snapshot tests on each decomposition.

---

## Phase 5 — Shared Packages & CLI

**Objective:** Packages become self-describing, installable, well-typed building blocks. CLI stops duplicating backend logic.

### 5.1 `@tracepilot/client` cleanup 🔴

- Split `src/index.ts` (883 LOC) into `src/{search,sessions,tasks,config,maint,export}.ts` using the established per-domain pattern (`sdk.ts`, `mcp.ts`).
- Move `FtsHealthInfo`, `ContextSnippet`, `SessionHealth` back into `@tracepilot/types/src/search.ts`.
- Delete `getHealthScores` stub or guard behind `isTauri`.
- Add consistent mock fallback to `sdk.ts`, `mcp.ts`, `skills.ts` OR extract all mocks into a new `@tracepilot/client-mocks` opt-in package.
- Introduce `toRustOptional(v) => v ?? null` helper; replace the 20+ inline `?? null` sites.
- Shape ergonomics: `mcpListServers` returns `Record<string, McpServerConfig>` by wrapping the tuple response.
- Add `AbortSignal`/timeout support to `createInvoke`.
- Replace `window.__TRACEPILOT_IPC_PERF__` side-effect import with an explicit `enablePerfTracing()` call.

### 5.2 `@tracepilot/ui` 🔴

- Ship `src/styles/tokens.css` and export it (`"./tokens.css"` subpath export). Document required variables in `README.md`.
- Promote `apps/desktop/src/composables/{useAsyncData, useCachedFetch}` → `packages/ui/src/composables/`.
- Add `useTheme`, `useKeyboard` (shortcut manager), `useLocalStorage` to UI composables (replacing ad-hoc implementations).
- Convert `useToast` from module-level singleton to `provide/inject` pattern.
- Remove the `formatters.ts` back-compat shim after apps migrate.
- Mark `markdown-it`/`dompurify` as optional peers for apps that bring their own renderers.
- Fix mixed barrel/named re-exports in `index.ts`.
- Drop the unused `vue-router` peer.

### 5.3 `@tracepilot/types` 🟡

- Add `sideEffects: false`.
- Replace `export *` ×17 in `index.ts` with named re-exports (collision-safe).
- After Phase 1.1 codegen, delete manual mirrors that now come from Rust.
- Add tests for `tasks`, `session`, `models`, `conversation` invariants.
- Move `IPC_EVENTS` to `@tracepilot/client` (domain-coupled).

### 5.4 Packages general 🟡

- Add `README.md` to every package (including CLI): purpose, public API, when to use, tokens-required list for UI.
- Add `"sideEffects": false` where applicable.
- Formalise subpath exports; remove unused `declaration`/`sourceMap` from base tsconfig or actually emit dist.
- Drop `@tracepilot/config` or grow it into a real shared tsconfig/biome preset package.

### 5.5 CLI rebase 🔴

Two paths — pick one during implementation review:

- **Option A (preferred):** Make CLI consume the Rust crates via N-API or WASM. Keep the command surface but delegate business logic. Substantial work but eliminates duplication.
- **Option B (minimum):** Delete duplicated logic from CLI; CLI becomes a thin wrapper that spawns the Rust binary with a new `tracepilot-core --json` subcommand that returns the same data. Update `list`, `show`, `search` to call this.

Also:

- Consume `TracePilotConfig` in `session-path.ts`.
- Remove `better-sqlite3` unused dep.
- Promote `version-analyzer.ts` (38.5 KB) to a shared package OR delete if the Rust side owns versioning.
- Delete the `index` stub and the shell-echo `resume` command (or implement them properly).
- Remove checked-in `dist/` from the working tree (verify gitignore).

**Definition of done:** Every package has a README. No package file > 500 LOC. Types package is the single type source for IPC. Mocks out of prod bundle. CLI does not duplicate Rust logic.

**Risk:** High for CLI rebase (Option A). Medium for package splits (mechanical).

---

## Phase 6 — Release, Observability, Docs

**Objective:** Production hygiene.

### 6.1 Release pipeline 🟡

- Multi-OS Tauri build matrix (Windows + macOS DMG + Linux AppImage/deb).
- Add `SHA256SUMS` artefact + SLSA provenance (`actions/attest-build-provenance`) + SBOM (`anchore/sbom-action`).
- Optional cosign/minisign signing.
- Wire `git-cliff` to auto-generate `CHANGELOG.md` (or delete `cliff.toml`).
- Fix `CHANGELOG.md:10` future-dated entry.
- Move `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` into a real secret.

### 6.2 Observability 🟡

- Add opt-in crash reporting (sentry-tauri with a self-hosted endpoint or disabled default).
- Surface telemetry opt-in switch in config + privacy note in README.
- Sink `window.__TRACEPILOT_IPC_PERF__` to `tracing` when tokio-console feature is on.
- Add `#[tracing::instrument]` at all IPC command boundaries; standardise fields.
- Promote `mcp/health.rs::sanitize_error_msg` → `core::utils::log_sanitize` and adopt everywhere errors are logged.

### 6.3 Scripts & cross-platform 🟡

- Introduce a `justfile` mirroring the current `.ps1` scripts (build, dev, bench, clean, bump-version); keep `.ps1` as Windows shims that call `just`.
- Port `validate-session-versions.py` to Node/TS (remove Python dependency).
- Consolidate 13 `scripts/e2e/*.mjs` into Playwright tests under `tests/e2e/` using the existing `playwright-core` dep.
- Add `scripts/README.md`.

### 6.4 Docs reorganisation 🔴

- Create `docs/archive/`.
- Move superseded docs to `docs/archive/YYYY-MM/` with a pointer stub:
  - `tech-debt-report.md`, `tech-debt-report-review.md`, `tech-debt-consolidation-report.md`, `tech-debt-future-improvements.md` → archive (replaced by `tech-debt-audit-2026-04.md`).
  - `implementation-plan.md`, `implementation-phases.md`, `implementation-roadmap.md` → archive (replaced by `tech-debt-plan-2026-04.md`).
  - `ai-task-system.md`, old `*-implementation-plan.md` duplicates.
  - `copilot-sdk-integration-evaluation.md` (superseded by deep-dive).
  - `tantivy-search-index.md` (not adopted).
  - `performance-analysis-report.md`, `performance-profiling-results.md` (keep `performance-playbook.md`).
- Regroup remaining docs under: `architecture/`, `guides/`, `plans/`, `reports/`, `research/`, `design/`, `archive/`.
- Rebuild `docs/README.md` index generated from filesystem (`scripts/build-docs-index.mjs`).
- Fix `2026-*` future-dated reports to correct year.
- Rename `SECURITY_AUDIT_REPORT.md` → `security-audit-report.md`.
- Move `docs/design/prototypes/` (~2.5 MB HTML) to `assets/design-prototypes/` or outside the repo.
- Introduce `docs/adr/` (architecture decision records) starting with ADR-0001: Adopt specta; ADR-0002: Route registry; ADR-0003: Capability scoping.

### 6.5 Perf budgets 🟡

- Wire `perf-budget.json` IPC thresholds to a new `tracepilot-bench` IPC bench.
- Flip `bundle-analysis.yml` and `benchmark.yml` from `::warning::` to `::error::` + `exit 1` on budget breach.

### 6.6 Dependency hygiene 🟡

- Adopt pnpm `catalog:` for shared TS deps (vue, typescript, vitest, @types/node, biome).
- Hoist `tauri`, `tauri-plugin-*`, `tempfile`, `uuid`, `tokio`, `sha2` to `[workspace.dependencies]`; use `workspace = true` everywhere.
- Vendor `copilot-sdk` or switch to an upstream release tag when available.
- Remove unused `playwright-core` from root (or adopt Playwright test runner in 6.3).

**Definition of done:** release artefacts are signed + SBOM'd on all 3 OSes; crash reports flow; docs have archive + index; IPC perf budgets hard-fail.

**Risk:** Low — mostly tooling.

---

## Execution order & dependencies

```
Phase 0 ─┐
         ├─► Phase 1 ─┬─► Phase 2 ─┬─► Phase 4
         │           └─► Phase 3 ─┤
         ├─► Phase 5 ◄────────────┘
         └─► Phase 6  (parallel with 5, after 0)
```

- **Phase 0** is a prerequisite for all refactor phases (guard-rails).
- **Phase 1** unlocks everything downstream by removing the drift surface.
- **Phase 2** (helper adoption) and **Phase 3** (backend decomposition) are independent and can run in parallel.
- **Phase 4** (mega-SFC decomposition) depends on Phase 2 (helpers) and Phase 1 (registries).
- **Phase 5** (packages/CLI) depends on Phase 1 (codegen).
- **Phase 6** is mostly tooling and can run opportunistically after Phase 0.

## Initial PR batching (first wave)

The first wave (post-Phase-0) should be a small number of surgical PRs that unlock everything:

1. **PR-A (Phase 0):** CI hardening + lefthook parity + governance files + lint configs + file-size guard.
2. **PR-B (Phase 1.1):** Adopt specta/tauri-specta; generate `commands.ts`/types; delete hand-mirror.
3. **PR-C (Phase 1.2/1.3):** TS registries + Rust constants module.
4. **PR-D (Phase 1.4/1.5):** Capability scoping + structured error codes.
5. **PR-E (Phase 2.1):** Mass-migrate stores to `runAction`/`runMutation`.
6. **PR-F (Phase 2.3):** Mass-adopt `PageShell`/`StatCard`/`TabNav`/`SegmentedControl`.

After these land, Phase 3/4/5 work can proceed opportunistically, one mega-file per PR.

## Out of scope for this plan

- Feature work (new views, new commands).
- Design changes beyond removing inline styles / adopting tokens.
- Migration away from Tauri, Pinia, Vue, SQLite, FTS5 — all remain canonical.
- CLI → Rust port via N-API/WASM is listed as Option A in 5.5 but may be deferred.

---

## Appendix A — Success metrics

| Metric | Baseline (2026-04) | Target |
|---|---|---|
| Rust files > 500 LOC (non-test) | 33 | 0 |
| Vue SFCs > 1000 LOC | 20 | 0 |
| Stores/composables > 300 LOC | 6 | 0 |
| Raw `class="page-content"` usages | 16 | 0 |
| Raw `.stat-card` usages | 6 | 0 |
| `toErrorMessage(e)` manual catch sites | ~90 | < 10 |
| Hand-mirrored IPC commands | 161 | 0 (generated) |
| localStorage key strings | 9 (mixed prefix) | 1 registry |
| `:style` inline bindings | 100+ | < 10 |
| Disabled CI gates | clippy/fmt/lint/audit | 0 |
| Allow-all capability rules | 1 (everywhere) | 0 |
| Packages without README | 5/5 | 0 |
| Docs in flat top-level | 30+ | ≤ 5 (README + indices) |

## Appendix B — Breaking changes expected

- IPC error payloads change from plain string to `{code, message}` (frontend migration in Phase 1.5).
- localStorage keys renamed (`tracepilot-*` → `tracepilot:*`) with one-shot migration in Phase 1.2.
- Package subpath exports may change (`@tracepilot/ui/tokens.css` added in Phase 5.2).
- CLI command behaviour change if Option A or B from 5.5 is adopted.
- Tauri capability renames (main vs viewer) in Phase 1.4.
