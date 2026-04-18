# TracePilot Architecture Consolidation — Revised Plan of Attack (April 2026)

**Supersedes:** [`tech-debt-plan-2026-04.md`](./tech-debt-plan-2026-04.md) (the original plan is retained for historical reference; this doc is authoritative).
**Companion documents:** [`tech-debt-audit-2026-04.md`](./tech-debt-audit-2026-04.md), [`tech-debt-review-consolidation-2026-04.md`](./tech-debt-review-consolidation-2026-04.md).

---

## What changed vs the original plan

The original plan was peer-reviewed by three independent models (Opus 4.7, GPT-5.4, Codex 5.3). Their consolidated feedback drove these revisions:

1. **Phase 1 split into 1A (security + errors + path policy) and 1B (codegen + registries).** Capability scoping, structured error envelopes, and filesystem path jailing are **hotfix-tier** and must not wait for codegen.
2. **Phase 0 widened from "lint/tooling" to "safety + portability."** Cross-platform CI matrix, action SHA pinning, coverage gate, a11y smoke gate, visual-regression harness, and **migration snapshot tests** land here.
3. **Safety-critical backend subset of Phase 3 (3.4 migration strategy, 3.5 path/process helpers, 3.8 concurrency cleanups) moved ahead of Phase 2** (helper adoption). Fixing lifecycle/state ownership before splitting files avoids fossilising the wrong abstractions.
4. **Mega-SFC decomposition (Phase 4) now coupled to behaviour/perf outcomes**, not just LOC — visual-regression tests, a11y checks, and template hot-path extraction are blocking.
5. **Tokens move to `@tracepilot/ui` earlier** (before mega-SFC decomposition, not in Phase 5).
6. **CLI commits to Option B (subprocess + JSON contract).** Option A (N-API/WASM) becomes a future ADR.
7. **`OnceCell<T>` applied selectively.** `ArcSwapOption<TaskDb>` for the reset-capable handle; `RwLock<TracePilotConfig>` for config; `Mutex/RwLock` for restartable orchestrator state.
8. **Docs reorg demoted to last.** Valuable but low-risk and churn-prone; should not compete with runtime-safety work.
9. **Appendix A metrics replaced with non-gameable, CI-generated ones.** LOC counts out; generated-binding diff + migration snapshot + path-jail fuzz + CSP hardening + xplatform green in.
10. **Plan grounded in corrected audit facts.** See [`tech-debt-review-consolidation-2026-04.md`](./tech-debt-review-consolidation-2026-04.md) §1.

## Guiding principles (unchanged)

1. **Codegen before hand-mirror.** Rust is the source of truth for IPC.
2. **Adopt before author.** Shared helpers/components exist; use them.
3. **Enforce, don't exhort.** Lint rules + CI gates are the real guard-rails; style guides alone don't stick.
4. **Single key registries.** All string-keyed identifiers in `as const` registries.
5. **Fail closed.** Capabilities, CSP, lints, audits default to restrictive.
6. **Correctness before cosmetics.** Security, migration safety, and async lifetime ownership come before file-size reductions.

Severity legend: 🔴 Critical · 🟠 High · 🟡 Medium · 🟢 Low.

---

## Execution order

```
Phase 0  (guard-rails: CI + xplatform + coverage + a11y + migration snapshots + visual-regression harness)
   │
   ├─► Phase 1A  (security hotfixes: capabilities, path jail, structured errors, MCP URL policy)
   │      │
   │      └─► Phase 1B  (codegen: specta+tauri-specta, TS registries, Rust constants)
   │             │
   │             └─► Phase 3-safety  (migration strategy, path/process helpers, concurrency cleanups)
   │                    │
   │                    ├─► Phase 2   (helper adoption sweep — frontend)
   │                    │      │
   │                    │      └─► Phase 5.2  (tokens into @tracepilot/ui)
   │                    │             │
   │                    │             └─► Phase 4  (mega-SFC decomposition, with visual-regression + a11y gates)
   │                    │
   │                    └─► Phase 3-decomp  (commands/tasks.rs, bridge/manager.rs decomposition)
   │                           │
   │                           └─► Phase 3-polish  (generics, newtypes, test-support crate)
   │
   ├─► Phase 5 (packages cleanup + CLI Option B)        [parallel with Phase 4]
   │
   ├─► Phase 6.1 / 6.3  (release pipeline + xplatform scripts)  [parallel after Phase 0]
   │
   ├─► Phase 6.2  (observability)
   │
   └─► Phase 6.4  (docs reorg — last)
```

---

## Phase 0 — Guard-rails (prerequisite for everything) 🔴

**Objective:** Re-enable the gates, add coverage/a11y/visual harnesses, and establish cross-platform parity **before** any refactor touches code.

| # | Workstream | Detail |
|---|---|---|
| 0.1 | CI hardening | Re-enable `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --check`, `biome lint`, `cargo audit`, `pnpm audit --prod`. Concurrency groups. Cache pnpm/cargo. |
| 0.2 | **Cross-platform CI matrix** | Add Windows + macOS lanes alongside Ubuntu for `typecheck` + `cargo test` + `pnpm test`. **Blocking** for main-branch merges. |
| 0.3 | Action SHA pinning | Pin all `uses:` to commit SHAs (not `@v4`/`@v2`). Dependabot handles updates. |
| 0.4 | Rust lint config | `[workspace.lints]` with `unsafe_code = "forbid"`, `unwrap_used = "warn"`, `expect_used = "warn"`, `print_stdout = "warn"`. Add `rustfmt.toml` + minimal `deny.toml`. |
| 0.5 | Biome tightening | Flip `noExplicitAny` + `noNonNullAssertion` from `warn` → `error` for new code (`overrides` grandfather legacy). Re-enable `noUnusedImports`/`noUnusedVariables` in Vue override. |
| 0.6 | Lefthook parity | Add `cargo fmt`, `pnpm typecheck` to pre-push. **Do not** add `cargo clippy --fix` (too invasive); expose as optional `lefthook run --commands fix`. |
| 0.7 | **Coverage gate** | `vitest --coverage` + `cargo tarpaulin` with initial threshold set to current-baseline + floor; tightening schedule documented. |
| 0.8 | **a11y smoke gate** | Add `@axe-core/playwright` (or `vitest-axe` for component tests); run against at least App shell + top 5 views. Warn-only at first, error after Phase 4. |
| 0.9 | **Visual-regression harness** ✅ **DONE (Wave 16b, component-level)** — Playwright CT (`@playwright/experimental-ct-vue`) harness in `packages/ui` with baselines for `StatCard` / `TabNav` / `PageHeader` / `SegmentedControl` / `PageShell` covering the variants added in waves 10–11. Runs on-demand via `pnpm --filter @tracepilot/ui vrt`; **deliberately not** wired into default CI (baselines are platform-sensitive). View-level VRT (mocked Tauri IPC, App shell + top-N views) flagged as follow-up, to land with Phase 4 decomposition. |
| 0.10 | **Migration fixture tests** | Commit historical `IndexDb`/`TaskDb`/`config.json` snapshots for N-3 to N; tests migrate them up to current on every CI run. |
| 0.11 | File-size guardrails | `scripts/check-file-sizes.mjs` in CI: fail on **new** files exceeding budgets; existing violations allow-listed (list only shrinks). |
| 0.12 | Governance scaffolding | `CODEOWNERS`, `SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/{bug,feature,config}.yml`. |
| 0.13 | Re-enable Dependabot | Weekly npm + cargo + github-actions. Group by patch/minor. |
| 0.14 | Generated-metrics script | `scripts/generate-debt-metrics.mjs` produces Appendix A numbers; CI fails if the committed metrics file differs from generated output. |
| 0.15 | Platform policy ADR | `docs/adr/0001-supported-platforms.md`: declare Windows-primary, Linux-secondary, macOS-tertiary (or whatever is true). Drives CI matrix enforcement. |

**Definition of done:** CI fails on lint/fmt/audit/typecheck/coverage/size/visual-diff/migration/xplatform break. Visual-regression baselines captured for top-20 mega-SFCs. Migration snapshot fixtures in place. Action SHAs pinned. Cross-platform matrix green on `main`.

**Risk:** Low — additive. May surface existing lint/coverage/xplatform failures; fix in the same batch.

---

## Phase 1A — Security & runtime safety hotfixes 🔴 CRITICAL

**Objective:** Close live security gaps before touching anything else. Each item ships as its own small PR.

### 1A.1 Tauri capability scoping ✅ DONE

- ~~Replace `.default_permission(AllowAllCommands)` (`build.rs:176`) with an explicit allow-list generated from the command registry.~~ Kept `AllowAllCommands` because it emits per-command `tracepilot:allow-<cmd>` identifiers we can reference from the viewer capability; main continues to use `tracepilot:default`.
- Split into [`capabilities/main.json`](../apps/desktop/src-tauri/capabilities/main.json) (`windows: ["main"]`, full permission surface) and [`capabilities/viewer.json`](../apps/desktop/src-tauri/capabilities/viewer.json) (`windows: ["viewer-*"]`, 15 read-only tracepilot commands plus minimal core/window/log).
- `default.json` removed so there is no blanket overlap.
- Rationale and allow-list audit in [`docs/adr/0002-tauri-capability-scoping.md`](adr/0002-tauri-capability-scoping.md).
- **Test (deferred):** `capabilities::test_viewer_disallows_destructive` asserting no `task_*`/`factory_reset`/`rebuild_*`/config-write command is present in viewer permission set. Current viewer.json is a static allow-list; add the regression test when a test crate for capability JSON parsing is introduced.

### 1A.2 Filesystem path trust boundary ✅ DONE

- ADR written: [`docs/adr/0003-filesystem-trust-boundary.md`](adr/0003-filesystem-trust-boundary.md) documents which commands accept arbitrary paths, the canonicalisation/UNC-rejection contract, and symlink policy.
- `canonicalize_user_path` helper in `crates/tracepilot-orchestrator/src/launcher.rs:292-324` is now called from `launch_session`, `open_in_explorer`, `open_in_terminal` (wave 1 landed).
- **Follow-up (tracked for later wave):** jail-root helper `path_within(root, candidate)` for commands that need containment beyond existence + no-UNC (see ADR §"Future work").
- **Tests:** existing launcher tests cover NUL byte, UNC rejection, verbatim prefix stripping. Traversal/symlink fuzz deferred to Phase 2 when we introduce the jail-root helper.

### 1A.3 MCP URL policy / SSRF mitigation

- New module `crates/tracepilot-orchestrator/src/mcp/url_policy.rs`:
  - scheme allow-list (`http`/`https` only)
  - block loopback + RFC1918 + link-local + `169.254.*` unless explicitly user-opted-in per server
  - resolve host and re-verify after redirect
- Apply in `mcp/health.rs:185-227` and all MCP POST paths.
- **Tests:** loopback, private-range, DNS rebinding (short-TTL re-resolve), HTTP redirect to internal.

### 1A.4 Shell-injection hardening

- Split `run_hidden_shell` (`crates/tracepilot-orchestrator/src/process.rs:219-237`) into:
  - `run_hidden(program, args: &[&str])` — default, uses `Command::new` with argv
  - `run_hidden_shell_script(script: PathBuf)` — only for actual script files
- Migrate every caller off the string-accepting variant.
- Keep `CREATE_NO_WINDOW` (`0x08000000`) on all variants (Windows).

### 1A.5 Structured IPC error envelope ✅ DONE (wave 3)

- `BindingsError::serialize` already emits `{ code, message }` (wave 1). Wave 3 adds a `scrub_message` pass that redacts Windows/macOS/Linux usernames in path segments and common bearer-token / GitHub-PAT shapes before the message crosses IPC. See `crates/tracepilot-tauri-bindings/src/error.rs` info-leak audit table and tests `scrub_*`.
- `ErrorCode` enum + per-variant code test already present.
- Frontend structured fast path lands via `isAlreadyIndexingError(raw)` accepting the raw error and checking `code` first; legacy substring match kept as fallback.
- **Follow-up:** `specta::Type` derive for `ErrorCode` blocked on Phase 1B typegen work.

### 1A.6 Status broadcast channel sizing ✅ DONE (wave 4)

- Event channel sized to 512, status channel sized to 256 (wave 2).
- Added `BridgeMetrics` (atomic counters) + `metrics_snapshot()` accessor on `BridgeManager`. Forwarder increments `events_forwarded` on success and `events_dropped_due_to_lag` + `lag_occurrences` on `RecvError::Lagged`. Existing `warn!` log retained.
- Exposed via `sdk_bridge_metrics` IPC command + `sdkBridgeMetrics()` TS wrapper (wave 5). Types live in `@tracepilot/types::BridgeMetricsSnapshot`; serde `rename_all = "camelCase"` keeps wire format consistent with other DTOs.

### 1A.7 Listener ownership ✅ DONE (wave 5)

