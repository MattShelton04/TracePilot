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
| 0.9 | **Visual-regression harness** | Playwright snapshot tests (deterministic renders) for the 20 mega-SFCs that Phase 4 will touch. Snapshots captured **now** at current behaviour. |
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

### 1B.1 Rust ↔ TS contract codegen — 🟡 PARTIAL (wave 8 — infra + pilot)

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

### 3-safety.1 DB migration framework (was 3.4)

- Unify `IndexDb` + `TaskDb` migration runners behind a `Migrator` trait in `core::utils::sqlite`.
- Standardise on a single `schema_version` table (migrate `TaskDb` away from key-value `task_meta` versioning).
- Add backup-before-migrate (`{db}.pre-vN.bak`) + rollback-on-failure.
- Document migration policy ADR: forward-only; schema additions allowed; column removals require two-phase; breaking changes require user-data export step.

### 3-safety.2 Path + process helpers (was 3.5)

- Promote `CREATE_NO_WINDOW` to `core::constants`.
- Centralise `which`/`where` probing in `process::find_executable`.
- Replace inline `Command::new` in `bridge/manager.rs:807-840` and `bridge/discovery.rs` with shared helpers.
- Formalise jail helpers in `core::utils::fs` (path canonicalisation, symlink policy from 1A.2 ADR).

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

### 3-safety.5 Shared test-support crate

- New `crates/tracepilot-test-support` (`[dev-dependencies]`) hosting `builders.rs`, `analytics/test_helpers.rs`, `export/test_helpers.rs`. Delete duplicate fixtures.

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
| PresetManagerView.vue | 2365 | PresetStatsStrip, PresetFilterBar, PresetGrid, PresetList, NewPresetModal, EditPresetModal, DeletePresetConfirm |
| ConfigInjectorView.vue | 2020 | ConfigInjectorAgentsTab, …GlobalTab, …VersionsTab, …BackupsTab (+ move `AGENT_META` to registry) |
| WorktreeManagerView.vue | 1990 | CreateWorktreeModal, WorktreeDetailsPanel, RegisteredReposList |
| AgentTreeView.vue | 1928 | composables/useAgentTreeLayout, useAgentTreeKeyboard, pure agentTreeRender utilities |
| SessionLauncherView.vue | 1855 | LauncherForm, LaunchTemplateList, LaunchTemplateFormModal |
| SessionSearchView.vue | 1734 | move 1157 LOC CSS out; already has children |
| OrchestratorMonitorView.vue | 1690 | OrchestratorStatsStrip, RunningJobsPanel, RecentJobsPanel |
| SkillEditorView.vue | 1635 | SkillFrontmatterEditor, SkillAssetsPanel, SkillPreviewPane |
| TaskCreateView.vue | 1566 | WizardStep1Preset, WizardStep2Variables, WizardStep3Submit, useTaskWizard |
| ExportView.vue | 1481 | ExportTab, ImportTab siblings under PageShell |
| TaskDetailView.vue | 1441 | TaskHeader, TaskResultsPanel, TaskJobsPanel, TaskLogsPanel |
| SdkSteeringPanel.vue | 1364 | SteeringControls, SteeringSessionsList, SteeringMessageEditor |
| McpServerDetailView.vue | 1360 | McpStatusCard, McpToolsList, McpConfigPanel |
| SkillImportWizard.vue | 1350 | SkillImportSource, SkillImportPreview, SkillImportConfirm |
| SessionComparisonView.vue | 1186 | ComparisonHeader, ComparisonMetricsGrid, ComparisonTimeline |
| TodoDependencyGraph.vue | 1125 | useTodoGraphLayout + TodoGraphNode, TodoDetailSlideover |
| ModelComparisonView.vue | 1120 | ModelStatsGrid, ModelLeaderboard, ModelDetailDrawer |

(`TurnWaterfallView`, `NestedSwimlanesView`, `ChatViewMode` from original plan still > 1000 LOC but below top 17 by ROI; included in same pass.)

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

### 3-polish.1 LRU + broadcast forwarder generics

- Replace 2× hard-coded LRU cache constructors in `tauri-bindings/src/lib.rs:40-50` with `build_session_lru::<T>(cap)`.
- Replace 2× broadcast→emit loops with `forward_broadcast<T: Serialize>(rx, app, event_name)`.

### 3-polish.2 Newtypes

- `SessionId`, `PresetId`, `SkillName` in `tracepilot-core`; `validate_session_id` returns `SessionId`.
- Uniform validation in command entrypoints.

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
