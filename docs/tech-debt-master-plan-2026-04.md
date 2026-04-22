# TracePilot Tech-Debt Master Plan — 2026-04 (Continued)

> **Purpose.** This document is the *active* tech-debt backlog. It supersedes the "What's deferred" section of `tech-debt-progress-report-2026-04.md` for all future work, baking the findings from `docs/archive/2026-04/tech-debt-audit-2026-04.md` together with a fresh survey of the current repo into a single, wave-by-wave implementation plan.
>
> **Audience.** Opus 4.7 sub-agents working iteratively (one wave per dispatch). Each wave is sized to land as a single reviewable PR/commit with its own gates.

---

## Snapshot (2026-04, post-Wave 62)

| Metric | Now |
|---|---:|
| Desktop Vitest tests | **1,659** |
| Mega-SFCs > 1,000 LOC | **0** (was 17) |
| Mega-SFCs 600–1,000 LOC | **12** (next wave target) |
| Rust files > 1,000 LOC (non-test) | **3** (`search_reader.rs`, `process.rs`, `index_db/mod.rs`) |
| Rust files 700–1,000 LOC (non-test) | **~10** |
| Non-test TODO/FIXME/HACK comments | **~510** |
| Router string-literal `router.push("/…")` | **5** (rest via `pushRoute`) |
| Inline `:style=` bindings (Vue) | **137** |
| `error.value = toErrorMessage(e)` sites | **23** |
| `spawn_blocking` direct sites | **42** |
| Dynamic `import("@tauri-apps/*")` outside `@tracepilot/client` | **25** |
| Docs files at `docs/` top level | **37** |

Every wave gated on:

- `pnpm --filter @tracepilot/desktop typecheck`
- `pnpm test` (vitest)
- `node scripts/check-file-sizes.mjs`
- `pnpm --filter @tracepilot/desktop build` (when touching desktop)
- Rust waves additionally: `cargo check -p <crate>`, `cargo test -p <crate>`, `cargo clippy -p <crate> --all-targets -- -D warnings` (zero *new* clippy warnings over baseline).

Invariants (do not break):

- Windows `CREATE_NO_WINDOW = 0x08000000` on every background `Command::new()`.
- Tauri command glob re-exports (`pub use submod::*`) for `__cmd__*` resolution.
- New commands: must be listed in `apps/desktop/src-tauri/build.rs` `InlinedPlugin::commands()`.
- Pinia stores preserve their public setup-store API byte-for-byte unless the wave explicitly changes it (then update all call sites + tests in the same wave).
- Vue 3: `onScopeDispose` must be called synchronously before any `await`.
- SDK `session.resume` MUST NOT be called automatically.