- `App.vue:59-78` listeners now live in `composables/useWindowLifecycle.ts` — retained + disposed via `onScopeDispose`, with an explicit `getCurrentScope()` assertion so the "attached inside an awaited `onMounted`" footgun is caught loudly instead of silently leaking.
- `stores/search.ts` IPC `unlisteners` array now drained by a store-scope `onScopeDispose`. Fires on `pinia.dispose()` / window teardown / HMR so search event handlers no longer leak across reloads.

**Definition of done:** `AllowAllCommands` gone; viewer capability proven-narrow by test; every path-taking IPC passes a fuzz suite; MCP URLs can't hit loopback; shell-injection surface closed; IPC errors are `{code, message, details?}`; frontend has zero substring-matches on error messages; broadcast channel can't silently drop status events; no leaked listeners on window close / HMR.

**Risk:** Medium — capability changes can surface "works on my machine" IPC calls. Coupled to Phase 0 visual-regression + cross-platform CI catches most regressions.

---

## Phase 1B — Single-source-of-truth foundations 🔴

**Objective:** Eliminate the drift surfaces (hand-mirrored command/event/route/flag registries).

### 1B.1 Rust ↔ TS contract codegen — 🟡 PARTIAL (wave 8 infra; wave 21 session-listing batch)

Infrastructure landed and a narrow pilot is generating cleanly. The bulk of
the DTO sweep is deferred to subsequent waves. Full playbook:
[`docs/specta-migration-guide.md`](./specta-migration-guide.md).

- Adopt `specta` + `tauri-specta`. Derive `specta::Type` on every DTO in `tauri-bindings/src/types.rs`, `tracepilot-core` public types, orchestrator shared types, and the new `ErrorCode` enum from 1A.5. — 🟡 **PARTIAL**: workspace deps wired (`specta =2.0.0-rc.24`, `tauri-specta =2.0.0-rc.24`, `specta-typescript =0.0.11`); derives landed on `ErrorCode` (wire format verified against `backendErrors.ts`) and `BridgeMetricsSnapshot` only. Every other DTO **DEFERRED** to next wave — see migration guide for order of payoff.
- Wire `tauri-specta::collect_commands!` in `tauri-bindings/src/lib.rs` and emit to `packages/client/src/generated/{bindings,commands,events}.ts` at build time. — 🟡 **PARTIAL**: `collect_commands!` lives in a hidden `specta_exports` module driven by a new `gen-bindings` binary; single emitted file `packages/client/src/generated/bindings.ts` covers the pilot command `sdk_bridge_metrics`. The builder is **NOT** wired into runtime `init()` yet — `tauri::generate_handler![...]` is still authoritative. Runtime cutover **DEFERRED** until every command is annotated (see migration guide "Plan: replacing `tauri::generate_handler!`").
- Replace the hand-maintained `packages/client/src/commands.ts` (authoritative location — not `packages/types/src/commands.ts` as the original plan incorrectly stated). — **DEFERRED** (pilot explicitly does not touch `commands.ts`).
- Generate TS discriminated union for `ErrorCode`. — ✅ **DONE**: `bindings.ts` emits `export type ErrorCode = "IO" | "TAURI" | … | "VALIDATION"` verbatim matching the legacy `as_str()` output.
- CI job: `cargo run -p tauri-bindings --bin gen-bindings && git diff --exit-code`. — 🟡 **DOCUMENTED** in migration guide (§ "CI recommendation"), not yet wired into lefthook/GHA. `pnpm gen:bindings` script is in the root `package.json`.
- Add `"popup-session-closed"` to the IPC event registry (currently raw-stringed in `App.vue:74-77` and `ChildApp.vue:63`). — **DEFERRED** (requires `tauri_specta::collect_events!` sub-wave; see migration guide).
- Delete the regex-based `commandContract.test.ts` once generation is authoritative. — **DEFERRED** (retained until full command migration completes).

**Wave-8 deliverables:** `docs/specta-migration-guide.md`; `crates/tracepilot-tauri-bindings/src/{specta_exports.rs, bin/gen-bindings.rs, build.rs}`; pilot derives on `ErrorCode` + `BridgeMetricsSnapshot`; checked-in `packages/client/src/generated/bindings.ts`; `pnpm gen:bindings` script.

**Wave-21 deliverables (session-listing batch):** Additive specta annotations on `SessionListItem` + `FreshnessResponse` DTOs and `list_sessions` + `check_session_freshness` commands in `crates/tracepilot-tauri-bindings`. Extended `collect_commands!` allow-list in `specta_exports.rs`. Fixed a drift bug in the hand-written `SessionListItem` mirror (`cwd?: string | null` was missing). New drift-detection test at `packages/client/src/__tests__/generated.drift.test.ts` asserts compile-time assignability between generated and hand-written shapes. `SessionIncidentItem` was dropped mid-wave — its `Option<serde_json::Value>` field requires a forwarding `impl specta::Type` (tracked in the migration guide under "DTOs needing per-field overrides"). `tauri::generate_handler!` is **untouched** — runtime registration unchanged.

### 1B.2 TS key registries — ✅ DONE (wave 13)

Under `apps/desktop/src/config/`:

- `routes.ts` — `export const ROUTE_NAMES = {…} as const`; `RouteName` union + `isRouteName()` guard. ✅ landed (wave 6). `router/types.ts` RouteMeta augmentation now narrows `sidebarId?: SidebarId` and adds `redirectTo?: RouteName`. All `router.push/replace({ name: ... })` call sites migrated (router/index.ts, WorktreeManagerView, McpServerDetailView, McpServerCard, SkillEditorView, SessionListView, SessionDetailView, SessionReplayView, ExportView). Route-record `name:` literals in the declarative routes array intentionally left as string literals — drift is caught by `src/__tests__/router/routeRegistry.test.ts` which asserts every registered route is in `ROUTE_NAMES` (and vice versa) and every `meta.sidebarId` is in `SIDEBAR_IDS`.
- `sidebarIds.ts` — `SIDEBAR_IDS` const + `SidebarId` union (20 entries). ✅ landed (wave 6). Covered by the registry consistency test above.
- `tuning.ts` — cross-cutting tuning constants only (`POLL_FAST_MS`, `POLL_SLOW_MS`, `MAX_SDK_EVENTS`). ✅ landed (wave 6) and wired into `stores/orchestrator.ts` and `stores/sdk.ts`. Component-local animation/debounce durations deliberately **not** hoisted — cohesion wins over SSOT when a constant has a single caller.
- `featureFlags.ts` — ✅ landed (wave 13). `FEATURE_FLAGS` / `FeatureFlag` / `isFeatureFlag()` derived at runtime from `DEFAULT_FEATURES` in `@tracepilot/types`, so the array and backend-shaped record cannot drift. `RouteMeta.featureFlag`, `NavItem.featureFlag`, and `preferences.isFeatureEnabled()`/`toggleFeature()` now type against `FeatureFlag`. Registry consistency test: `src/__tests__/config/featureFlags.test.ts`.
- `storageKeys.ts` — ✅ landed (wave 13). `STORAGE_KEYS` / `StorageKey` consolidates every `localStorage` key used by the desktop app (theme, last-session, last-seen-version, legacy-prefs, update-check, dismissed-update, sdk-settings, session-tabs, alerts). Existing dash- and colon-style values are preserved verbatim for backwards compatibility with installed users. `storageKeysMigration.ts` exposes `runStorageKeyMigrations()` as a no-op scaffold (wired from `main.ts` before any store setup) so future key renames land as single edits instead of ad-hoc per-call-site migrations. Registry test: `src/__tests__/config/storageKeys.test.ts`.

### 1B.3 Rust constants module ✅ DONE (wave 4)

- New `crates/tracepilot-core/src/constants.rs` exports: `DEFAULT_CLI_COMMAND`, `DEFAULT_ORCHESTRATOR_MODEL` (+ back-compat alias `DEFAULT_MODEL_ID`), `DEFAULT_SUBAGENT_MODEL`, `CREATE_NO_WINDOW`.
- Migrated call sites: `tauri-bindings/src/config.rs` (cli_command + orchestrator/subagent models), `orchestrator/src/types.rs` (default_cli_command), `orchestrator/src/launcher.rs` (check_dependencies), `orchestrator/src/bridge/manager.rs` (which/where probe + fallbacks), `orchestrator/src/task_orchestrator/launcher.rs` (defaults), `orchestrator/src/templates.rs` (5× template seeds), `tauri-bindings/src/commands/session.rs` (resume fallback), `tauri-bindings/src/commands/tasks.rs` (0x08000000 literal → `CREATE_NO_WINDOW`).
- `orchestrator/src/process.rs` now re-exports `tracepilot_core::constants::CREATE_NO_WINDOW` under the same path so existing `crate::process::CREATE_NO_WINDOW` references keep compiling.
- Frontend: `apps/desktop/src/stores/orchestrator.ts` hardcode replaced with `DEFAULT_ORCHESTRATOR_MODEL` from `@tracepilot/types`.
- **Deferred:** `default_subagent_model()` resolver collapsing 6× clones in `commands/tasks.rs` — **re-evaluated in wave 5** and dropped: the "6× clones" are 5 separate async function scopes each legitimately cloning the string once for ownership in `tokio::spawn` / per-task state. Extracting a resolver saves nothing and forces an `Arc<str>` change that isn't justified. Marked as WONTFIX.

**Definition of done:** A change to a Rust IPC DTO / command / error variant produces exactly one TS compile error (the consumer). All command/event/route/flag/sidebar/model-ID keys live in one registry each. Generated-binding CI gate clean.

**Risk:** Medium — touches every IPC call. Do it in one branch with codemods.

---

## Phase 3-safety — Backend correctness before decomposition 🟠

**Objective:** Fix lifecycle, state ownership, and migration risks **before** splitting any files.

### 3-safety.1 DB migration framework (was 3.4) — ✅ **DONE (wave 15; decomposed wave 17)**

- Unify `IndexDb` + `TaskDb` migration runners behind a `Migrator` trait in `core::utils::sqlite`. — ✅ Shared framework landed as `tracepilot_core::utils::migrator` (`Migration`, `MigrationPlan`, `MigratorOptions`, `MigrationReport`, `MigrationError`, `run_migrations`). Both `IndexDb` (`INDEX_DB_PLAN`, 11 migrations) and `TaskDb` (`TASK_DB_PLAN`, 2 migrations) now delegate. **Wave 17:** split monolithic `utils/migrator.rs` (710 LOC → file-size-budget violation) into `utils/migrator/{mod,types,backup,schema,tests}.rs`; all public paths (`tracepilot_core::utils::migrator::Migration`, `MigrationPlan`, `MigratorOptions`, `MigrationError`, `MigrationReport`, `RestoreOutcome`, `ensure_schema_version_table`, `backup_path_for`, `run_migrations`) preserved via re-exports — zero consumer edits.
- Standardise on a single `schema_version` table (migrate `TaskDb` away from key-value `task_meta` versioning). — ✅ Canonical `schema_version(version INTEGER NOT NULL, applied_at TEXT DEFAULT (datetime('now')))`. Legacy `TaskDb` installs are **dual-read**: `bootstrap_legacy_schema_version` back-fills rows from `task_meta.schema_version` without re-running migrations. `task_meta` is preserved for backwards-read compatibility.
- Add backup-before-migrate (`{db}.pre-vN.bak`) + rollback-on-failure. — ✅ Backups use `rusqlite::backup::Backup` (WAL-safe), write per applied version, cap retention at the last 5 files, and are skipped for in-memory databases. Each migration runs under an `unchecked_transaction`; a body failure auto-rolls the DB back and preserves the matching backup for manual recovery.
- Document migration policy ADR: forward-only; schema additions allowed; column removals require two-phase; breaking changes require user-data export step. — ✅ [`docs/adr/0004-db-migration-policy.md`](./adr/0004-db-migration-policy.md).

### 3-safety.2 Path + process helpers (was 3.5) — 🟡 **PARTIAL (wave 17)**

- ✅ **Promote `CREATE_NO_WINDOW` to `core::constants`** — shipped in wave 15 as `tracepilot_core::constants::CREATE_NO_WINDOW = 0x0800_0000`. All six callsites use the constant (verified wave 17: `bridge/manager.rs:877` via `crate::process::CREATE_NO_WINDOW` re-export, `bridge/discovery.rs:67`, `mcp/health.rs:504`, `process.rs` multiple, `commands/tasks.rs:698`). No raw `0x08000000` literals remain in the workspace.
- ✅ **Centralise `which`/`where` probing in `process::find_executable`** — added in wave 17. Windows path uses `where.exe` with `CREATE_NO_WINDOW`; non-Windows uses `which`. Returns `Option<PathBuf>`. Covered by three tests: missing-executable returns `None`; Windows locates `cmd`; POSIX locates `sh`.
- 🟡 **Replace inline `Command::new` in `bridge/manager.rs:807-840` and `bridge/discovery.rs`** — `bridge/manager.rs::launch_ui_server` (original lines 869-910) migrated to `crate::process::find_executable(DEFAULT_CLI_COMMAND)` in wave 17. `bridge/discovery.rs` does **not** probe for executables — its `Command::new` calls spawn PowerShell (Win), `ps`+`lsof` (macOS), and `ps`+`ss` (Linux) for *process enumeration*, which is out of scope for `find_executable`. No action taken there.
- 🔴 **Formalise jail helpers in `core::utils::fs`** — **deferred.** Rationale: `canonicalize_user_path` already exists in `tracepilot-orchestrator::launcher` and `validate_path_within` in `tracepilot-tauri-bindings::helpers`, and both bake in crate-specific error types (`OrchestratorError`, `ExportError`, etc.). Moving them to `core::utils::fs` requires a new shared error taxonomy or generic error-conversion story, and there are 20+ `canonicalize` callsites across `orchestrator`, `tauri-bindings`, `export`, and `core` with non-uniform symlink policies (some follow, some reject). Per this plan's scope-management guidance for ambiguous consolidations, this is deferred to a dedicated wave — policy decision required (which error type; whether to enforce a single symlink policy; whether 1A.2's `canonicalize_user_path` should absorb the tauri-bindings `validate_path_within` semantics). The symlink policy is already documented in ADR 0003 §"Symlink policy".

### 3-safety.3 Concurrency cleanups (was 3.8)

- `SharedTaskDb`: **`ArcSwapOption<TaskDb>`** (not `OnceCell`) — `factory_reset` wipes the handle at runtime.
- `TracePilotConfig`: `RwLock<TracePilotConfig>` with read-mostly discipline; writes go through `config_cmds.rs`.
- `SharedOrchestratorState`: keep `RwLock<OrchestratorRuntimeState>` (restartable).
- Audit `commands/tasks.rs:52-95`: release the `SharedOrchestratorState` lock before any FS/IO call.
- Audit `bridge/manager.rs` RwLock usage: read-only ops must `.read()`, not `.write()`.
- Add listener-leak regression test (long-running event loop; assert no task count growth after N window cycles).

### 3-safety.4 Polling / visibility discipline

- Add `usePolling(fn, intervalMs)` composable that gates on `document.hidden` + `useIntersectionObserver` for in-view components.
- Migrate `SessionSearchView.vue:214-226` and `orchestrator.ts:185-191` polling loops.
- Document as a convention; Biome lint to flag raw `setInterval` outside composables.

**Wave 18 (Phase 3-safety.4) — DONE.**

- Added `packages/ui/src/composables/usePolling.ts` — visibility + scope-aware
  polling with single-flight guard, optional `active` ref, and
  `onScopeDispose` cleanup so it works in both component scopes and Pinia
  setup-store scopes.
- Tests: `packages/ui/src/__tests__/usePolling.test.ts` (14 cases).
- Migrated callsites:
  - `apps/desktop/src/views/SessionSearchView.vue:37,216,226` →
    `usePolling(() => store.fetchHealth(), { intervalMs: 5_000, immediate:
    false, pauseWhenHidden: true, swallowErrors: true })`, started in
    `onMounted`, stopped in `onUnmounted`.
  - `apps/desktop/src/stores/orchestrator.ts:47,185-191` → two
    `usePolling` instances (fast / slow) backing the existing imperative
    `startPolling(intervalMs)` / `stopPolling()` surface used by the
    `watch(isRunning, …)` state machine and tests. Chose option (a) —
    `usePolling` uses `getCurrentScope()` + `onScopeDispose` so it binds
    to the Pinia setup-store's effect scope instead of leaking a silent
    component-lifecycle assumption.
- **DEFERRED:** Biome lint rule for raw `setInterval` outside composables.
  Biome does not currently ship a stock rule for this pattern; custom
  restricted-syntax/ESLint-style rules would require either a plugin or a
  separate lint step. Tracking as a future follow-up.

### 3-safety.5 Shared test-support crate — ✅ DONE (wave 19, PARTIAL scope)

- New `crates/tracepilot-test-support` (`publish = false`, consumed from `[dev-dependencies]`) created with a `fixtures` module.
- **Consumers now depending on `tracepilot-test-support`:**
  - `tracepilot-core` (dev-dep) — `src/summary/mod.rs` tests.
  - `tracepilot-export` (dev-dep) — `tests/integration.rs`.
- **Helpers extracted to `tracepilot_test_support::fixtures`:**
  - `full_workspace_yaml()` — was duplicated in `core/summary/mod.rs` and `export/tests/integration.rs`.
  - `minimal_workspace_yaml()` — same pair.
  - `sparse_workspace_yaml()` — was only in `core/summary`, now shareable.
  - `sample_events_jsonl()` — was duplicated verbatim across the same pair.
  - `enrichment_events_jsonl()` — was only in `core/summary`, now shareable.
  - `create_checkpoints(&Path)` — was duplicated (slightly divergent content) across the same pair; unified on the richer export variant (core tests only assert count/existence).
  - `create_full_session(&Path)` — was only in `export/tests/integration.rs`, promoted so future crates can reuse.
- **Helpers deliberately left local (one-off, not cross-crate duplicates):**
  - `crates/tracepilot-core/src/analytics/test_helpers.rs` — `pub(super)` helpers (`make_input`, `make_input_with_code`, `make_tool_call`, `make_turn_with_tools`) used only inside the analytics test modules; they reference the crate-private `SessionAnalyticsInput` type which is not part of any public API.
  - `crates/tracepilot-core/src/turns/tests/builders.rs` — single-consumer builders for the turns aggregator test suite only; no other crate references them.
  - `crates/tracepilot-export/src/test_helpers.rs` (`test_archive`, `minimal_session`, `simple_turn`, `simple_tool_call`) — gated behind `#[cfg(test)]`, used across 10 test modules but all inside `tracepilot-export`; extracting would introduce a dev-dep cycle with the host crate for no current caller benefit. Can be promoted later if a second consumer appears.
- **Scope call (per wave brief):** the repo had 4 true cross-crate fixture duplicates, so the small-wave scaffold path was taken. The crate is live and ready for future helper promotions.


**Definition of done:** Migration fixtures pass on Windows + Linux; no `Mutex<Option<T>>` lazy-init idiom in async paths; locks held ≤ one IO call; polling respects tab visibility; zero listener leaks across 100 window cycles in the regression test.

**Risk:** Medium — careful migration. Ship as several small PRs; `ArcSwapOption` swap can be staged behind a feature flag.

---

## Phase 2 — Helper adoption sweep (frontend) 🟠

**Objective:** Use what exists. Zero new abstractions. Helper use must be **enforced by lint**, not just encouraged.

### 2.1 Store error handling — ✅ DONE (wave 7)

- Mass-migrated try/catch-to-`runAction`/`runMutation` across 9 stores: **40 functions migrated, 28 deliberately left as-is** (non-mechanical catches: `logWarn`/`logError` side-effects, `allSettledRecord` flows, in-flight dedup promises, mixed success-null/error-null returns like `skills::getSkill`/`presets::getPreset`/`tasks::getTask`). Net ~-90 lines.
- Stores covered: `worktrees.ts` (10/14), `mcp.ts` (10/10), `tasks.ts` (3/8), `configInjector.ts` (5/8), `launcher.ts` (4/5 — `initialize` intentionally skipped), `presets.ts` (3/4), `sessions.ts` (0/3 — all dedup/log cases), `orchestrator.ts` (0/2 — logWarn cases), `sdk.ts` (5/13 — rest have logWarn + extra state mutations).
- `search.ts` and `orchestrationHome.ts` were correctly excluded up-front (non-standard error targets / complex guard-token threading).
- Codemod script **not** checked in — migration was one-shot and the remaining non-mechanical cases don't benefit from a script.
- **Custom Biome rule** banning raw `try/catch` with `toErrorMessage` inside store actions — **deferred**. The remaining un-migrated sites legitimately need manual catches, so a blanket rule would produce noise. A better future gate is a unit test asserting no *new* stores drift below a call-site-count threshold, but that's not worth building now.

### 2.2 Composable adoption — 🟡 PARTIAL (wave 9)

- `useInflightPromise<T>()` ✅ landed in `@tracepilot/ui/composables` (wave 9) + 4 vitest cases. Adopted in `stores/sessions.ts` for all 3 manual dedup slots (`fetchPromise`, `indexingPromise`, `postIndexRefreshPromise`).
- `usePersistedRef<T>(key, default, options?)` ✅ landed in `@tracepilot/ui/composables` (wave 9) + 5 vitest cases. Adopted in `stores/alerts.ts` (slice-cap preserved via custom serializer). Left as-is (by design): `sdk.ts` (persists object, exposes separate refs), `sessionTabs.ts` (same pattern), `preferences.ts` (has versioned/legacy key migration + write-through theme cache + mostly backed by `config.toml` not localStorage).
- `useAsyncData` (existing `apps/desktop/src/composables/useAsyncData.ts`): sweep of ~13 `ref<T[]>([]) + loading + error` trios — **WONTFIX (wave 12b triage, 0/13 migrated)**. Every candidate store was triaged and found to already own at least one disqualifying pattern: `runAction`/`runMutation` sharing `loading`/`error` across multiple mutations (`skills`, `presets`, `mcp`, `worktrees`), multi-fetch `allSettledRecord` initialize with aggregated errors (`launcher`, `configInjector`, `orchestrationHome`), module-level promise dedup or `useInflightPromise` (`tasks`, `sessions`), stale-while-revalidate caching (`orchestrationHome`), or complex polling/event-driven state (`orchestrator`, `sdk`, `search`, `alertWatcher`). `useAsyncData` owns its own `loading`/`error` and writes `data.value = result` in one shot, which would break every candidate. The composable remains available for any future store that is a clean trio; no existing store qualifies.
- Convert `useAlertWatcher` from module-level mutable state to a Pinia store: ✅ DONE (wave 12a). Module-level Sets/Maps + in-flight flags + captured route migrated to `stores/alertWatcher.ts` (setup store with closure-owned Sets/Maps to preserve non-reactive membership semantics + `$reset()`). Composable is behaviour-identical; all dedup reads/writes go through the store. New file: `src/stores/__tests__/alertWatcher.test.ts` (12 cases covering running transitions, ask_user dedup, error baseline skip-first, prune, and `$reset`). Desktop test count: 1221 → 1233.
- Wrap `App.vue:59,74` dynamic imports via `useWindowLifecycle.ts`: **WONTFIX this phase** — trivial inline pattern; the lifecycle helper (shipped in wave 1A.7) already serves its primary purpose elsewhere.

### 2.3 Shared-component adoption

Revised list (audit overstated gap; these are the *actual* remaining adoption gaps):

- `PageShell` — adopt in remaining ~12 views that still use hand-rolled `.page-content > .page-content-inner`.
- `StatCard` — adopt in ~4 remaining views with hand-rolled `.stat-card`.
- `TabNav` — adopt in `ConfigInjectorView`, `TaskDetailView`, `McpServerDetailView`, `ExportView` (already used by `SessionDetailPanel`).
- `SegmentedControl`, `FilterSelect`, `SearchInput` — adopt in `PresetManagerView`.
- `PageHeader` — adopt in `PresetManagerView`, `OrchestratorMonitorView`, `SessionLauncherView`, `ConfigInjectorView`.
- CSS lint rule flags new usage of raw `.page-content` / `.stat-card` classes.

**Wave 10 status (2026-04): PARTIAL. Wave 11 (2026-04): shared components extended with parity-preserving variants, adoption sweeps complete.**

| Component | Adopted (W10+W11) | Skipped | Notes |
|---|---:|---:|---|
| `PageShell` | 13 | 3 | Skipped `ConfigInjectorView` (local `.page-content` padding override), `SessionListView` (template ref on outer wrapper drives drift animation), `McpServerDetailView` / `ExportView` not in scope (PageShell already wraps). |
| `StatCard` | 3 | 1 | **Wave 11:** added `variant="plain"`, `accentColor`, `customValueClass`, `labelStyle="uppercase"` props. Adopted in `CodeImpactView` (gradient via `customValueClass`), `AnalyticsDashboardView` (4 incident cards via `variant="plain"` + `accentColor`), `ConfigInjectorView` (4 agent-tab cards via `labelStyle="uppercase"`). Skipped `TaskDashboardView` — already wraps shared StatCard, no hand-rolled cards remain. |
| `TabNav` | 3 | 1 | **Wave 11:** added `icon` field on items, `variant="pill"`, `staggered` prop. Adopted in `ConfigInjectorView` (emoji icons + stagger), `TaskDetailView` (emoji icons + stagger), `ExportView` (pill variant). Skipped `McpServerDetailView` — no tab strip exists. |
| `PageHeader` | 2 | 2 | **Wave 11:** added `inlineSubtitle`, `size="sm"\|"md"\|"lg"` props. Adopted in `PresetManagerView` (icon + actions slots), `SessionLauncherView` (`size="sm"`), `ConfigInjectorView` (`size="sm"`). Skipped `OrchestratorMonitorView` — header wrapped in `fade-section` with bespoke `page-header` layout (flex row, space-between) distinct from shared PageHeader (flex column, gap:10); wrapping in an outer div preserves fade-section but flips header layout, so skipped to avoid visual regression. `TaskDashboardView` already organises its title row via its own component — out of scope. |
| `SegmentedControl` | 1 | 0 | **Wave 11:** added `rounded="square"\|"pill"` prop. Adopted in `PresetManagerView` category pills (`rounded="pill"`). |
| `FilterSelect` | 0 | 1 | `PresetManagerView` uses bespoke `.tag-select` that styles the native `<select>` with custom chevron and height; shared `FilterSelect` has different max-width and border styling. |
| `SearchInput` | 0 | 1 | `PresetManagerView` search box has custom container height/padding/icon placement distinct from shared SearchInput. |