Commit trailer on every wave commit:
```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

---

## Phase 8 — Remaining mega-files decomposition (Rust)

The audit identified >500 LOC as the rule of thumb. Focus these waves on the >700-LOC top-10 that still stand.

### w63 — `crates/tracepilot-indexer/src/index_db/search_reader.rs` (1,408 LOC)
Split into `search_reader/{query_builder, facets, browse, ranking, tests}.rs`. Preserve the public `SearchReader` surface byte-for-byte; `mod.rs` becomes the re-export hub. Add per-submodule unit tests where reasonable.

### w64 — `crates/tracepilot-orchestrator/src/process.rs` (1,150 LOC)
Split into `process/{mod, hidden, terminal, timeout, os_windows, os_unix, tests}.rs`. Consolidate `CREATE_NO_WINDOW` usage behind `process::hidden_command()` (audit predicted `pub` exposure; follow-through now). Keep `is_alive()` (w51) in the new module.

### w65 — `crates/tracepilot-indexer/src/index_db/mod.rs` (1,060 LOC)
Move bodies into submodules (writers/readers/pragmas), keep `mod.rs` as a thin hub. Collapse `open_readonly` duplication: delete the crate-local implementation in favour of `core::utils::sqlite::open_readonly`.

### w66 — `crates/tracepilot-core/src/parsing/events.rs` (935 LOC)
Split into `events/{raw, typed, parallel, tests}.rs`. Preserve `parse_typed_events_parallel()` (stored memory).

### w67 — `crates/tracepilot-orchestrator/src/skills/import.rs` (918 LOC)
Split per import source: `import/{local, github, file, atomic, tests}.rs`. Fold `atomic_dir_install` helper into `core::utils::atomic` (see w75 duplication removal).

### w68 — `crates/tracepilot-orchestrator/src/mcp/health.rs` (823 LOC)
Split stdio vs HTTP probe logic: `health/{mod, stdio, http, tests}.rs`.

### w69 — `crates/tracepilot-indexer/src/lib.rs` (840 LOC)
Move body into `crate::indexing` submodule tree. Keep `lib.rs` as re-exports + `pub mod` declarations only (<100 LOC target).

### w70 — `crates/tracepilot-export/src/render/markdown.rs` (840 LOC)
Split into `markdown/{header, turns, footer, tests}.rs`. Same PR: **delete** the legacy `export/src/markdown.rs` (audit §1 item #10). The legacy module is the sole `anyhow` consumer — workspace becomes `anyhow`-free.

### w71 — `crates/tracepilot-core/src/turns/reconstructor.rs` (773 LOC) + `crates/tracepilot-tauri-bindings/src/config.rs` (751 LOC) + `helpers.rs` (740 LOC) + `validators.rs` (706 LOC) + `commands/session.rs` (672 LOC)
Batched decomposition of the remaining 600–800-LOC hub files. Any one submodule split that is clearly mechanical. `config.rs` → per sub-config file + `defaults.rs`. `helpers.rs` → `helpers/{path, db, cache, emit}.rs`. `validators.rs` → `validators/{rules, id, path, tests}.rs`.

---

## Phase 9 — Remaining mega-Vue-SFC decomposition

Same pattern established through waves 22–38. Extract child components + move styles. Keep the public export/route shape unchanged.

### w72 — `components/timeline/TurnWaterfallView.vue` (967)
### w73 — `components/timeline/NestedSwimlanesView.vue` (942)
### w74 — `components/conversation/ChatViewMode.vue` (889) + `conversation/SubagentPanel.vue` (876)
### w75 — `components/SearchPalette.vue` (805) + `components/SetupWizard.vue` (674)
### w76 — `views/AnalyticsDashboardView.vue` (764) + `views/tabs/TokenFlowTab.vue` (736) + `views/tabs/MetricsTab.vue` (625)
### w77 — `components/tasks/PresetDetailSlideover.vue` (694) + `components/mcp/McpAddServerModal.vue` (674)
### w78 — `views/orchestration/OrchestrationHomeView.vue` (617)

---

## Phase 10 — Backend architectural polish

### w79 — `ConnectionMode` enum
Replace `cli_url: Option<String>` with `enum ConnectionMode { Stdio, Tcp { url: String } }`. Surface via `BridgeStatus::connection_mode` IPC payload. Update TS types in `@tracepilot/types` + `@tracepilot/client`. Regression test for all three modes (stdio / spawned TCP / external TCP — see stored memory re: connection modes).

### w80 — Deep newtype propagation
Propagate `SessionId`, `PresetId`, `SkillName`, `RepoId` past the IPC validation boundary into internal APIs. Goal: `&str` at function signatures becomes `&SessionId`. Touch `tracepilot-core`, `tracepilot-orchestrator`, `tracepilot-indexer`.

### w81 — Remove duplication (§3.2 residue)
- Extract `process::hidden_command(program, args)` helper; migrate the 4 inline `Command::new(…)` + `.creation_flags(0x08000000)` sites in `bridge/discovery.rs` and `bridge/manager.rs`.
- Fold `atomic_json_write` + `atomic_dir_install` behind `core::utils::atomic::{write_file, install_dir}`.
- Unify `conn.profile(…)` slow-query block behind `core::utils::sqlite::attach_slow_query_profiler(conn)`.
- Delete crate-local `IndexDb::open_readonly` (superseded by w65).

### w82 — Mutex-poison + `let _ =` hygiene
- Replace `std::sync::Mutex` on `SharedTaskDb`/`SharedOrchestratorState`/config with `tokio::sync::OnceCell` or `parking_lot::Mutex` (no poison).
- Audit 20+ `let _ = …` sites in non-test code; each becomes a logged warning.
- `emit` failures in `tauri-bindings/src/lib.rs:78,95` → `tracing::warn!`.

### w83 — Error-variant hardening
- Replace substring-match on `"ALREADY_INDEXING"` with a stable `code` field in `BindingsError::serialize`. Frontend matches on `e.code === "ALREADY_INDEXING"`. Preserve `error.message` for human UX.
- Split `OrchestratorError::TaskDb(#[from] rusqlite::Error)` into task-DB vs generic SQLite variants so errors are not misattributed.
- Add `error.code` to all 13 `BindingsError` variants; emit a single camelCase discriminator.

### w84 — SDK subprocess hygiene tests
- Regression test for `unlink_session` / `destroy_session` calling `.abort()` on every entry of `event_tasks`.
- Tests live in `bridge/manager/tests.rs`.

### w85 — `tracing::instrument` expansion — FI
- Landed 74 `#[tracing::instrument]` attrs on Tauri command handlers (mcp: 11, sdk: 14, skills: 14, orchestration: 12, tasks: 15, export_import: 5, session misc: 3). All pre-existing instrumented handlers preserved.
- **FI — orchestrator crate public methods**: `bridge::manager::BridgeManager`, `skills::manager`, `presets::io`, `mcp::config/health/import`, `task_db::operations`, `task_orchestrator::*` were not swept. These are called through instrumented Tauri commands, so the command-level spans already give correlation; deeper spans are an OpenTelemetry-export follow-up.
- **FI — long-running background tasks**: bridge event pumps (`BridgeManager` internal spawned tasks), MCP health monitor, task orchestrator poll loop — none instrumented. Needs explicit root spans tied to session/PID so long-lived telemetry is queryable.
- **FI — span linking**: cross-process correlation between Tauri commands and the spawned orchestrator subprocess uses no trace context propagation today. A future OTLP export + `traceparent` environment variable hand-off would close this.
- **FI — remaining uninstrumented handlers**: `logging.rs` (2), `window.rs` (2), `state.rs` minor getters (3), `analytics_executor.rs`, `config_cmds.rs` (most), `search.rs` (some), `file_browser` writes, `tasks::crud::task_get/list/stats` variants already covered. Can be swept in a follow-up.

### w85 — `tracing::instrument` expansion
- Add `#[tracing::instrument(skip_all, level=debug, err, fields(…))]` to every `commands::*` handler that currently lacks one (~140 handlers). Use a script-assisted codemod, then review.

### w86 — `run_hidden_shell` hardening
- Audit every call-site of `orchestrator/src/process::run_hidden_shell` (the `powershell -Command` entry point) and migrate each to `run_hidden(program, args)` with explicit argv. Document residual call-sites as `#[deprecated]`.

### w87 — Async discipline (§3.7)
- Convert `get_or_init_task_db` to `tokio::sync::OnceCell`.
- Hoist `std::fs::create_dir_all` etc. out of the `SharedOrchestratorState.lock()` critical section in `commands/tasks/orchestrator_start.rs`.
- Audit `BridgeManager` lock usage: switch `.write()` → `.read()` where the op is read-only.

### w87 — Async discipline cleanup — FI
- Landed in commit: (1) `orchestrator_start.rs` rescan now uses 3-phase pattern (DB lock → drop → fs+manifest I/O outside lock → re-acquire DB lock only for status updates), matching the pattern already used in `ingest.rs`. (2) `tracing::Instrument::instrument` wrapping on the two `tauri::async_runtime::spawn` bridge forwarders in `lib.rs::init` (bridge_event_forwarder / bridge_status_forwarder spans), and on `spawn_event_forwarder` in `bridge/manager/session_tasks.rs` (sdk_event_forwarder span with session_id field).
- **FI — `get_or_init_task_db` → `tokio::sync::OnceCell`**: `SharedTaskDb` is `Arc<std::sync::Mutex<Option<TaskDb>>>`; migrating to `Arc<OnceCell<Arc<Mutex<TaskDb>>>>` (or similar) touches `types.rs`, `helpers/db.rs::with_task_db`, `get_or_init_task_db`, and 3+ command files. Current init path is cold (one-time) so the contention win is limited; deferred as a follow-up for when async init becomes load-bearing.
- **FI — `BridgeManager` `.read()` vs `.write()` audit**: `SharedBridgeManager` is a `tokio::sync::RwLock`. Many callers acquire `.write()` reflexively (e.g., read-only queries in `commands/sdk.rs`). Short-term the `RwLock` is uncontested; a surgical `.read()` sweep would reduce serialization under future SDK load but requires checking each method takes `&self` not `&mut self`.
- **FI — `ingest.rs` nested manifest+DB lock**: `task_ingest_results` holds both `db.lock()` and `manifest_lock.lock()` while calling `std::fs::remove_file` and `append_task_to_manifest`. Within `spawn_blocking` today so not an async issue, but the DB lock could be dropped before manifest work to let concurrent DB reads proceed. Low priority (retry path, cold).
- **FI — `config_injector` / `templates` using `std::fs` instead of `tokio::fs`**: All call sites run through `blocking_cmd!`, so correctness is fine. Migrating to `tokio::fs` would let the runtime batch I/O but at the cost of losing the simple synchronous read-modify-write pattern. Not a net win without profiling evidence.
- **FI — `is_alive` poll loop in `task_orchestrator_stop`**: `std::thread::sleep(300ms)` × 10 inside `spawn_blocking`. Works, but a `tokio::time::sleep` in a fully async rewrite would free the blocking worker. Defer until the command migrates off `spawn_blocking`.

---

## Phase 11 — Frontend architectural polish

### w88 — New UI composables
- `useTheme()` — move out of desktop app into `@tracepilot/ui` with design-token awareness.
- `useKeyboard()` — global shortcut manager (register/unregister/scope). Replaces ad-hoc `window.addEventListener('keydown', …)` sprinkles.
- `useLocalStorage()` — type-safe wrapper over `storageKeys` registry; replaces the 4 local reimplementations (§4.3 of the audit) and `usePersistedRef` if appropriate.

### w88 — New UI composables — FI
Landed three generic composables in `packages/ui/src/composables/` — `useTheme` (light/dark/system + `prefers-color-scheme`), `useKeyboard` (`useShortcut`, `useKeydown`, `matchesCombo` — `Mod` / `Ctrl` / `Shift` / `Alt` / `Meta` parsing, `onScopeDispose` sync-before-await), and `useLocalStorage` (shallow-ref, cross-tab `storage` event sync, pluggable serializer). 5 call-site migrations landed:
- `apps/desktop/src/components/skills/SkillImportWizard.vue` — Escape via `useShortcut`.
- `apps/desktop/src/components/SetupWizard.vue` — wizard `onKeydown` wired via `useKeydown({ target: document })`.
- `apps/desktop/src/composables/useSubagentPanel.ts` — three `useShortcut` bindings (Escape / ArrowLeft / ArrowRight) gated by `when`.
- `apps/desktop/src/components/UpdateBanner.vue` — `dismissedVersion` via `useLocalStorage` (raw-string serializer, `flush: "sync"`).
- `apps/desktop/src/components/layout/AppSidebar.vue` — same treatment for its separate `dismissedVersion` ref.

Remaining callers that could adopt these composables (logged as FI, not actioned to keep diff surgical):
- **Keyboard (4 call sites still using raw `addEventListener("keydown", …)`):** `apps/desktop/src/components/SearchPalette.vue` (Cmd/Ctrl+K global + palette-scoped arrow/enter/tab), `apps/desktop/src/composables/useSearchKeyboardNavigation.ts` (capture-phase arrows — would need `useKeydown({ capture: true })`), `apps/desktop/src/composables/useSkillEditor.ts` (Cmd/Ctrl+S save), `apps/desktop/src/views/SessionReplayView.vue` (replay-controller dispatch). The two capture-phase / delegated cases need extra care around editable-target filtering semantics.
- **localStorage (4 call sites still hand-rolling reads/writes):** `apps/desktop/src/composables/useRecentSearches.ts` (needs array-validation serializer; tests assert `setItem` calls synchronously), `apps/desktop/src/stores/sdk/settings.ts` (explicit manual-save contract preserved per existing comment), `apps/desktop/src/stores/sessionTabs.ts` (multi-field tuple with gated hydration), `apps/desktop/src/stores/preferences/ui.ts` / `apps/desktop/src/stores/preferences.ts` (theme write-through cache + ephemeral last-viewed/last-seen refs — coupled to hydration gate).
- **Theme:** app currently owns theme inside `stores/preferences/ui.ts` backed by `config.toml` via the backend. `useTheme` is intentionally *not* wired there — adopting it would require rethinking the hydration / write-through cache pipeline and the two-value (light/dark only) store schema. Logged for a follow-up that explicitly plans the system-theme UX change.
- **`usePersistedRef` vs `useLocalStorage`:** both coexist; `usePersistedRef` uses deep watch on plain `Ref`, while `useLocalStorage` uses `shallowRef` + cross-tab sync. Consolidation deferred until we audit which deep-watch call sites rely on nested-mutation persistence.


### w89 — Mock-fallback unification
- Extract `packages/client/src/internal/mockData.ts` (~29 KB) into opt-in `@tracepilot/client-mocks` subpackage, or a dynamic import behind `import.meta.env.DEV`.
- Standardise mock fallback across `sdk.ts` / `mcp.ts` / `skills.ts` / the rest via `createInvokeWithMock(commandName, mockFn)`.
- Kills `getHealthScores` STUB; replace with real invoke or deprecate.

### w89 — Mock-fallback unification — FI
Landed central `apps/desktop/src/lib/mocks/index.ts` with three helpers — `isTauri()` (mirrors `@tracepilot/client`'s check but with zero dependency on the client package so test vi.mocks stay simple), `maybeMock(mockValue, tauriFn)` (Tauri-vs-browser branch, with eager-or-lazy mock producer), and `promptForPath(title, defaultPath?)` (prompt-based fallback for the Tauri `open`/`save` dialog plugins, with null-byte/control-char sanitisation). Also exported `isTauri` from `@tracepilot/client` (previously only internal to `invoke.ts`). 6 call-site migrations landed:
- `apps/desktop/src/utils/tauriEvents.ts` — drop local `isTauri()`, import from `@/lib/mocks`.
- `apps/desktop/src/utils/openExternal.ts` — replace dynamic `import("@tauri-apps/api/core")` `isTauri` with synchronous `@/lib/mocks` check; keeps the opener-plugin dynamic import so it still tree-shakes.
- `apps/desktop/src/utils/logger.ts` — replace hand-rolled `"__TAURI_INTERNALS__" in window` with `isTauri()` from `@/lib/mocks` (still cached at module eval to preserve existing test semantics).
- `apps/desktop/src/composables/useAppVersion.ts` — drop dynamic `import("@tauri-apps/api/core")` for the isTauri check; guard upfront with `isTauri()` from `@/lib/mocks`.
- `apps/desktop/src/composables/useImportFlow.ts` — `browseFile` uses `isTauri()` + `promptForPath()` (removes duplicated `prompt()`/trim logic).
- `apps/desktop/src/composables/useBrowseDirectory.ts` — all three dialog helpers (`browseForDirectory`, `browseForSavePath`, `browseForFile`) consolidated onto `isTauri()` + `promptForPath()`; drops the local `sanitizePath` helper (its control-char / trim logic now lives in `promptForPath`).

Remaining fallback sites logged as FI (not actioned to keep diff surgical):
- **`apps/desktop/src/composables/useWindowRole.ts`** — uses a try/catch around `import("@tauri-apps/api/webviewWindow")` as an implicit isTauri check. Could short-circuit with `isTauri()` upfront to avoid the dynamic-import failure path in browser/Storybook, but the try/catch also legitimately protects against a Tauri-context webviewWindow failure.
- **`apps/desktop/src/composables/useAlertDispatcher.ts`** — four dynamic `import("@tauri-apps/*")` call-sites (`api/window`, `plugin-notification` ×2, `api/window` ×2) guarded only by outer `isTauri()` checks in helper code; folding into `maybeMock(...)` would simplify the branching but needs a per-callsite audit of the fall-through behaviour.
- **`apps/desktop/src/composables/useAutoUpdate.ts`** — `check` / `relaunch` dynamic imports behind isTauri checks elsewhere in the file; ripe for `maybeMock` conversion when w94 lands.
- **`apps/desktop/src/composables/useWindowLifecycle.ts`** — parallel dynamic imports of `@tauri-apps/api/window` + `@tauri-apps/api/event`; candidate for a `maybeMock` + destructure pattern.
- **`apps/desktop/src/ChildApp.vue` (×2)** — two dynamic `@tauri-apps/api/window` imports inside component methods that could route through `@/lib/mocks`.
- **`apps/desktop/src/components/settings/SettingsLogging.vue`** — direct `import("@tauri-apps/api/core").invoke` call rather than going through `@tracepilot/client` (overlaps with w94's 25-site sweep).
- **`apps/desktop/src/__tests__/composables/useImportFlow.test.ts:87`** — test-only `delete window.__TAURI_INTERNALS__` poke. Left as-is; expressing that intent through the central helper would require stubbing `@/lib/mocks`, which fights vitest's module cache for little gain.
- **`packages/client` mock-data dead-weight** — the original w89 bullet (dynamic import behind `import.meta.env.DEV`, `@tracepilot/client-mocks` subpackage, `getHealthScores` STUB) is still unaddressed. The 29 KB `internal/mockData.ts` remains bundled even in the production Tauri build because `createInvoke` holds a direct reference to `getMockData`. Deferred — it's a ~60-line refactor that touches every domain module and warrants its own wave.


### w90 — `IPC_EVENTS` moves to `@tracepilot/client`
`IPC_EVENTS` is a domain runtime constant; audit §5.3. Move from `@tracepilot/types` to `@tracepilot/client/events.ts`. Back-compat re-export in types.

### w91 — Remaining inline-style sweep
- Reduce 137 `:style=` bindings to < 40 (the genuinely dynamic ones like `transform: translate(${x}px,${y}px)`). Static-token bindings become CSS custom properties on the root class.
- Remove 6 hex-fallback palettes in `designTokens.ts:65-78`, `SearchResultCard.vue`, `AgentTreeView.vue`, chart utils.
- Eliminates CSP `style-src 'unsafe-inline'` blocker (see w108).

### w92 — `runMutation` / `runAction` final sweep
- Migrate the remaining 23 `error.value = toErrorMessage(e)` try/catch sites across stores. Pair with a biome lint rule (or a guard-rail test) that fails if `toErrorMessage` is used outside store helpers.

### w93 — Final `router.push` cleanup + feature-flag registry
- Migrate the 5 remaining `router.push("/…")` literals to `pushRoute(ROUTE_NAMES.*)`.
- Feature-flag strings (`"healthScoring"`, `"sessionReplay"`, `"exportView"`, `"mcpServers"`, `"skills"`, `"aiTasks"`, `"copilotSdk"`) become a typed registry in `@tracepilot/types/src/featureFlags.ts`; `to.meta?.featureFlag as string` cast is deleted.

### w94 — Dynamic Tauri imports
- Audit the 25 dynamic `import("@tauri-apps/*")` sites and centralise each via `@tracepilot/client` so no component imports Tauri APIs directly. (The `App.vue:59,74` uses from the audit and the 23 others flushed out by this survey.)
- Raw event `"popup-session-closed"` becomes a typed event in the events registry.

### w95 — Store-mutation-from-component clean-up
- 5 verified sites where `store.error = …`/`store.x = …` is assigned from a component. Replace each with a store action.
- Promote to a biome rule or a vitest invariant.

### w96 — `shallowRef` adoption for large reactive arrays
- `turns`, `events`, `results`, `facets` in `useSessionDetail.ts` and `stores/search.ts`. Safe because we always replace the array; never mutate indices.
- Add a micro-bench gate (existing `tracepilot-bench` or a vitest perf test) to quantify the win.

### w97 — Visibility-gated polling
- Every `usePolling()` call that re-polls more than once per 5s should pause when `document.visibilityState === 'hidden'`. Extend `usePolling` rather than every caller.

---

## Phase 12 — Types / codegen expansion

### w98 — Specta codegen expansion
- The w6 pilot wired `specta + tauri-specta` for session listing. Expand coverage: `tasks`, `session`, `models`, `conversation`, `mcp`, `skills` shapes. Delete hand-mirrored Rust↔TS types for anything now auto-generated.
- Add a CI check that `pnpm generate:types` is clean.

### w99 — Regex-to-generated contract test
- The current regex-based test of `IPC_COMMANDS` against `build.rs` becomes redundant once generation covers commands. Replace with a generated-list equality test.

### w100 — Polymorphic-payload typing
- Replace `EventItem.data: serde_json::Value` with tagged union (`#[serde(tag = "type")]`) where possible.
- Same for `SessionIncidentItem.detail_json` and `task_create.input_params` — at least add a runtime validator behind a `#[cfg(debug_assertions)]` assertion.

---

## Phase 13 — Build / CI / tooling

### w101 — Flip clippy + fmt to hard-fail
- CI (`ci.yml`) currently runs `cargo clippy` and `cargo fmt --check` as `continue-on-error`. Flip to hard-fail. Baseline clippy backlog (~40 pre-existing warnings across `tracepilot-core` / `tracepilot-tauri-bindings`) must be zeroed first — do so in this wave across touched files, with `#[allow]` + rationale for anything intentional.
- Add `clippy.toml` with the workspace's chosen thresholds (MSRV, `disallowed-methods`).

### w102 — Biome lint hard-fail
- `biome.json`: flip `noExplicitAny`/`noNonNullAssertion` from `"warn"` to `"error"` except in explicitly-allowed files. Vue override re-enables `noUnusedImports`/`noUnusedVariables`.

### w103 — lefthook expansion
- Add `cargo fmt --check`, `cargo clippy -q`, `pnpm typecheck --changed-only`, and `pnpm vitest run --changed` to the pre-commit / pre-push hooks.

### w104 — `pnpm-workspace.yaml` `catalog:` adoption
- Migrate `vue-router`, `pinia`, `@vueuse/*`, `markdown-it`, `dompurify`, `ts-morph` from per-package-pins to workspace catalog entries. Unifies version drift between `apps/desktop` and `packages/ui`.

### w105 — `copilot-sdk` feature consolidation
- The `default = ["copilot-sdk"]` feature is repeated on 3 crates. Consolidate behind a single workspace feature propagated via `default-features = false` + explicit `features = [...]`.

### w106 — Playwright E2E consolidation
- Root devDeps declare `playwright-core` but no `.spec.ts` tests exist. Consolidate the 13 `scripts/e2e/*.mjs` one-off scripts into `apps/desktop/tests/e2e/*.spec.ts` using Playwright + the existing `tracepilot-app-automation` skill. Gate behind an optional CI job (non-blocking initially).

### w107 — `justfile`
- Mirror `scripts/*.ps1` commands in `justfile` targets. Keep `.ps1` as Windows-specific shims calling `just`. Covers `dev`, `build`, `test`, `release`, `clean`, `lint`, `fmt`.

---

## Phase 14 — Security

### w108 — CSP `'unsafe-inline'` removal
- Dependent on w91 landing. Flip `style-src` in `tauri.conf.json` to `'self'` + per-release nonce. Add a Playwright smoke test that boots the app and scans the console for CSP violations.

### w109 — Crash reporting + telemetry (opt-in)
- Wire `sentry-tauri` behind an off-by-default feature flag, with a privacy note in README and a settings toggle. Endpoint configurable via env-var for self-hosted deployments.

### w110 — Path validation completeness
- Extend `validate_path_within` to cover `launch_session`, `open_in_explorer`, `open_in_terminal`. They currently accept arbitrary paths (audit §3.13).

---

## Phase 15 — Release pipeline

### w111 — Multi-OS build matrix
- Add macOS DMG + Linux AppImage/deb to `release.yml`. Add `SHA256SUMS` per artefact.
- **Blocked until**: signing secrets + notarisation credentials provisioned. Wave ships the workflow scaffolding in a disabled/`if: false` state; user flips the toggle after creds.

### w112 — SBOM + SLSA provenance
- `anchore/sbom-action` emits CycloneDX SBOM per release. `actions/attest-build-provenance` produces SLSA v1.0 attestations. Both attach to the GitHub Release.

### w113 — `git-cliff` → CHANGELOG
- `cliff.toml` exists but isn't wired. Add a `release-prep` workflow that runs `git-cliff` and opens a PR to update `CHANGELOG.md`. Alternative: delete `cliff.toml` and adopt conventional commits manually.

---

## Phase 16 — Docs reorganisation (full)

### w114 — Archive + regroup
- Move every "plan" / "report" / "review" predating today into `docs/archive/2026-04/` (already partially done in w62; this wave completes the sweep).
- Top-level `docs/` regrouped under: `architecture/`, `guides/`, `plans/`, `reports/`, `research/`, `design/`, `archive/`, `security/`.
- `docs/README.md` becomes a generated index (script in `scripts/generate-docs-index.mjs`).

### w115 — ADRs 0001–0006
- 0001: Platforms (Windows-first vs cross-platform stance).
- 0002: FS trust boundary + path-jail policy.
- 0003: CLI runtime (Rust+TS thin wrapper — "Option B").
- 0004: Specta codegen adoption.
- 0005: Structured IPC errors + error-code contract.
- 0006: Migration policy (IndexDb + TaskDb + SessionDb).

### w116 — Prototype purge
- Move `docs/design/prototypes/` (≈2.5 MB HTML) out of the repo (to `tracepilot-design-prototypes` sibling repo or delete). Replace with a link in `docs/design/README.md`.

### w117 — Date fix
- Reports labelled `2026-*` created in 2025 are renamed / date-fields corrected. `scripts/rename-future-dates.mjs` assists.

---

## Phase 17 — CLI "Option B" (full)

### w118 — `tracepilot-core --json` subcommand
- New Rust binary target (`apps/tracepilot-cli` or inside `tracepilot-core`) exposing `list` / `show` / `search` / `resume` / `index` as JSON commands.
- Consumes `TracePilotConfig` via the bindings already in use.

### w119 — CLI TS wrapper rewrite
- `apps/cli` becomes a thin TS wrapper that spawns `tracepilot-core --json` subprocess. Delete duplicate TS discovery / event-reconstruction / search logic.
- `session-path.ts` consumes `TracePilotConfig`.
- `version-analyzer.ts` (1,003 LOC) deleted in favour of reusing `discover_copilot_versions` from Rust.
- Drop `better-sqlite3` dep.
- Delete `dist/` from working tree; confirm gitignore.

### w120 — CLI test parity
- Port the desktop-app integration fixture corpus to CLI so we have CLI-level regression coverage for every TracePilot feature that reasonably supports a headless flow.

---

## Phase 18 — Perf budgets

### w121 — IPC bench harness
- New `tracepilot-bench::ipc` bench that hits the running Tauri app (or a stub runner) through the `@tracepilot/client` surface. Measure invoke round-trip latency for 10 representative commands.
- Wire `perf-budget.json` IPC thresholds to this harness in CI.

### w122 — Frontend render budgets
- Add vitest+jsdom render benches for the top 5 session-detail components. Budget into `perf-budget.json`.

---

## Phase 19 — TODO/FIXME triage

### w123 — TODO sweep
- 510 non-test TODO/FIXME/HACK comments. Triage into: (a) closed inline (fix now); (b) converted to a GitHub issue and comment becomes `// tracked: #NNN`; (c) deleted as obsolete.
- Hard budget: every TODO must have either a fix-date or an issue reference after this wave. A lint rule blocks net-new unanchored TODOs.

---

## Phase 20 — Residual audit items

### w124 — Orchestrator `pub` surface tightening
- Demote `task_ipc`, `task_attribution`, `task_recovery`, `task_context` to `pub(crate)`. Audit other public modules.

### w125 — Config struct split
- `config.rs:24-27` — split disk-TOML shape from IPC-visible shape. Needs a migration for existing configs (backwards-read-only, forwards-write-new).

### w126 — `Semaphore` singleton unification
- Two `Semaphore` singletons for indexing (`lib.rs:36-39`) unified behind a named enum `IndexingConcurrencyGate { Sessions, Files }`.

### w127 — Test-helper consolidation
- `core/src/turns/tests/builders.rs` (954) + `export/src/test_helpers.rs` (122) + `core/src/analytics/test_helpers.rs` (157) promoted into the existing `tracepilot-test-support` crate. `.expect()` over-use in `export/tests/integration.rs` scrubbed.

### w128 — Package README + public-API docs
- `README.md` in every package under `packages/*` and `apps/*`. Documents entry points, invariants, and test commands.

### w129 — `@tracepilot/config` decision
- Either grow it (add `tsconfig` presets, biome configs) or document as a `tsconfig` holder only + remove the plural "presets" claim from its README.

### w130 — `syntaxHighlight.ts` (688 LOC) evaluation
- Hand-rolled regex highlighter is a drift hazard. Evaluate replacement with `shiki` or `highlight.js` (bundle-cost vs correctness). Wave lands the evaluation doc + a feature-flagged swap if the numbers work.

---

## Execution order

Sub-agents pick off waves in approximately the order below unless explicitly re-prioritised. Each wave is self-contained and does not require more than one other wave as a dependency.

1. **Backend decomp** (w63 → w71) — 9 waves. Highest adoption-leverage.
2. **Frontend decomp** (w72 → w78) — 7 waves.
3. **Backend polish** (w79 → w87) — 9 waves.
4. **Frontend polish** (w88 → w97) — 10 waves.
5. **Types / codegen** (w98 → w100).
6. **Build / CI / tooling** (w101 → w107).
7. **Security** (w108 → w110).
8. **Docs** (w114 → w117).
9. **CLI Option B** (w118 → w120).
10. **Perf budgets** (w121 → w122).
11. **TODO sweep** (w123).
12. **Residuals** (w124 → w130).
13. **Release pipeline** (w111 → w113) — last, because blocked on secrets.

Progress is tracked both in this doc (strike-through + ✅ tag) and in the `tech-debt-progress-report-2026-04.md` "commit log" table. SQL todos table in the session DB mirrors the waves for queryable status.

---

*Compiled 2026-04 by Copilot CLI based on the April 2026 tech-debt audit + a fresh monorepo survey.*