All Wave 11 variants ship with dedicated vitest coverage (StatCard.test.ts +8 cases, TabNav.extended.test.ts +5 cases, new PageHeader.test.ts and SegmentedControl.test.ts). `@tracepilot/ui` test suite: 778 passed (62 files). `@tracepilot/desktop` test suite: 1221 passed (66 files). `pnpm --filter @tracepilot/desktop typecheck` and `node scripts/check-file-sizes.mjs` both clean.

**Definition of done:** Lint rule bans raw try/catch-in-store, raw `setInterval`, raw `.page-content`/`.stat-card` classes, raw storage key strings, raw route-path strings. No module-level mutable state outside Pinia.

**Risk:** Low — mechanical substitutions, Vitest covers stores.

---

## Phase 5.2 — Design tokens into `@tracepilot/ui` ✅ (wave 14)

**Objective:** Make the UI package self-contained before any mega-SFC decomposition uses it.

- ✅ Moved `apps/desktop/src/styles/design-tokens.css` → `packages/ui/src/styles/tokens.css` (byte-identical content after a new doc-comment header).
- ✅ Added subpath export `@tracepilot/ui/tokens.css` in `packages/ui/package.json`.
- ✅ `apps/desktop/src/styles.css` now imports `@tracepilot/ui/tokens.css` directly; the legacy `apps/desktop/src/styles/design-tokens.css` remains as a one-line `@import "@tracepilot/ui/tokens.css";` shim and is scheduled for deletion one release after 0.6.x.
- ✅ Moved JS reader to `packages/ui/src/utils/designTokens.ts`, re-exported from the `@tracepilot/ui` barrel. Hardcoded hex fallbacks (old lines 4–10 of `apps/desktop/src/utils/designTokens.ts`) removed — readers now only read CSS custom properties; `tokens.css` is the single source of truth. `apps/desktop/src/utils/designTokens.ts` is a re-export shim scheduled for deletion one release after 0.6.x.
- ✅ `packages/ui/README.md` documents the CSS-variable contract and consumer import requirements.

**Validation (wave 14):** `pnpm --filter @tracepilot/ui typecheck` clean; `@tracepilot/ui` tests 778 passed (62 files, unchanged); `pnpm --filter @tracepilot/desktop typecheck` clean; `@tracepilot/desktop` tests 1243 passed (69 files, unchanged); `pnpm --filter @tracepilot/desktop build` succeeds (CSS import chain resolves); `node scripts/check-file-sizes.mjs` clean.

**Shim-deprecation timeline:** Both shims (`apps/desktop/src/styles/design-tokens.css`, `apps/desktop/src/utils/designTokens.ts`) are marked LEGACY SHIM and slated for removal one release after 0.6.x.

**Risk:** Medium — visual regressions if variable lists drift. Visual-regression harness from Phase 0 catches them.

---

## Phase 4 — Frontend decomposition 🟡

**Objective:** Break mega-SFCs and mega-stores. Enforced by file-size guard-rails + coupled to behavioural/perf/a11y gates.

### 4.1 Gating requirements (new)

Every decomposition PR must:

1. Pass visual-regression snapshots (Phase 0.9).
2. Pass `@axe-core/playwright` a11y scan on the touched view (no new violations).
3. Include at least one keyboard-navigation + focus-trap test for modals/dialogs.
4. Include template hot-path extraction for identified O(n²) or repeated-filter patterns:
   - `SearchPalette.vue:244-246,315-318` — memo `uniqueSessionCount`.
   - `AgentTreeView.vue:1011-1029` — precompute message filters outside template.
5. Keep or improve render perf (Lighthouse / Playwright trace comparison).

### 4.2 Top mega-SFCs (17 files > 1000 LOC, ordered by ROI)

Each decomposition extracts 3–6 children, moves CSS > 500 LOC to `styles/features/<name>.css`, adds a smoke + key-flow test.

| File | LOC | Target children |
|---|---:|---|
| ~~PresetManagerView.vue~~ ✅ | 2365 | PresetStatsStrip, PresetFilterBar, PresetGrid, PresetList, NewPresetModal, EditPresetModal, DeletePresetConfirm [^wave23] |
| ~~ConfigInjectorView.vue~~ ✅ | 2020 → 101 | ConfigInjectorAgentsTab, ConfigInjectorGlobalTab, ConfigInjectorVersionsTab, ConfigInjectorBackupsTab + `useConfigInjector` + `AGENT_META` registry [^wave28] |
| WorktreeManagerView.vue | ~~1990 → 154~~ ✅ | WorktreeRepoSidebar, WorktreeToolbar, WorktreeList, WorktreeDetailPanel, CreateWorktreeModal, useWorktreeManager [^wave26] |
| ~~AgentTreeView.vue~~ ✅ | 1928 → 30 | AgentTreeToolbar, AgentTreeCanvas, AgentTreeDetailPanel + `useAgentTree` composable + pure `agentTreeLayout` / `agentTreeBuilder` utils [^wave37] |
| ~~SessionLauncherView.vue~~ ✅ | 1855 → 73 | SessionLauncherTemplates, SessionLauncherConfig, SessionLauncherPrompt, SessionLauncherAdvanced, SessionLauncherSaveTemplate, SessionLauncherPreview + `useSessionLauncher` [^wave29] |
| ~~SessionSearchView.vue~~ ✅ | 1734 → 231 | move CSS out; split into SessionSearchHero, SessionSearchIndexingBanner, SessionSearchResultsHeader, SessionSearchPagination + `useSessionSearch` [^wave35] |
| ~~OrchestratorMonitorView.vue~~ ✅ | 1690 → 156 | OrchestratorHeaderBar, OrchestratorStatusHero, OrchestratorStatsGrid, ActiveTasksPanel, ActiveSubagentsPanel, CompletedSubagentsPanel, OrchestratorActivityFeed, OrchestratorHealthPanel, useOrchestratorMonitor [^wave27] |
| ~~SkillEditorView.vue~~ ✅ | 1635 → 57 | SkillEditorTopBar, SkillEditorMetadataForm, SkillEditorMarkdownEditor, SkillEditorPreviewPane, SkillEditorStatusBar, SkillAssetPreviewModal + `useSkillEditor` [^wave36] |
| ~~TaskCreateView.vue~~ ✅ | 1566 → 274 | WizardStep1Preset, WizardStep2Variables, WizardStep3Submit, useTaskWizard [^wave22] |
| ~~ExportView.vue~~ ✅ | 1481 → 47 | ExportTab, ImportTab siblings under PageShell [^wave24] |
| ~~TaskDetailView.vue~~ ✅ | 1441 → 161 | TaskDetailHeader, TaskResultPanel, TaskContextPanel, TaskTimelinePanel, TaskSubagentPanel, TaskRawPanel, useTaskDetail [^wave25] |
| ~~SdkSteeringPanel.vue~~ ✅ | 1364 → ~74 | SdkSteeringSentLog, SdkSteeringSessionLabel, SdkSteeringLinkPrompt, SdkSteeringCommandBar, SdkSteeringDisconnectedCard + `useSdkSteering` composable [^wave38] |
| ~~McpServerDetailView.vue~~ ✅ | 1360 → ~55 | McpServerDetailHeader, McpServerDetailConnection, McpServerDetailMetadata, McpServerDetailActions, McpServerDetailTools, McpServerDetailHealth, useMcpServerDetail [^wave30] |
| ~~SkillImportWizard.vue~~ ✅ | 1350 → 147 | SkillImportStep1Local, SkillImportStep2GitHub, SkillImportStep3File, useSkillImportWizard [^wave31] |
| ~~SessionComparisonView.vue~~ ✅ | 1186 → 30 | ComparisonHeader, ComparisonMetrics, ComparisonCharts, useSessionComparison [^wave32] |
| ~~TodoDependencyGraph.vue~~ ✅ | 1125 → ~113 | useTodoDependencyGraph + todoDepLayout util + TodoDepGraphToolbar, TodoDepGraphNode, TodoDepGraphEdge, TodoDepGraphLegend, TodoDepDetailSlideover [^wave34] |
| ~~ModelComparisonView.vue~~ ✅ | 1120 → ~50 | ModelStatsGrid, ModelLeaderboard, ModelCharts, ModelCompareTable, useModelComparison [^wave33] |

(`TurnWaterfallView`, `NestedSwimlanesView`, `ChatViewMode` from original plan still > 1000 LOC but below top 17 by ROI; included in same pass.)

[^wave22]: Wave 22 — decomposed into `WizardStep1Preset`, `WizardStep2Variables`, `WizardStep3Submit` (under `apps/desktop/src/components/tasks/wizard/`) and the `useTaskWizard` composable (`apps/desktop/src/composables/useTaskWizard.ts`). View-level VRT is not yet available in this repo (Phase 0.9 covers components only), so wave-22 decomposition relied on unit tests for the composable, mount tests for each step (including a keyboard-focus advancement test on the step-1 Next button), and the existing typecheck + build gates in lieu of view-level visual regression. `@axe-core/playwright` is likewise deferred to a future wave. Subsequent wave should back-fill view-level VRT + a11y for the wizard shell before re-decomposing any sibling view.

[^wave26]: Wave 26 — `WorktreeManagerView.vue` (1990 LOC) decomposed into shell (154 LOC) + five children under `apps/desktop/src/components/worktree/` (`WorktreeRepoSidebar`, `WorktreeToolbar`, `WorktreeList`, `WorktreeDetailPanel`, `CreateWorktreeModal`) plus the `useWorktreeManager` composable owning selection/filter/confirm-delete/lock/prune/refresh flows. CSS (~838 LOC) extracted to `apps/desktop/src/styles/features/worktree-manager.css` (unscoped, imported by shell). No polling exists in this view, so `usePolling`/`useAutoRefresh` were not applicable. Tests: `WorktreeChildren.test.ts` (mount + event tests for all five children) and `useWorktreeManager.test.ts` (selection toggle, filter, confirm-abort, navigation, modal open).

[^wave27]: Wave 27 — `OrchestratorMonitorView.vue` (1690 LOC) decomposed into shell (156 LOC) + eight children under `apps/desktop/src/components/tasks/monitor/` (`OrchestratorHeaderBar`, `OrchestratorStatusHero`, `OrchestratorStatsGrid`, `ActiveTasksPanel`, `ActiveSubagentsPanel`, `CompletedSubagentsPanel`, `OrchestratorActivityFeed`, `OrchestratorHealthPanel`) plus the `useOrchestratorMonitor` composable owning the 1-second `now` ticker, manual `useAutoRefresh` (view-side; store owns its own `usePolling` pair), health/hero/uptime derivations, model-picker state, and navigation helpers. CSS (~668 LOC) extracted to `apps/desktop/src/styles/features/orchestrator-monitor.css` (unscoped, imported by shell, namespaced under `.orchestrator-monitor-feature`; teleported model-picker uses prefixed `.orch-monitor-model-overlay` / `.orch-monitor-model-dropdown` classes so the body-level DOM still matches). The store already owned a `usePolling` pair (fast/slow cadence, pause-when-hidden), so view-level polling was NOT introduced — the manual `useAutoRefresh` keeps `enabled: ref(false)` and only drives the RefreshToolbar button, preserving pre-wave behaviour byte-for-byte. Tests: `OrchestratorMonitorChildren.test.ts` (one mount test per child, including header start/stop/refresh/model-select emissions) and `useOrchestratorMonitor.test.ts` (heartbeat color thresholds, state label transitions, elapsed/duration formatters, model-tier grouping).

[^wave28]: Wave 28 — `ConfigInjectorView.vue` (1952 LOC, counted pre-split) decomposed into shell (101 LOC) + four tab children under `apps/desktop/src/components/configInjector/` (`ConfigInjectorAgentsTab`, `ConfigInjectorGlobalTab`, `ConfigInjectorVersionsTab`, `ConfigInjectorBackupsTab`) plus the `useConfigInjector` composable (`apps/desktop/src/composables/useConfigInjector.ts`, 399 LOC) owning auto-save indicator, per-agent model map, global-config edit buffers, migration picker, backup create/preview/confirm-delete flows, and the side-by-side diff derivations. The hand-rolled `AGENT_META` table moved to `apps/desktop/src/components/configInjector/agentMeta.ts` with a frozen registry + `agentMeta(name)` lookup. CSS (~1036 LOC) extracted (unscoped) to `apps/desktop/src/styles/features/config-injector.css` and imported by the shell; child components rely on unscoped class names so no rewiring was needed. The composable exposes its state via a Vue `provide`/`inject` symbol (`ConfigInjectorKey` + `useConfigInjectorContext`) so the four tab children consume a single shared instance without prop-drilling 30+ refs. No polling exists in this view, so `usePolling`/`useAutoRefresh` were not applicable. No modals exist (backup-delete uses the click-twice confirm pattern, no Esc/tab-cycle) so a keyboard-nav test was not required. Tests: `ConfigInjectorChildren.test.ts` (mount tests for all four tabs incl. batch-upgrade click emission) and `useConfigInjector.test.ts` (5 tests: tools collapse limit, folder add/remove + dedupe, `formatBackupLabel` derivation, `syncGlobalFields` hydration, `toggleDeleteBackup` two-click confirm).

[^wave29]: Wave 29 — `SessionLauncherView.vue` (1855 LOC) decomposed into shell (73 LOC) + six children under `apps/desktop/src/components/sessionLauncher/` (`SessionLauncherTemplates`, `SessionLauncherConfig`, `SessionLauncherPrompt`, `SessionLauncherAdvanced`, `SessionLauncherSaveTemplate`, `SessionLauncherPreview`) plus the `useSessionLauncher` composable (`apps/desktop/src/composables/useSessionLauncher.ts`, 469 LOC) owning the launch form state (repo/branch/model/reasoning/prompt/env-vars), saved-template apply/reorder/inline-confirm-delete, `useGitRepository` wiring (fetch-from-remote + default-branch reset + worktree path preview), context-menu state, CLI command derivation, and route-query pre-fill on mount. Context is shared via a `provide`/`inject` symbol (`SessionLauncherKey` + `useSessionLauncherContext`) so children pull refs without prop-drilling. CSS (~990 LOC of scoped styles) extracted (unscoped) to `apps/desktop/src/styles/features/session-launcher.css` and imported by the shell; selectors are namespaced under `.session-launcher-feature` to bound the cascade, and the teleported context menu uses a dedicated `.session-launcher-ctx-menu` prefix so its body-level DOM still matches. No polling exists in this view, so `usePolling`/`useAutoRefresh` were not applicable. No modals exist (the delete flow uses an inline click-twice overlay; save-template uses `useConfirmDialog` which already owns its own Esc/tab semantics) so a dedicated keyboard-nav test was not required. Tests: `SessionLauncherChildren.test.ts` (13 tests — mount + event tests for all six children including template click, reasoning-effort select, prompt binding, advanced-panel toggle, auto-approve toggle, add-env-var, save-template click, launch click, copy-command click) and `useSessionLauncher.test.ts` (7 tests: `tierLabel`, `templateIcon`/`templateDisplayName`, `applyTemplate` apply + toggle-off, `moveTemplate` reorder + bounds, `deleteTemplateInline` two-click confirm, `cliCommandParts` flag derivation, `canLaunch` repo-path + worktree-branch gating). Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave30]: Wave 30 — `McpServerDetailView.vue` (1360 LOC) decomposed into shell (~55 LOC) + six children under `apps/desktop/src/components/mcp/` (`McpServerDetailHeader`, `McpServerDetailConnection`, `McpServerDetailMetadata`, `McpServerDetailActions`, `McpServerDetailTools`, `McpServerDetailHealth`) plus the `useMcpServerDetail` composable (`apps/desktop/src/composables/useMcpServerDetail.ts`, ~280 LOC) owning the route-derived server lookup, health/edit/reveal/expanded-tool UI state, the save/delete/test-connection/export-JSON handlers, and all display derivations (status text/colour/dot class, transport label, tokens formatted, filtered tools search, env/headers entry lists). Context is shared via a `provide`/`inject` symbol (`McpServerDetailKey` + `useMcpServerDetailContext`) so children pull refs without prop-drilling. CSS (~820 LOC of scoped styles) extracted to `apps/desktop/src/styles/features/mcp-server-detail.css` with every selector re-scoped under the `.mcp-detail-view` root ancestor (which the shell still owns) to preserve the original `scoped` cascade boundary. No polling exists in this view (no `watch` either — `onMounted` runs a single `loadServers()` call when the list is empty), so `usePolling`/`useAutoRefresh` were not applicable. No modals exist (delete/save are inline actions with disabled-button feedback) so a keyboard-nav test was not required. Tests: `McpServerDetailChildren.test.ts` (mount + event tests for all six children incl. back-click, edit-mode toggle, env-reveal toggle, tool-expand toggle, health-check/export/delete click emission) and `useMcpServerDetail.test.ts` (5 tests: `statusText`/`statusColor`/`statusDotClass` derivation across healthy/unreachable/unknown, `tokensFormatted` boundary, `filteredTools` search, `toggleReveal` idempotency, `handleSave` rename rollback when old-entry removal fails). Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave31]: Wave 31 — `SkillImportWizard.vue` (1350 LOC) decomposed into shell (147 LOC) + three tab children under `apps/desktop/src/components/skills/import-wizard/` (`SkillImportStep1Local`, `SkillImportStep2GitHub`, `SkillImportStep3File`) plus the `useSkillImportWizard` composable (`apps/desktop/src/composables/useSkillImportWizard.ts`, ~450 LOC) owning the tab state, target-scope select, per-source scan flow (local directory probe / GitHub tree scan with cancel controller / file-path browse), selection Sets for the two preview lists, `parseGhUrl` regex parsing, the unified `doImport` progress loop (per-item status + current/total counters for both local and GitHub multi-imports), the single-shot fallback paths when no preview is showing, and the `browseForFile`/`browseForDirectory` + quick-select repo wiring. The composable wraps its return in `reactive(...)` (matching the wave-22 `useTaskWizard` pattern) and is shared with children via a `provide`/`inject` symbol (`SkillImportWizardKey` + `useSkillImportWizardContext`) so each tab child calls `useSkillImportWizardContext()` without any prop-drilling. CSS (~680 LOC of scoped styles) extracted to `apps/desktop/src/styles/features/skill-import-wizard.css` with every selector re-scoped under the `.skill-import-wizard-root` ancestor owned by the shell `.wizard-overlay` div, and the two keyframes renamed (`panelFadeIn` → `skillImportPanelFadeIn`, `spin` → `skillImportSpin`) to avoid global collisions. The shell adds a `window` `keydown` listener so `Escape` emits `close` (wave-31 keyboard-nav requirement); the wizard's public contract (props: none; emits: `close`, `imported`) is unchanged so `SkillsManagerView` required no edits. No polling exists in this modal, so `usePolling`/`useAutoRefresh` were not applicable. Tests: `SkillImportChildren.test.ts` (9 tests — mount + event tests for all three tab children incl. scan click on Local, Enter-to-scan keyboard path on GitHub, Cancel-while-scanning on GitHub, drop-zone click + manual-path binding on File, plus two shell-level tests: Escape-closes keyboard-nav and cancel-button close) and `useSkillImportWizard.test.ts` (11 tests: default state, `canImport` across all three tabs, `scanLocal` populates+auto-selects, `scanLocal` error surface, toggle single/all local, `scanGitHub` URL parsing for full URLs, `scanGitHub` parse-error path, `doImport` single-file flow with store invocation, `finish` emits `onImported`+`onClose`, `browseFile` path capture, `onSelectRepo` writes `localDir`). Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave32]: Wave 32 — `SessionComparisonView.vue` (1186 LOC) decomposed into shell (30 LOC) + three children under `apps/desktop/src/components/sessionComparison/` (`ComparisonHeader`, `ComparisonMetrics`, `ComparisonCharts`) plus the `useSessionComparison` composable (`apps/desktop/src/composables/useSessionComparison.ts`, ~395 LOC) owning the A/B selection state, loading/error/compared flags, the `SessionData` pair, the `onMounted` session-list prefetch, the `runComparison` `Promise.all` fetch (`getSessionDetail` + `getShutdownMetrics` + `getSessionTurns` per side), and every derived view model (10-row `metricsRows` with raw/per-turn/per-minute normalization, `tokenBars` with optional cache row, donut-A/donut-B model-distribution segments, `toolCompRows` merged tool-count table, per-side `waveA`/`waveB` message-length normalization, per-side `timelineA`/`timelineB` duration-proportional blocks). Pure helpers `donutSegments`, `sessionLabel`, `exitBadgeVariant`, `exitLabel` are exported from the composable module so the children import them directly; the composable wraps its return in `reactive(...)` (matching wave 31) and is shared via a `provide`/`inject` symbol (`SessionComparisonKey` + `useSessionComparisonContext`). CSS (~495 LOC of scoped styles) extracted (unscoped) to `apps/desktop/src/styles/features/session-comparison.css` and imported by the shell; every selector is namespaced under `.session-comparison-feature` (applied to the shell's inner div inside `PageShell`) to bound the cascade — matching the wave-29 session-launcher pattern. No polling exists in this view (`onMounted` runs a single `fetchSessions()` call when the list is empty), so `usePolling`/`useAutoRefresh` were not applicable. No modals exist, so a keyboard-nav test was not required. Tests: `ComparisonChildren.test.ts` (7 tests — mount + interaction tests for all three children: header renders empty-state / invokes `runComparison` on Compare click / renders summary cards when `compared=true`; metrics renders rows + toggles `normMode` + renders token-bars + tool-usage empty state; charts renders waveform + timeline blocks + empty state) and `useSessionComparison.test.ts` (9 tests: default state + empty computed collections, `canCompare` gating on selections + loading, `runComparison` success path + both-side fetches, `runComparison` error surface, `metricsRows` length = 10 once compared, `sessionLabel` / `exitBadgeVariant` / `exitLabel` / `donutSegments` helpers). Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave33]: Wave 33 — `ModelComparisonView.vue` (1120 LOC) decomposed into shell (~50 LOC) + four children under `apps/desktop/src/components/modelComparison/` (`ModelStatsGrid`, `ModelLeaderboard`, `ModelCharts`, `ModelCompareTable`) plus the `useModelComparison` composable (`apps/desktop/src/composables/useModelComparison.ts`, ~420 LOC) owning the `useAnalyticsPage("fetchAnalytics")` wiring, enriched `modelRows` (percentage share / cacheHitRate / wholesale + copilot cost per row), totals, cost/norm toggles (`wholesale`/`copilot`/`both` × `raw`/`per-10m-tokens`/`share`), `bestCacheIdx`/`bestCostIdx`/`bestCopilotCostIdx` highlights, sort state + `sortedRows` + `sortArrow`, `displayRows` (raw/per-10M/share modes), `fmtNorm` formatter, all radar-chart geometry helpers (`radarModels` top-3, `radarValues`, `radarPoint`, `radarPolygon`, `radarAxisEnd`, `radarLabelPos` + exported `RADAR_CX`/`RADAR_CY`/`RADAR_R`/`RADAR_AXES` constants), scatter-plot scale + helpers (`scatterScale`/`scatterX`/`scatterY`/`scatterRadius` + exported `SCATTER_W`/`SCATTER_H`/`SCATTER_PAD` constants), and side-by-side `compareA`/`compareB` selection (including the `watch(modelRows, …, { immediate: true })` auto-seed of the two dropdowns) plus the 9-row `compareMetrics` built via `formatModelDelta`. The composable wraps its return in `reactive(...)` (matching waves 31–32) and is shared via a `provide`/`inject` symbol (`ModelComparisonKey` + `useModelComparisonContext`); the shell only calls `useModelComparison()` + `provide(...)` and dispatches to children behind the same `LoadingOverlay`/`ErrorState`/`EmptyState` gating the original view used. CSS (~325 LOC of scoped styles) extracted (unscoped) to `apps/desktop/src/styles/features/model-comparison.css` and imported by the shell; every selector is namespaced under `.model-comparison-feature` (applied to the shell's inner div inside `PageShell`) to bound the cascade — matching the wave-29/32 pattern. No polling exists in this view (fetches are driven by `useAnalyticsPage` `onMounted` + watcher on selectedRepo/dateRange), so `usePolling`/`useAutoRefresh` were not applicable. No modals exist, so a keyboard-nav test was not required. Tests: `ModelComparisonChildren.test.ts` (7 tests — mount + interaction tests for all four children: stats grid renders cards and one card per model; leaderboard renders table rows, toggles `costMode` and invokes `toggleSort` on header click; charts shows radar placeholder with <2 models and renders both SVGs when data is sufficient; compare table shows placeholder with <2 rows, renders `compareMetrics` rows, and toggles `normMode` via the Share % button) and `useModelComparison.test.ts` (9 tests: default state + empty rows, `modelRows` derives percentage/cacheHitRate/copilotCost, `toggleSort` flips/asc-resets, `sortArrow` states, `displayRows` switches raw/share/per-10m-tokens, `fmtNorm` per-mode formatting, `compareA`/`compareB` auto-seeded by the rows watcher + `compareMetrics` length = 9, radar + scatter helpers produce valid coordinates, `pageSubtitle` reflects `selectedRepo`). Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave34]: Wave 34 — `TodoDependencyGraph.vue` (1125 LOC) decomposed into shell (~113 LOC) + five children under `apps/desktop/src/components/todoDependencyGraph/` (`TodoDepGraphToolbar`, `TodoDepGraphNode`, `TodoDepGraphEdge`, `TodoDepGraphLegend`, `TodoDepDetailSlideover`) plus a shared `constants.ts` (`STATUSES`, `STATUS_ICON`, `STATUS_LABEL`, `StatusColor`), a pure layout util at `apps/desktop/src/utils/todoDepLayout.ts` (~185 LOC: `computeLayout` running Kahn's topological sort + chunked sub-row placement with cycle detection, `computeViewBox`, `computeEdgePaths` building cubic-Bezier `d` strings with a horizontal-offset last control point so arrow tangents track approach angle, plus exported `DEFAULT_LAYOUT_CONSTANTS`), and the `useTodoDependencyGraph` composable (`apps/desktop/src/composables/useTodoDependencyGraph.ts`, ~453 LOC) owning status-color derivation from design tokens, the activeStatuses Set + `statusCount`/`toggleStatus` (min-1-active invariant) + `pendingFitFromFilter` guard, the filteredTodos / edges / searchMatchIds / layoutResult / viewBox / edgePaths (with per-target-status color) derivations, selection+hover refs + `nodeClass`/`edgeClass`/`edgeOpacity` highlighting helpers (hover overrides selection, search overrides both), the pan/zoom state (`panX`/`panY`/`zoomLevel` + `onPanStart`/`onWheel`/`zoomIn`/`zoomOut`/`fitToView` with ZOOM_MIN=0.05/ZOOM_MAX=5.0/FIT_PADDING=0.9 constants), the `onMounted` auto-fit + ResizeObserver for hidden→visible-tab transitions, the `onUnmounted` cleanup of window `pointermove`/`pointerup` listeners, and the watchers that clear selection/hover when nodes disappear and re-fit only on explicit filter toggles. Context is shared via a `provide`/`inject` symbol (`TodoDependencyGraphKey` + `useTodoDependencyGraphContext`); the composable returns a plain object (no `reactive` wrap) because children read refs directly (`ctx.statusColor.value`, etc.) and the shell passes prop refs via `toRef`. CSS (~350 LOC of scoped styles) extracted (unscoped) to `apps/desktop/src/styles/features/todo-dependency-graph.css` with every selector namespaced under `.todo-graph-root` (the shell's outer container) to bound the cascade, and the `fadeIn` keyframe renamed to `todoDepFadeIn` to avoid global collisions. The public contract (`{ todos: TodoItem[]; deps: TodoDep[] }` props; no emits) is unchanged, so `TodosTab` and its test required no edits. No polling, no modals — not applicable. Tests: `todoDepLayout.test.ts` (7 tests: root level-0 + strictly increasing y along edges, cycle detection with `hasCycle=true` and all todos placed, `maxPerRow=5` chunks wide levels into stacked sub-rows, empty-viewbox default, viewbox padding encloses nodes, edge paths skipped when endpoints missing, edge `d` attribute shape + stable `edge-N` id); `useTodoDependencyGraph.test.ts` (4 tests: `filteredTodos` + toggle min-1-active invariant, case-insensitive search matching across title/description/id, `onNodeClick` select-toggle + `closeDetail` clear, edge filtering when endpoint hidden + layout omits hidden nodes); `TodoDependencyGraphChildren.test.ts` (5 tests: toolbar renders per-status chips + counts, node renders `<g class="dag-node">` with title text, edge renders `<path>` with provided stroke + marker-end, legend renders four swatches + direction hint, detail slideover renders when selected and unmounts after close-button click). Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave35]: Wave 35 — `SessionSearchView.vue` (1734 LOC) decomposed into shell (231 LOC) + four new children under `apps/desktop/src/components/search/` (`SessionSearchHero`, `SessionSearchIndexingBanner`, `SessionSearchResultsHeader`, `SessionSearchPagination`) alongside the pre-existing `SearchActiveFilters`/`SearchBrowsePresets`/`SearchFilterSidebar`/`SearchGroupedResults`/`SearchResultCard`/`SearchSyntaxHelpModal` children, plus the `useSessionSearch` composable (`apps/desktop/src/composables/useSessionSearch.ts`, ~230 LOC) owning the view-local indexing progress refs (`indexingProgress`/`isIndexing`), the `usePolling` health-refresh loop originally added in wave 18 (interval 5_000ms, immediate=false, pauseWhenHidden=true, swallowErrors=true — started in `onMounted` and stopped in `onUnmounted`), the `useIndexingEvents` setup, the `useSearchUrlSync` / `useSearchResultState` / `useSearchKeyboardNavigation` / `useSearchPagination` wiring (now internal to the composable so the shell doesn't have to re-plumb them), the copy-to-clipboard toast helpers (`handleCopyResult` / `handleCopyAllResults` with single-toast dismiss behaviour), `activeFilterCount` / `activeContentTypeChips` / `statsContentTypeFacets` / `friendlyError` computed derivations, the `removeContentTypeFilter` tri-state helper and `handleClearFilters` (which also resets the local `activeDatePreset` and clears `filteredSessionNameOverride`), and the pure `sessionLink(sessionId, turnNumber, eventIndex)` URL builder. The composable takes a `searchInputRef: Ref<HTMLInputElement | null>` option so the keyboard-nav hook (Ctrl+K focus) can target the input element that now lives inside the `SessionSearchHero` child — the shell wires this up via `heroRef.value?.inputRef` through a `computed` ref, and the hero exposes its inner input via `defineExpose({ inputRef })`. CSS (1011 LOC of scoped styles, including the `:deep(mark)` / `:deep(code)` result-snippet overrides which were unwrapped to plain descendant selectors since the stylesheet is now global) extracted to `apps/desktop/src/styles/features/session-search.css` and imported by the shell. The wave-18 `usePolling` migration was preserved byte-for-byte — same interval, same options, same lifecycle hooks — only its ownership moved from the view's `<script setup>` into the composable. Public contract unchanged (no props/emits on the view). Tests: `SessionSearchChildren.test.ts` (8 tests — mount + event tests for all four new children: hero emits `update:query` on input + shows filter-count badge when > 0; indexing banner hides when idle + renders progress fraction when indexing; results header totals + emits `update:resultViewMode` on grouped-button click + "No results found" when empty; pagination hides when `totalPages <= 1` + emits `prev`/`next`/`go` for each button type) and `useSessionSearch.test.ts` (5 tests: `activeFilterCount` sums content-type + repository + sessionId filters, `activeContentTypeChips` combines include/exclude lists, `removeContentTypeFilter` clears both include and exclude entries, `sessionLink` builds canonical URLs with optional turn/event params, `handleClearFilters` delegates to store + resets `activeDatePreset` to `"all"`). Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave36]: Wave 36 — `SkillEditorView.vue` (1635 LOC) decomposed into shell (~57 LOC) + six children under `apps/desktop/src/components/skillEditor/` (`SkillEditorTopBar`, `SkillEditorMetadataForm`, `SkillEditorMarkdownEditor`, `SkillEditorPreviewPane`, `SkillEditorStatusBar`, `SkillAssetPreviewModal`) plus the `useSkillEditor` composable (`apps/desktop/src/composables/useSkillEditor.ts`, ~373 LOC) owning the route-derived `skillDir`, the load/parse/serialize lifecycle (`loadSkill`/`parseContent`/`rebuildRawContent`), the form state (`rawContent`/`previewFrontmatter`/`previewBody`/`editorDirty`/`lastSaved`/`saving`/`deleting`), the asset state + actions (`assets`/`assetsLoading`/`handleAddAsset`/`handleNewFile`/`handleRemoveAsset`/`handleViewAsset` + asset-preview modal refs `viewingAsset`/`viewingContent` + `closeAssetPreview`), the markdown toolbar inserters (`insertBold`/`insertItalic`/`insertH1`/`insertH2`/`insertBulletList`/`insertCode`/`insertLink` all delegating to `insertMarkdown` with the preserved selection-preserving logic), the `useResizeHandle` wrapper (re-exported as `leftWidth`/`dragging`/`containerRef`/`onMouseDown` with the original 25/75/50 percentages), the document-level `Ctrl+S`/`Cmd+S` keydown listener (registered in `onMounted`, removed in `onUnmounted`) that triggers `handleSave` only when dirty + not already saving, the `handlePreviewClick` / `handlePreviewLinkClick` delegation for relative-path asset link clicks inside the rendered markdown, and the display helpers (`editorLineNumbers`/`totalLineCount`/`byteCount`/`descCharCount`/`descCharClass`/`lastSavedDisplay`/`formatSize`/`syncScroll`). The composable wraps its return in `reactive(...)` (matching waves 31–35) and is shared with children via a `provide`/`inject` symbol (`SkillEditorKey` + `useSkillEditorContext`) so each child reads state directly (`ctx.previewFrontmatter`, `ctx.store.selectedSkill`, etc.) without prop-drilling. The markdown-editor child forwards its `<textarea>` + line-numbers element refs onto the composable via function-ref callbacks (`ctx.editorRef = el` / `ctx.lineNumbersRef = el`) so the toolbar inserters' selection/scroll preservation still targets the real DOM node after extraction. CSS (~1053 LOC of scoped styles, including `:deep(h1)`/`:deep(h2)`/`:deep(ul)`/`:deep(ol)`/`:deep(li)`/`:deep(code)`/`:deep(pre)`/`:deep(pre code)`/`:deep(p)`/`:deep(a)`/`:deep(a:hover)` markdown-content overrides which were unwrapped to plain descendant selectors since the stylesheet is no longer scoped) extracted to `apps/desktop/src/styles/features/skill-editor.css` with every selector namespaced under `.skill-editor-feature` (applied to the shell's outer wrapper div so the cascade is bounded) — matching the wave-29/32/33 pattern. The shell still owns the `.editor-shell` flex root, the top-level `error-bar`/`state-message` branches, and the central resize-body grid (`leftWidth% 5px 1fr`) so the left panel (metadata + markdown editor) and right panel (preview + assets) keep their original positions. No polling exists in this view (a single `onMounted` + `watch(skillDir)` drives loads), so `usePolling`/`useAutoRefresh` were not applicable. The asset-preview modal has no Escape handler in the original (close is overlay-click + ✕-button), so that behaviour was preserved byte-for-byte — keyboard-nav coverage is instead satisfied by the Ctrl+S handler test in `useSkillEditor.test.ts`. The public route-entry contract (no props/emits on the view; route-param `name` decoded into `skillDir`) is unchanged, so `router/index.ts` and `SkillsManagerView` required no edits. Tests: `SkillEditorChildren.test.ts` (12 tests — mount + event tests for all six children: topbar renders skill name + invokes `goBack` + toggles save-button disabled on dirty + invokes `handleSave` on click; metadata form binds name/description inputs + fires `onNameInput`/`onDescInput` + applies char-count class; markdown editor toolbar buttons dispatch `insertBold`/`insertItalic`/`insertLink` + textarea bound to `previewBody` fires `onBodyInput`; preview pane renders frontmatter name + `MarkdownContent` stub + assets tree + delegates clicks to `handlePreviewClick`; status bar shows `directory/SKILL.md` + `lastSavedDisplay` + line count; asset-preview modal hidden when `viewingAsset` null, renders name+content when set, fires `closeAssetPreview` on ✕-click, shows "Unable to read file content" fallback when `viewingContent` is null) and `useSkillEditor.test.ts` (10 tests: `skillDir` url-decode, `loadSkill` fetches skill + parses frontmatter + lists assets + clears dirty, `handleSave` calls store + stamps `lastSaved` + clears dirty, `onNameInput` rebuilds raw + marks dirty, `Ctrl+S` keydown triggers save only when dirty, `handleDiscard` reload only when dirty + confirmed, `handleDelete` routes to skills-manager on success, `descCharClass` thresholds across `""`/`"near-limit"`/`"at-limit"`, `formatSize` across B/KB/MB ranges, `useSkillEditorContext` throws when not provided). Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave37]: Wave 37 — `AgentTreeView.vue` (1928 LOC) decomposed into shell (30 LOC) + three children under `apps/desktop/src/components/agentTree/` (`AgentTreeToolbar` ~64 LOC for view-header spacer + turn-nav (Earliest/Prev/Next/Latest) + Paginated/Unified toggle; `AgentTreeCanvas` ~141 LOC rendering the SVG base/flow connectors with `lineColor`/`lineClass` helpers plus the `.agent-node` grid and per-node function-ref callback `setNodeRef` wired to the composable's measurement map; `AgentTreeDetailPanel` ~285 LOC owning the full detail-panel template — description row, cross-turn source row, prompt section via `MarkdownContent`, info grid (Status/Duration/Tools/Model/Tokens), failure-reason pre, Output with 500-char collapse + "Show more/less" toggle, Result via `ToolResultRenderer` with `fullResults`/`loadingResults` fallback + `loadFullResult` emission, reasoning toggle via `ExpandChevron`, and the Tools & Agents list with nested `ToolArgsRenderer`/`ToolResultRenderer` per row). Backed by the `useAgentTree` composable (`apps/desktop/src/composables/useAgentTree.ts`, 368 LOC) shared via a `provide`/`inject` symbol (`AgentTreeKey` + `provideAgentTree`/`useAgentTreeContext`) and exposing: store/prefs/fullResults/loadingResults/failedResults/loadFullResult/retryFullResult/expandedToolCalls/expandedReasoning/expandedOutputs from `useTimelineToolState`; local refs `selectedNodeId`/`viewMode`/`rootRef`/`nodeRefs`; agent-turn navigation (`agentTurns`/`agentTurnIndex`/`canPrevAgent`/`canNextAgent`/`currentTurn`/`turnNavLabel`/`prevAgentTurn`/`nextAgentTurn`/`jumpToEarliestAgent`/`jumpToLatestAgent`) delegating to the `useTimelineNavigation` (ArrowLeft/ArrowRight/Escape) composable; `setViewMode` that clears selection + tool-call state when switching between Paginated/Unified; `treeData`/`layout`/`displayLines`/`canvasHeight`/`nodeParallelLabel`/`selectedNode`/`hasInProgress`; actions `selectNode`/`closeDetail`/`setNodeRef`/`liveDuration`/`agentPrompt`/`bezierPath`/`updateMeasuredLines`; the `useLiveDuration`-backed `nowMs` ticker gated by `hasInProgressRef`; the "newKey startsWith oldKey" turns-append guard that preserves the current `agentTurnIndex` when turns only extend, vs. full reset (selectedNodeId/expandedToolCalls/nodeRefs) when the sequence changes; and the post-layout `nextTick(updateMeasuredLines)` watcher that reads each node's actual `offsetHeight` to re-anchor the SVG connector `y1` coordinates. Pure algorithms extracted to `apps/desktop/src/utils/agentTreeLayout.ts` (182 LOC — `buildAgentTreeLayout` BFS row-chunker with `maxPerRow=5` + `DEFAULT_AGENT_TREE_LAYOUT_CONFIG` constants (`rootWidth=280`/`childWidth=220`/`rowGap=80`/`colGap=24`/`rootNodeHeight=120`/`childNodeHeight=140`) + `bezierPath` cubic-path string builder) and `apps/desktop/src/utils/agentTreeBuilder.ts` (272 LOC — `buildAgentNode`, `buildPaginatedTree` (turn-scoped cross-turn-parent walker), `buildUnifiedTree` (session-wide aggregator), `findAgentNode` recursive lookup, `treeHasInProgress`) so the tree construction + layout math can be reasoned about in isolation. CSS (~750 LOC of scoped styles including the `@keyframes` blocks renamed to `agent-tree-connector-flow`/`agent-tree-node-pulse`/`agent-tree-pulse-in-progress` to avoid global-stylesheet name collisions) extracted to `apps/desktop/src/styles/features/agent-tree.css`, fully namespaced under `.agent-tree-feature` (applied to the shell's outer `<div>` alongside the legacy `.agent-tree-view` root class) — matching the wave-29/32/33/36 pattern. Public contract unchanged (no props/emits on the view; used by `SessionTimelineView` / `ConversationTab` under the "Agent Tree" tab). Keyboard-navigation coverage is preserved byte-for-byte via the shell's `tabindex="0"` + `ref="rootRef"` binding so `useTimelineNavigation`'s global `keydown` listener still fires only when focus is inside the root: **ArrowLeft** → `prevAgentTurn`, **ArrowRight** → `nextAgentTurn`, **Escape** → clear `selectedNodeId`. Per-node **Enter**/**Space** (with `.space.prevent` to suppress page-scroll) on each `.agent-node` dispatch `selectNode(node.id)`. Tests: `AgentTreeChildren.test.ts` (9 tests — mount coverage for each extracted child: toolbar renders `.view-header`/`.turn-nav`/two `.view-mode-btn`s; canvas renders `.tree-container` + `svg.tree-svg` + ≥3 `.agent-node`s + 4 `path.tree-connector`s (base + flow × 2 children); detail panel opens only on `.agent-node` click and shows `.detail-panel-close`; plus keyboard tests covering every shortcut — Enter selects focused node, Space selects focused node, Escape (global `window.dispatchEvent` with focus inside root) clears selection, ArrowRight advances to next agent turn, ArrowLeft returns to previous; Unified toggle disables every `.turn-nav-btn`). `useAgentTree.test.ts` (6 composable tests — `agentTurns` filters to only turns-with-subagents, `treeData` builds Main-Agent root with correct `model` + child displayNames, `selectNode` toggles on second call, `closeDetail` clears selection, `setViewMode("unified")` aggregates children from every turn, `hasInProgress` flips true for in-progress subagents). `agentTreeLayout.test.ts` (5 pure tests — root is vertically centered at y=20 + horizontally centered via `rootX + rootWidth/2 === width/2`; one bezier line per parent→child (BFS layered); row-chunking of 7 siblings splits into 5 + 2 rows separated by `childNodeHeight + rowGap`; `bezierPath` emits `M ... C ...` cubic path; default config constants match the pre-refactor magic numbers). All 28 original `AgentTreeView.test.ts` tests still pass unmodified. Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave38]: Wave 38 — `SdkSteeringPanel.vue` (1281 LOC; 1364 in plan header) decomposed into shell (~74 LOC) + five children under `apps/desktop/src/components/conversation/sdkSteering/` (`SdkSteeringSentLog`, `SdkSteeringSessionLabel`, `SdkSteeringLinkPrompt`, `SdkSteeringCommandBar`, `SdkSteeringDisconnectedCard`) plus the `useSdkSteering` composable (`apps/desktop/src/composables/useSdkSteering.ts`, ~440 LOC — raised cap for state-machine per Wave-38 brief) owning the entire IPC state machine. The composable wraps its return in `reactive(...)` (matching waves 31–37) and is shared with children via a `provide`/`inject` symbol (`SdkSteeringKey` + `useSdkSteeringContext`). **Critical invariant preserved byte-for-byte**: `sdk.resumeSession` is **only** reachable via the user-triggered `linkSession()` function called from the "Link Session" button — never from any `onMounted`, `watch`, or other reactive effect. Repo memory: calling `session.resume` automatically would spawn a second CLI subprocess writing to the same `events.jsonl` and corrupt the session. The `isActive` gate (`linkedSession.value?.isActive === true`) in `isLinked` and the `resolvedSessionId` / `effectiveSessionId` indirection are carried across verbatim; all six IPC methods (`resumeSession`, `sendMessage`, `setSessionMode`, `abortSession`, `destroySession`, `connect`) retain their original guards, error branches, `scheduleRefresh` cadence (500/800/3000 ms), the `-32601`/`Unhandled method` mode-switch branch, and the auto-dismiss timers (4 s on success, 8 s on error). The two watchers run in the same order as the original file: **w1** `watch(sessionIdRef, …)` — the sessionId reset (clears `userLinked` / `resolvedSessionId` / `sessionError` / `sentMessages` / `pendingModel` / `showModelPicker`); then **w2** `watch(prompt, () => nextTick(autoResize))` — the textarea auto-size. The document-level outside-click listener for the model picker (`document.addEventListener("click", closeModelPicker)` + `onBeforeUnmount` removal, both gated on `typeof document !== "undefined"`) is registered during composable setup at the same relative position as the original. The textarea `inputEl` template ref is forwarded from `SdkSteeringCommandBar` onto the composable via the `ctx.setInputEl` function-ref callback so the post-send `autoResize()` + `inputEl.value?.focus()` still targets the real DOM node. CSS (~660 LOC of scoped styles + the non-scoped `.cb-model-dropdown-portal` block that already needed to be global for the `<Teleport to="body">` dropdown) extracted verbatim to `apps/desktop/src/styles/features/sdk-steering.css` and imported by the shell; all selectors keep the existing globally-unique `cb-*` prefix so no extra namespacing wrapper was needed (a `.sdk-steering-feature` class is still applied to the shell's outer wrapper for parity with waves 29/32/33/36/37). No polling exists in this panel, so `usePolling`/`useAutoRefresh` were not applicable. No modals exist (the model picker is a teleported dropdown closed on outside click), so a keyboard-nav test was not required beyond the existing Ctrl/Cmd+Enter send shortcut covered by the send-flow test. Public contract unchanged: the component still accepts `sessionId: string | null` and `sessionCwd?: string` props and emits `messageSent` with the prompt text. Tests: `SdkSteeringChildren.test.ts` (7 mount/event tests — one per child covering sent-log rendering, session label unlink/shutdown buttons, link-prompt link + model picker + resuming state, command bar send + mode-pill + abort, disconnected-card connect) and `useSdkSteering.test.ts` (14 composable tests covering every IPC-triggered user action: `linkSession` success / pendingModel pass-through / short-circuit when already-active / friendly-error surface; `handleSend` success + prompt clear + `onMessageSent` callback / no-op when unlinked / error status + `friendlyError` on null return; `handleModeChange` forward / -32601 unhandled-method branch; `handleAbort` forward; `handleShutdownSession` forward + state reset; `handleConnect` forward; w1 `sessionId` watcher reset; `handleUnlinkSession` is pure state reset with zero IPC calls). Removed from `scripts/check-file-sizes.mjs` allow-list.

### 4.3 Mega stores / composables

| File | LOC | Plan |
|---|---:|---|
| useSessionDetail.ts | 698 | `session/cache.ts`, `useSessionTurnsRefresh.ts`, `useSessionSections.ts`, pure `sessionFingerprint.ts` |
| stores/search.ts | 668 | `stores/search/{query, facets, indexing, maintenance}.ts` |
| stores/sdk.ts | 615 | `stores/sdk/{connection, messaging, settings}.ts` + listeners via `useWindowLifecycle` |
| useOrbitalAnimation.ts | 602 | Pure `orbitalGeometry.ts` + animation controller |
| stores/preferences.ts | 548 | Slices: `uiPrefs`, `pricingPrefs`, `alertsPrefs`, `featureFlags` |
| useAlertWatcher.ts | 451 | Pinia store (done in 2.2) |

### 4.4 Styling cleanup

- Replace static `:style="{ background: CHART_COLORS.x }"` with class + `--color` CSS custom property.
- Remove hardcoded hex fallbacks (`SearchResultCard.vue`, `designTokens.ts:65-78`, `SearchGroupedResults.vue`, `App.vue:339`).
- Drop `'unsafe-inline'` from Tauri CSP `style-src` (`tauri.conf.json:23-24`) once ≤ 10 `:style` remain; desktop smoke must stay green.

### 4.5 Router improvements

- Adopt `ROUTES` registry + `pushRoute` helper across 10+ call sites.
- Extract breadcrumb logic from `App.vue:237-270` into `useBreadcrumbs.ts`.
- Extract bootstrap phase state-machine (`App.vue:39 AppPhase`) into `useBootstrapPhase()`.

**Definition of done:** No Vue SFC > 1000 LOC; no style block > 500 LOC; all mega-SFC PRs pass visual-regression + a11y; CSP hardened.

**Risk:** Medium. Safety net = Phase 0.9 visual harness + Phase 0.8 a11y gate + PR-scoped Playwright traces.

---

## Phase 3-decomp — Large-file decomposition (backend) 🟡

### 3-decomp.1 `commands/tasks.rs`

- Split into `commands/tasks/{crud, jobs, orchestrator, ingest, presets}.rs` using glob re-exports (memory: Tauri command re-exports pattern).
- Migrate remaining 5 `spawn_blocking { db.lock() … }` sites to `with_task_db`.
- Move `is_process_alive` from this module to `orchestrator::process::is_alive`.
- Unit tests per submodule.

### 3-decomp.2 `bridge/manager.rs`

- Split into `bridge/{lifecycle, raw_rpc, session_tasks, ui_server, tests}.rs`.
- Extract `launch_ui_server` to `ui_server.rs` using shared `process::run_hidden_stdout`.
- Replace `cli_url: Option<String>` with `enum ConnectionMode { Stdio, Tcp { url } }`.
- Audit `unlink_session`/`destroy_session` for `.abort()` on `event_tasks`; regression test.

**Definition of done:** No Rust file > 500 LOC (non-test) / 700 LOC (test); clippy clean at `-D warnings`; Windows + Linux CI green.

**Risk:** Low — mechanical splits.

---

## Phase 3-polish — Generics, newtypes, polish 🟡

### 3-polish.1 LRU + broadcast forwarder generics ✅ DONE (wave 20)

- Replace 2× hard-coded LRU cache constructors in `tauri-bindings/src/lib.rs:40-50` with `build_session_lru::<T>(cap)`. ✅ Helper lives in `tracepilot-tauri-bindings/src/cache.rs`; both `TurnCache` and `EventCache` constructors migrated.
- Replace 2× broadcast→emit loops with `forward_broadcast<T: Serialize>(rx, app, event_name)`. ✅ Helper lives in `tracepilot-tauri-bindings/src/broadcast.rs`; SDK bridge-event and connection-status forwarders migrated. Lagged frames now log via `tracing::warn` instead of being silently dropped.

### 3-polish.2 Newtypes ✅ DONE (wave 20, surface-level adoption)

- `SessionId`, `PresetId`, `SkillName` live in `tracepilot_core::ids` (re-exported from the crate root).
- `validate_session_id`, `validate_preset_id`, `validate_skill_name` in `tracepilot-tauri-bindings::validators` return the matching newtype on success; call-sites that used the unit-result form still compile via `?;`.
- Deep propagation of the newtypes into internal APIs is deferred — see Wave 20 notes; pushing further would exceed the 10-file touch budget.

---

## Phase 5 — Shared packages & CLI 🟡

### 5.1 `@tracepilot/client`

- Split `src/index.ts` (~798 LOC) into `src/{search,sessions,tasks,config,maint,export}.ts` using the per-domain pattern.
- Move `FtsHealthInfo`, `ContextSnippet`, `SessionHealth` back to `@tracepilot/types/src/search.ts`.
- Delete `getHealthScores` stub or guard behind `isTauri`.
- Consistent mock fallback (`sdk.ts`, `mcp.ts`, `skills.ts`) — or extract all mocks into `@tracepilot/client-mocks` opt-in package.
- `toRustOptional(v) => v ?? null` helper replaces 20+ `?? null`.
- `mcpListServers` returns `Record<string, McpServerConfig>` (wrap tuple response).
- `AbortSignal`/timeout support in `createInvoke`.
- Replace `window.__TRACEPILOT_IPC_PERF__` side-effect import with explicit `enablePerfTracing()`.

### 5.2 (already completed above — done before Phase 4)

### 5.3 `@tracepilot/ui` (additional)

- Promote `apps/desktop/src/composables/{useAsyncData, useCachedFetch}` → `packages/ui/src/composables/`.
- Add `useTheme`, `useKeyboard`, `useLocalStorage` to UI composables.
- Convert `useToast` from module-level singleton to `provide/inject`.
- Remove `formatters.ts` back-compat shim after apps migrate.
- Mark `markdown-it`/`dompurify` as **optional** peers.
- Fix mixed barrel/named re-exports in `index.ts`.
- Keep `vue-router` peer (it **is** used by `TabNav.vue`, per reviewer correction).

### 5.4 `@tracepilot/types`

- `"sideEffects": false`.
- Replace `export *` ×17 in `index.ts:1-19` with named re-exports.
- After Phase 1B.1 codegen, delete manual mirrors.
- Add invariant tests for `tasks`, `session`, `models`, `conversation`.
- Move `IPC_EVENTS` to `@tracepilot/client` (domain-coupled).

### 5.5 CLI — Option B (chosen)

- New Rust `tracepilot-core --json` subcommand surfaces list/show/search.
- CLI becomes a thin TS wrapper that spawns the Rust binary.
- Delete duplicate TS discovery/reconstruction/search logic.
- Consume `TracePilotConfig` in `session-path.ts`.
- Delete the `index` stub (`apps/cli/src/commands/index-cmd.ts:1-19`) and shell-echo `resume` (`apps/cli/src/commands/resume.ts:8-12`).
- Fix CLI path-separator assumptions (`apps/cli/src/__tests__/commands/utils.test.ts:56-82`).
- Keep `better-sqlite3` (is used in `show.ts:270-272`).
- Remove checked-in `dist/`.
- Option A (N-API/WASM) → `docs/adr/0003-cli-runtime-bridge.md` as future-work ADR.

### 5.6 Packages general

- README for every package (purpose, public API, tokens required for UI, mock policy for client).
- `"sideEffects": false` where applicable.
- Subpath exports formalised.
- Drop `@tracepilot/config` or grow it into a real shared preset package.

**Definition of done:** Every package has README. No package file > 500 LOC. Types package is single IPC-type source. Mocks out of prod bundle. CLI does not duplicate Rust logic.

**Risk:** Low for splits; Medium for CLI rebase (Option B).

---

## Phase 6 — Release, observability, docs 🟢

### 6.1 Release pipeline (pulled earlier than original)

- Multi-OS Tauri build matrix (Windows + macOS DMG + Linux AppImage/deb).
- `SHA256SUMS` + SLSA provenance (`actions/attest-build-provenance`) + SBOM (`anchore/sbom-action`).
- Cosign/minisign signing optional.
- Wire `git-cliff` or delete `cliff.toml`.
- Fix future-dated entry at `CHANGELOG.md:10`.
- Move `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` into a real secret (currently empty).

### 6.3 Scripts & cross-platform (pulled earlier)

- `justfile` mirroring `.ps1` scripts; keep `.ps1` as Windows shims calling `just`.
- Port `validate-session-versions.py` to Node/TS.
- Consolidate 13 `scripts/e2e/*.mjs` into Playwright tests under `tests/e2e/` (repo already has `playwright-core`).
- Remove implicit install from root `start` script (`package.json:18-21`).
- `scripts/README.md`.

### 6.2 Observability

- Opt-in crash reporting (sentry-tauri with self-hosted endpoint or disabled default).
- Telemetry opt-in switch + README privacy note.
- Sink `window.__TRACEPILOT_IPC_PERF__` to `tracing` when tokio-console feature on.
- `#[tracing::instrument]` at all IPC command boundaries.
- Promote `mcp/health.rs::sanitize_error_msg` → `core::utils::log_sanitize`.

### 6.5 Perf budgets

- Wire `perf-budget.json` IPC thresholds to `tracepilot-bench` IPC bench.
- Flip `bundle-analysis.yml` and `benchmark.yml` from `::warning::` to `::error::` + `exit 1` on breach.

### 6.6 Dependency hygiene

- pnpm `catalog:` for shared TS deps.
- Hoist `tauri`, `tauri-plugin-*`, `tempfile`, `uuid`, `tokio`, `sha2` to `[workspace.dependencies]`.
- Vendor `copilot-sdk` or switch to upstream release tag when available.

### 6.4 Docs reorganisation (last)

- `docs/archive/YYYY-MM/` for superseded docs (`tech-debt-report.md`, `tech-debt-report-review.md`, `tech-debt-consolidation-report.md`, `tech-debt-future-improvements.md`, old `implementation-*.md`, `ai-task-system.md`, `copilot-sdk-integration-evaluation.md`, `tantivy-search-index.md`, `performance-analysis-report.md`, `performance-profiling-results.md`).
- Regroup under `architecture/`, `guides/`, `plans/`, `reports/`, `research/`, `design/`, `archive/`.
- Generated `docs/README.md` index (`scripts/build-docs-index.mjs`).
- Fix `2026-*` future-dated reports.
- Rename `SECURITY_AUDIT_REPORT.md` → lowercase-hyphenated.
- Move `docs/design/prototypes/` (~2.5 MB HTML) out of the repo.
- `docs/adr/` ADRs: 0001 Supported platforms; 0002 Filesystem trust boundary; 0003 CLI runtime bridge; 0004 Adopt specta; 0005 Structured IPC errors; 0006 Migration policy.

**Definition of done:** Release artefacts signed + SBOM'd + SHA-pinned on all 3 OSes; crash reports flow; docs reorg + broken-link-clean index; IPC perf budgets hard-fail.

**Risk:** Low — tooling.

---

## PR batching (first wave)

1. **PR-A (Phase 0):** CI matrix + SHA pinning + coverage + a11y + visual + migration fixtures + lint configs.
2. **PR-B (1A.1):** Capability scoping — `AllowAllCommands` removed, viewer-* tightened.
3. **PR-C (1A.2):** Path jail adoption + traversal fuzz.
4. **PR-D (1A.3):** MCP URL policy.
5. **PR-E (1A.4):** Shell-injection split.
6. **PR-F (1A.5):** Structured IPC errors (backend + frontend migration).
7. **PR-G (1A.6/1A.7):** Broadcast sizing + listener ownership.
8. **PR-H (1B.1):** Specta/tauri-specta.
9. **PR-I (1B.2/1B.3):** TS registries + Rust constants.
10. **PR-J (3-safety.1):** Migration framework.
11. **PR-K (3-safety.3):** Concurrency cleanups (`ArcSwapOption` + lock-scope audit).

Phases 2 / 4 / 5 / 6 then proceed with each mega-file as its own PR.

---

## Appendix A — Success metrics (revised, non-gameable, CI-generated)

All metrics are generated by `scripts/generate-debt-metrics.mjs`, committed, and verified in CI.

| Metric | Baseline | Target |
|---|---|---|
| **Contract:** generated-binding `git diff` clean | — | always clean in CI |
| **Security:** viewer capability destructive-command test | allow-all | 0 destructive commands |
| **Security:** path-traversal fuzz tests per path-taking IPC | 0 | all commands |
| **Security:** MCP URL policy fuzz tests | 0 | loopback + private + redirect covered |
| **Errors:** frontend substring-matches on error messages | ≥1 | 0 |
| **Migration:** N-1 DB/config snapshots migrate cleanly on Win+Linux | 0 | 100% |
| **Parity:** CI matrix green lanes | Ubuntu only | Ubuntu + Windows + macOS (typecheck + tests) |
| **Parity:** release artefacts | Windows only | Windows + macOS + Linux |
| **CSP:** `'unsafe-inline'` in `style-src` | present | absent |
| **a11y:** axe violations on top-20 views | unmeasured | 0 new in Phase 4 |
| **Perf:** hidden-window polling CPU % | unmeasured | ≤ 0.5% idle |
| **Lints:** raw `try/catch + toErrorMessage` in stores | ~90 | lint-banned (0) |
| **Lints:** raw `setInterval` outside composables | ~6 | lint-banned (0) |
| **Lints:** raw `.page-content` / `.stat-card` class usage | ~20 | lint-banned (0) |
| **Listener leaks:** regression test (100 window cycles) | not run | 0 leaked |
| **Coverage:** desktop + rust line-coverage floor | unmeasured | published floor, only rises |
| **Docs:** broken-link check | not run | clean in CI |

(LOC-based metrics retained as *internal diagnostics* but not as success criteria.)

## Appendix B — Breaking changes expected

- **IPC error payload** shape: string → `{code, message, details?}`.
- **localStorage keys:** `tracepilot-*` → `tracepilot:*` with one-shot migration.
- **Package exports:** `@tracepilot/ui/tokens.css` added; `@tracepilot/client/generated/*` added.
- **Tauri capability names:** main vs viewer split; may require `tauri info` regeneration in dev.
- **CLI commands:** `index` (stub) removed; `resume` reworked or removed.
- **`TaskDb` handle:** `Arc<Mutex<Option<_>>>` → `ArcSwapOption<_>` at API surface.
- **`TracePilotConfig` handle:** `Arc<Mutex<_>>` → `Arc<RwLock<_>>`.
- **Migration framework:** `TaskDb` `task_meta` versioning → `schema_version` table (one-way migration).

[^wave23]: Wave 23 — decomposed into PresetStatsStrip, PresetFilterBar, PresetGrid, PresetList, NewPresetModal, EditPresetModal, DeletePresetConfirm (plus `usePresetManager` composable and `preset-manager.css` feature stylesheet). View shell: 2070 LOC → 155 LOC.

[^wave24]: Wave 24 — decomposed into `ExportTab` and `ImportTab` sibling children (under `apps/desktop/src/components/export/`) and moved the ~590 LOC of scoped CSS to `apps/desktop/src/styles/features/export.css`. No composable was extracted because the existing `useExportConfig`, `useExportPreview`, and `useImportFlow` composables already carry the shared state and each tab uses a disjoint subset. Shell now contains only the header + TabNav + tab routing. Mount tests for each child plus the view shell land in `components/export/__tests__/ExportChildren.test.ts`. Removed from `scripts/check-file-sizes.mjs` allow-list.

[^wave25]: Wave 25 — decomposed into `TaskDetailHeader`, `TaskResultPanel`, `TaskContextPanel`, `TaskTimelinePanel`, `TaskSubagentPanel`, `TaskRawPanel` (under `apps/desktop/src/components/tasks/detail/`) plus a `useTaskDetail` composable (`apps/desktop/src/composables/useTaskDetail.ts`) that owns the shared task lookup, auto-refresh wiring (continues to use `@tracepilot/ui`'s `useAutoRefresh` — pause-when-hidden semantics preserved), cancel/retry/delete actions, clipboard helper, and timeline derivation. The ~630 LOC of scoped CSS moved to `apps/desktop/src/styles/features/task-detail.css`. Shell: 1441 LOC → 161 LOC. Tabs (Result/Context/Timeline/Subagent/Raw) unchanged; no modals existed to extract (delete flow already uses `useConfirmDialog`). Mount tests for each child land in `components/tasks/detail/__tests__/TaskDetailChildren.test.ts`; composable tests land in `composables/__tests__/useTaskDetail.test.ts`. Removed from `scripts/check-file-sizes.mjs` allow-list.
