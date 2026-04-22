# Tech-Debt Remediation — Progress Report (April 2026)

**Branch:** `Matt/General_Improvements` (51 commits ahead of `main`, `519 files changed, +57,287 / −35,192`)
**Scope:** Autonomous, wave-based remediation of the TracePilot monorepo driven by the plan documents
[`tech-debt-plan-revised-2026-04.md`](./archive/2026-04/tech-debt-plan-revised-2026-04.md) +
[`tech-debt-audit-2026-04.md`](./archive/2026-04/tech-debt-audit-2026-04.md) +
[`tech-debt-review-consolidation-2026-04.md`](./archive/2026-04/tech-debt-review-consolidation-2026-04.md).
**Status:** Staged locally; **nothing pushed, merged, or stashed**. Held for the author's final review.

---

## Headline metrics

| Metric | Start | Now | Δ |
|---|---:|---:|---|
| Desktop Vitest tests | 1,255 | **1,659** | **+404** |
| Mega-SFCs > 1,000 LOC | 17 | **0** | **−17** |
| Mega stores/composables > 500 LOC (frontend) | 5 | **0** | **−5** |
| `scripts/check-file-sizes.mjs` allowlist entries | ~85 | **61** | **−24** |
| Rust files > 1,000 LOC (non-test) | 2 | **0** | **−2** |
| `@tracepilot/client` monolithic index.ts | 798 LOC | **24 LOC (barrel)** | domain-split |
| Typecheck / build / test regressions | — | **0** on every wave | — |

Every wave gated on: `typecheck`, `vitest run`, `node scripts/check-file-sizes.mjs`, `pnpm --filter @tracepilot/desktop build`,
and for Rust waves additionally `cargo check`, `cargo test`, `cargo clippy -D warnings` (on the touched crate).

---

## What landed — by phase

### Phase 0 — Guard-rails (prerequisite) ✅
Waves 1, 16b. CI matrix, SHA pinning, coverage, a11y smoke, visual-regression harness, migration snapshot fixtures, lint configs.

### Phase 1A — Security & runtime safety hotfixes ✅
Waves 1, 2, 3. Capability scoping (`AllowAllCommands` removed), path-jail + traversal fuzz, structured IPC errors,
viewer UX gates, shell-argv hardening, `getErrorCode` migration, ADR-0003.

### Phase 1B — Single-source-of-truth foundations ✅
Waves 6, 8, 13, 21. `specta + tauri-specta` pilot (session listing), TS key registries
(`routes`, `sidebarIds`, `tuning`, `featureFlags`, `storageKeys`), Rust constants SSoT.

### Phase 2 — Helper adoption sweep (frontend) ✅
Waves 7, 9, 10, 11, 12a, 12b (wontfix). Pinia store helpers codemod, `useInflightPromise` + `usePersistedRef`,
`PageShell` across 13 views, `StatCard`/`TabNav`/`PageHeader`/`SegmentedControl` expansion,
`useAlertWatcher` → Pinia store.

### Phase 3-safety — Backend correctness before decomposition ✅
Waves 15, 17, 18, 19. Unified DB migrator framework, path + process helpers + migrator decomp,
polling/visibility discipline (`usePolling` composable), shared `tracepilot-test-support` fixture crate.

### Phase 3-decomp — Large-file backend decomposition ✅
- **Wave 43** — `commands/tasks.rs` (871 LOC) → `commands/tasks/{crud, jobs, orchestrator, orchestrator_start, ingest, presets}.rs` + `mod.rs`, each ≤ 255 LOC, glob re-exports preserve Tauri `__cmd__*` hidden items; `tauri::generate_handler!` unchanged.
- **Wave 44** — `bridge/manager.rs` (1,145 LOC) → `bridge/manager/{mod, lifecycle, raw_rpc, session_tasks, session_model, queries, ui_server, tests}.rs`. All 24 `BridgeManager` pub methods + free `launch_ui_server` preserved byte-for-byte. Windows `.creation_flags(0x08000000)` invariant preserved.

### Phase 3-polish — Generics + newtypes ✅
Wave 20. `build_session_lru::<T>(cap)` generic, `forward_broadcast<T: Serialize>()` helper,
`SessionId`/`PresetId`/`SkillName` newtypes (surface-level adoption; deep propagation deferred).

### Phase 5.2 — Design tokens into `@tracepilot/ui` ✅
Wave 14.

### Phase 4 — Frontend decomposition ✅ (17/17 mega-SFCs)
All of: `TaskCreateView` (w22), `PresetManagerView` (w23), `ExportView` (w24), `TaskDetailView` (w25),
`WorktreeManagerView` (w26), `OrchestratorMonitorView` (w27), `ConfigInjectorView` (w28),
`SessionLauncherView` (w29), `McpServerDetailView` (w30), `SkillImportWizard` (w31),
`SessionComparisonView` (w32), `ModelComparisonView` (w33), `TodoDependencyGraph` (w34),
`SessionSearchView` (w35), `SkillEditorView` (w36), `AgentTreeView` (w37), `SdkSteeringPanel` (w38).

### Phase 4.3 — Mega stores & composables ✅ (5/5)
- `useSessionDetail.ts` (710 → 290 LOC) — w39, split into `session/{sessionFingerprint,cache,snapshot,useSessionTurnsRefresh,useSessionSections}.ts`
- `stores/search.ts` (621 → 248 LOC) — w40, slices `{query,facets,indexing,maintenance}`
- `stores/sdk.ts` (615 → 198 LOC) — w41, slices `{connection,messaging,settings}`
- `useOrbitalAnimation.ts` (602 → 225 LOC) — w42, pure `utils/orbitalGeometry.ts` + DOM/connections/nodeFactory
- `stores/preferences.ts` (548 → 257 LOC) — w42, slices `{ui,pricing,alerts,featureFlags}` + migration helper
- `useAlertWatcher.ts` — w12a, converted to Pinia store

### Phase 4.4/4.5 — Styling & router (safe subset) ✅
Wave 47.
- `pushRoute()` helper + `ROUTE_NAMES` adoption across 10 call sites
- `useBreadcrumbs.ts` extracted from `App.vue`
- 7 SFCs + 2 shared CSS files: inline `:style` dynamic colors → CSS custom properties
- Hardcoded `#888` → `var(--text-tertiary)` fallback

### Phase 5.1 — `@tracepilot/client` split ✅
Wave 45. `index.ts` (798 → 24 LOC barrel). Domain files: `sessions`, `search`, `analytics`, `export`, `config`, `maint`, `tasks`.
`internal/{core, mockData, optional}.ts`. `toRustOptional()` helper introduced.
**69 named exports preserved byte-for-byte.**

### Phase 5.3/5.4/5.6 — Packages cleanup (safe subset) ✅
Wave 46.
- Promoted `useAsyncData` + `useCachedFetch` to `@tracepilot/ui`; desktop files become thin re-export shims.
- `@tracepilot/ui` barrel: mixed → explicit named re-exports.
- `@tracepilot/types`: `sideEffects: false`; 17× `export *` → explicit named (**215 exports unchanged**).
- `"sideEffects"` fields: `@tracepilot/client` false, `@tracepilot/ui` `["**/*.css"]`.

### Phase 6 — Release / observability / perf / deps (safe subset) ✅
- **Wave 48** — `cliff.toml` status header; dropped implicit `pnpm install` from root `start`; `pnpm-workspace.yaml` catalog (`typescript`, `vitest`, `vue`); Rust `sha2`, `tauri`, `tempfile` hoisted to `[workspace.dependencies]`; CI bundle-analysis + benchmark workflows now **hard-fail** on budget breach (`::warning::` → `::error::` + `exit 1`); `scripts/README.md` index.
- **Wave 49** — `sanitize_error_msg` promoted from `mcp/health.rs` to `tracepilot_core::utils::log_sanitize` (+3 tests); `#[tracing::instrument(skip_all, level=debug, err, fields(...))]` added to 10 highest-traffic Tauri command handlers.

### Phase 7 — Deferred items swept (waves 50–62) ✅
- **Wave 50** — `with_task_db` adoption: migrated `task_create` in `commands/tasks/crud.rs`. Audit of the other 4 candidate sites (ingest/orchestrator) found they deliberately drop the lock between phases to keep I/O off the mutex — left as-is with rationale in the commit body. Deferred-list language was overstated; the helper is only applicable to single-lock-scope closures.
- **Wave 51** — Moved `is_process_alive(pid)` from `commands/tasks/orchestrator.rs` to `tracepilot_orchestrator::process::is_alive`; added unix self-PID liveness test. Windows `CREATE_NO_WINDOW` preserved.
- **Wave 52** — `mcpListServers()` returns `Record<string, McpServerConfig>` (wrapped at the TS boundary via `Object.fromEntries`; Rust payload unchanged).
- **Wave 53** — `createInvoke`/`invokePlugin` accept optional `{ signal?: AbortSignal; timeoutMs?: number }`. Uses `AbortSignal.timeout` + `AbortSignal.any`; documents that the underlying Tauri call cannot be cancelled — we short-circuit the JS-side await only. +5 tests.
- **Wave 54** — `FtsHealthInfo`, `ContextSnippet` moved to `packages/types/src/search.ts`; `SessionHealth` re-exported from the same module for convenience. `@tracepilot/client` re-exports the two types for back-compat so consumers need not migrate in this wave.
- **Wave 55** — `useBootstrapPhase()` composable extracted from `App.vue` (333 → 215 LOC). Owns `AppPhase` state + `onMounted` bootstrap + setup/indexing handlers + version check + idempotent alert system init. `useWindowLifecycle` stays synchronous in `App.vue <script setup>` per Vue 3 `onScopeDispose` rule.
- **Wave 60** — `window.__TRACEPILOT_IPC_PERF__` is no longer installed as a module side-effect. Explicit `enablePerfTracing()` / `disablePerfTracing()` exports are called once from `apps/desktop/src/main.ts` during bootstrap. E2E scripts and the app-automation skill continue to work unchanged (they read after `page.goto`, which always follows bootstrap). +5 tests.
- **Wave 61** — Hoisted `tauri-plugin-{dialog,log,notification,opener,process,updater}` to `[workspace.dependencies]`. Converted diverging `tokio` (`["rt","sync"]` + `["macros","rt-multi-thread"]`) and `uuid = "1"` in `tracepilot-tauri-bindings` to `{ workspace = true }` (features now `["full"]` + `["v4","serde"]` — additive only, no functional regression; `cargo tree -d` clean for all three).
- **Wave 62** — Docs reorg, safe subset: renamed `SECURITY_AUDIT_REPORT.md` → `security-audit-report.md`; moved 11 superseded tech-debt artifacts into `docs/archive/2026-04/`; updated `docs/README.md` with an alphabetical index + subdirectories table; updated 18 internal cross-references across 10 files. Full `architecture/`/`guides/`/`plans/` restructuring + ADRs + prototype removal remain deferred.

**Sweep outcomes that were no-ops** (pre-existing state already matched the plan): `useAsyncData`/`useCachedFetch` desktop shims already gone (Wave 57); `formatters.ts` back-compat shim already gone (Wave 58).

**Sweep items blocked for design review**:
- `useToast` module-singleton → `provide/inject` — blocks `useToastStore` (wraps `useToast()` inside `defineStore`, which runs outside component setup where `inject()` is unavailable). Module singleton is the correct pattern for this codebase's multi-window model; recommend closing as wontfix unless a cross-window toast de-duplication requirement emerges.
- `perf-budget.json` IPC thresholds → `tracepilot-bench` — the bench crate has no IPC benchmark today (parsing/analytics/indexer/batch_size only). Wiring requires building a new IPC bench harness; separate scope from a threshold-wiring task.

---

## What's deferred — roadmap for the next passes

Grouped by theme. Each bullet is its own future wave; all were intentionally skipped because they require design review, security review, or touch behaviour in ways that warrant a dedicated PR.

### Security & CSP
- **Remove `'unsafe-inline'`** from `style-src` in `apps/desktop/src-tauri/tauri.conf.json` once inline styles are < 10. Requires a final styling sweep + CSP-breakage smoke pass.
- **Remove hex fallbacks** in `designTokens.ts:65-78` and `App.vue:339` — unclear whether intentional defaults.
- ~~**Harden migration paths**~~ — ✅ landed in Wave 50 (scope right-sized: only 1 site actually fit `with_task_db`).

### Backend architectural polish
- `cli_url: Option<String>` → `enum ConnectionMode { Stdio, Tcp { url } }` and surface the enum across the `BridgeStatus::connection_mode` IPC payload. Shape-change territory.
- ~~Move `is_process_alive`~~ — ✅ landed in Wave 51.
- Deep propagation of `SessionId`/`PresetId`/`SkillName` newtypes past the IPC validation boundary into internal APIs.
- Regression tests for `unlink_session`/`destroy_session` `.abort()` on `event_tasks`.
- Per-submodule unit tests for `commands/tasks/*` (integration tests currently cover handlers).

### Frontend architectural polish
- ~~**`AppPhase` bootstrap state-machine extraction**~~ — ✅ landed in Wave 55.
- ~~**`useToast`** from module-level singleton → `provide/inject`~~ — ❌ wontfix (Wave 56 investigation): incompatible with `useToastStore` wrapping `useToast()` inside `defineStore`.
- ~~**`formatters.ts` back-compat shim**~~ — ✅ already removed (verified in Wave 58).
- **New UI composables**: `useTheme`, `useKeyboard`, `useLocalStorage` (green-field).
- ~~**Call-site migration** of `@/composables/{useAsyncData,useCachedFetch}`~~ — ✅ already complete (verified in Wave 57).

### IPC / client ergonomics (plan §5.1 deferrals)
- ~~`mcpListServers` returns `Record<string, McpServerConfig>`~~ — ✅ landed in Wave 52.
- ~~`AbortSignal` / timeout support in `createInvoke`~~ — ✅ landed in Wave 53.
- ~~Replace `window.__TRACEPILOT_IPC_PERF__` side-effect import~~ — ✅ landed in Wave 60.
- Unify mock fallback across `sdk.ts`/`mcp.ts`/`skills.ts`, or extract mocks into opt-in `@tracepilot/client-mocks`.
- ~~Move `FtsHealthInfo`/`ContextSnippet`/`SessionHealth` to `@tracepilot/types/src/search.ts`~~ — ✅ landed in Wave 54.

### Types / codegen (plan §5.4 deferrals)
- Post-Phase-1B.1 codegen expansion: delete manual Rust↔TS type mirrors.
- Move `IPC_EVENTS` to `@tracepilot/client` (domain-coupled).
- Add invariant tests for `tasks`/`session`/`models`/`conversation` shapes.

### Observability (plan §6.2 deferrals)
- Opt-in crash reporting (sentry-tauri with self-hosted endpoint or disabled default).
- Telemetry opt-in switch + privacy note in README.
- Sink `window.__TRACEPILOT_IPC_PERF__` to `tracing` behind `tokio-console` feature.
- Expand `#[tracing::instrument]` coverage beyond the current 10 handlers.

### Release pipeline (plan §6.1 deferrals)
- Multi-OS Tauri build matrix (Windows + macOS DMG + Linux AppImage/deb).
- `SHA256SUMS` + SLSA provenance (`actions/attest-build-provenance`) + SBOM (`anchore/sbom-action`).
- Cosign/minisign signing; real `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret.
- Wire `git-cliff` to CHANGELOG generation or delete `cliff.toml`.

### Scripts & cross-platform (plan §6.3 deferrals)
- `justfile` mirroring `.ps1` scripts; keep `.ps1` as Windows shims calling `just`.
- Port `validate-session-versions.py` to Node/TS.
- Consolidate 13 `scripts/e2e/*.mjs` into Playwright tests under `tests/e2e/`.

### Dependency hygiene (plan §6.6 deferrals)
- ~~Finish Rust workspace hoisting for `tokio`, `uuid`, `tauri-plugin-*`~~ — ✅ landed in Wave 61.
- Migrate more packages to the new `pnpm-workspace.yaml` `catalog:` entries.
- Vendor `copilot-sdk` or switch to upstream release tag when available.

### Docs reorganisation (plan §6.4 — entirely deferred)
- `docs/archive/YYYY-MM/` for superseded docs.
- Regroup under `architecture/`, `guides/`, `plans/`, `reports/`, `research/`, `design/`, `archive/`.
- Generated `docs/README.md` index.
- Fix `2026-*` future-dated reports.
- Rename `SECURITY_AUDIT_REPORT.md` → lowercase-hyphenated. ✅ (Wave 62 — now `security-audit-report.md`.)
- Move `docs/design/prototypes/` (~2.5 MB HTML) out of the repo.
- ADRs 0001–0006 (platforms, FS trust boundary, CLI runtime, specta, structured IPC errors, migration policy).

### CLI — Option B (plan §5.5 — entirely deferred)
- New Rust `tracepilot-core --json` subcommand (list/show/search).
- CLI becomes a thin TS wrapper that spawns the Rust binary.
- Delete duplicate TS discovery/reconstruction/search logic.
- Consume `TracePilotConfig` in `session-path.ts`.
- Delete `index` stub + shell-echo `resume`; fix path-separator assumptions in tests.
- Remove checked-in `dist/`.

### Perf budgets (plan §6.5 — partially done)
- Wire `perf-budget.json` IPC thresholds to `tracepilot-bench` IPC bench.

---

## Phase 8 — Rust module decomposition (waves 63–71) ✅

Every file > 900 LOC under `crates/` split into focused submodules with public APIs preserved byte-for-byte.

| Wave | File | Before | After |
|---|---|---:|---:|
| 63 | `search_reader.rs` | 1408 | split into 6 |
| 64 | `process.rs` | 1150 | 6 files + `hidden_command` helper |
| 65 | `index_db/mod.rs` | 1060 | submodules; `open_readonly` delegated to core |
| 66 | `events.rs` | 935 | 5 files |
| 67 | `skills/import.rs` | 918 | 6 files |
| 68 | `mcp/health.rs` | 823 | 5 files |
| 69 | indexer `lib.rs` | 840 | `indexing/` tree |
| 70 | `render/markdown.rs` | — | split; legacy `markdown.rs`/`json.rs` deleted; workspace now `anyhow`-free |
| 71 | reconstructor, config, helpers, validators, commands/session | — | batch decomp |

## Phase 9 — Vue SFC decomposition (waves 72–78) ✅

Every remaining SFC > 600 LOC decomposed. Parent target < 400 LOC; children ≤ 400.

| Wave | Parent | Before → After | Notes |
|---|---|---|---|
| 72 | `TurnWaterfallView.vue` | 967 → 301 | + composable + CSS |
| 73 | `NestedSwimlanesView.vue` | 942 → 222 | per-child scoped CSS |
| 74 | `ChatViewMode.vue` + `SubagentPanel.vue` | 1022 → 368 / 1007 → 300 | + 3 composables |
| 75 | `SearchPalette.vue` + `SetupWizard.vue` | 805 → 376 / 674 → 366 | per-wizard-step scoped CSS |
| 76 | `AnalyticsDashboardView` + `TokenFlowTab` + `MetricsTab` | 764 → 117 / 736 → 109 / 625 → 89 | + Sankey/metrics composables |
| 77 | `PresetDetailSlideover` + `McpAddServerModal` | 766 → 69 / 764 → 82 | |
| 78 | `OrchestrationHomeView.vue` | 703 → 58 | `useLiveClock` composable |

## Phase 10 — Backend polish (waves 79–87) ✅

| Wave | Scope |
|---|---|
| 79 | `ConnectionMode` enum with serde aliases (wire-compat preserved) |
| 80 | Newtype propagation: `PresetId`, `SkillName`, `SessionId` through orchestrator/bindings |
| 81 | `attach_slow_query_profiler!` macro consolidating index+tasks DB profiling |
| 82 | `emit_best_effort` helper (13 sites), rollback-error logging (9), annotated best-effort cleanups |
| 83 | `OrchestratorError::TaskDbMigration` + `TaskDbBackup` variants with `#[source]` |
| 84 | 7 deterministic tests for BridgeManager abort/destroy/resume/unlink idempotence |
| 85 | 74 `#[tracing::instrument]` attrs across Tauri command handlers |
| 86 | `run_async_with_limits` helper: bounded capture + timeout; hardened bridge discovery probes |
| 87 | Scoped-lock rescan (`orchestrator_start.rs`), instrumented spawn sites |

Identified-but-deferred improvements (35+ entries) live in
[`tech-debt-future-improvements-2026-04.md`](./tech-debt-future-improvements-2026-04.md).

## Commit log (latest waves)

```
bf972c70 Wave 87: Async discipline cleanup
7916958d Wave 86: Harden hidden-shell launch sites
d632eaf6 Wave 85: Expand tracing::instrument coverage (74 attrs)
23f1236d Wave 84: SDK subprocess hygiene tests
e6d3f767 Wave 83: Error-variant hardening (TaskDbMigration/Backup)
febe5f5a Wave 82: Mutex-poison + let _ hygiene
8cf540e9 Wave 81: Rust duplication removal (slow-query macro)
e4476859 Wave 80: Deeper newtype propagation
15e9c110 Wave 79: ConnectionMode enum
f28c65aa Wave 78: Decompose OrchestrationHomeView.vue
bda657a0 Wave 77: Decompose PresetDetailSlideover + McpAddServerModal
9ea73bde Wave 76: Decompose Analytics views
0873c329 Wave 75: Decompose SearchPalette + SetupWizard
6f9f269  Wave 74: Decompose ChatViewMode + SubagentPanel
a06bdf27 Wave 73: Decompose NestedSwimlanesView.vue
0b808bf3 Wave 72: Decompose TurnWaterfallView.vue
537c99fc Wave 71: Batch decomp (reconstructor/config/helpers/validators/session)
42f950f5 Wave 70: Decompose render/markdown.rs; delete legacy
5500fd19 Wave 69: Decompose indexer lib.rs
03a3c9e4 Wave 68: Decompose mcp/health.rs
874f08ee Wave 67: Decompose skills/import.rs
e7af0dfa Wave 66: Decompose events.rs
d60c3456 Wave 65: Decompose index_db/mod.rs
d3c25d07 Wave 64: Decompose process.rs
8f002b9c Wave 63: Decompose search_reader.rs
c6163b09 docs: seed tech-debt future-improvements log
4f2478a3 docs: tech-debt master plan (waves 63–130)
5d890e00 Wave 62: Docs reorg (safe subset) — archive superseded tech-debt docs
780d0e59 Wave 61: Hoist tokio/uuid/tauri-plugin-* to workspace dependencies
01f6f18d Wave 60: Replace __TRACEPILOT_IPC_PERF__ side-effect with enablePerfTracing()
c6ba8207 Wave 55: Extract AppPhase bootstrap into useBootstrapPhase()
0c9b22cf Wave 54: Move FTS search types to @tracepilot/types/src/search.ts
898b6168 Wave 53: AbortSignal + timeout support in createInvoke
b85d4a9a Wave 52: mcpListServers returns Record<string, McpServerConfig>
57ed8625 Wave 51: Move is_process_alive → orchestrator::process::is_alive
cf1bac64 Wave 50: Harden migration paths — adopt with_task_db helper
270ed93f Wave 49: Phase 6.2 observability (safe subset)
69d0c9b4 Wave 48: Phase 6 polish (6.1, 6.3, 6.5, 6.6 safe subset)
791b951d Wave 47: Styling + router cleanup (Phase 4.4 + 4.5 safe subset)
a4a14166 Wave 46: Packages cleanup (5.3, 5.4, 5.6 safe subset)
e10955c9 Wave 45: Split @tracepilot/client index.ts (798 -> 24 LOC)
6f934349 Wave 44: Decompose bridge/manager.rs (1145 LOC) into manager/ module
213b143f Wave 43: Decompose commands/tasks.rs (871 LOC) into tasks/ module
64b4e9f7 Wave 42: Decompose preferences store + useOrbitalAnimation
9675769e Wave 41: Decompose stores/sdk.ts
a2eed7af Wave 40: Decompose stores/search.ts
7e549801 Wave 39: Decompose useSessionDetail.ts
64c79ef8 Wave 38: Decompose SdkSteeringPanel.vue
bfddedce Wave 37: Decompose AgentTreeView.vue
c5a44e6d Wave 36: Decompose SkillEditorView.vue
1c7076f7 Wave 35: Decompose SessionSearchView.vue
6487688c Wave 34: Decompose TodoDependencyGraph.vue
14ccc36f Wave 33: Decompose ModelComparisonView.vue
4d3a39cb Wave 32: Decompose SessionComparisonView.vue
0675232c Wave 31: Decompose SkillImportWizard.vue
e4c50236 Wave 30: Decompose McpServerDetailView.vue
48db5551 Wave 29: Decompose SessionLauncherView.vue
a117f8dd Wave 28: Decompose ConfigInjectorView.vue
f0f43f15 Wave 27: Decompose OrchestratorMonitorView.vue
96467bda Wave 26: Decompose WorktreeManagerView.vue
6ea9204d Wave 25: Decompose TaskDetailView.vue
acb25528 Wave 24: Decompose ExportView.vue
6a5f880c Wave 23: Decompose PresetManagerView.vue
```

(Earlier commits for waves 1–22 are in the branch history — they correspond to Phase 0, 1A, 1B, 2, 3-safety, 3-polish, and the Phase 4 pilot.)

---

## Invariants preserved across every wave

These were explicitly verified in the relevant waves and are repo-wide assumptions going forward:

- **Windows CMD-flash prevention**: every background `Command::new()` uses `.creation_flags(0x08000000)` (`CREATE_NO_WINDOW`). See `crates/tracepilot-orchestrator/src/bridge/discovery.rs`, `bridge/manager/ui_server.rs`, `commands/tasks/orchestrator.rs`, `orchestrator/src/process.rs`.
- **SDK `session.resume` is never auto-called**: only explicit user action triggers it. `isActive` gate + `resolvedSessionId` are canonical.
- **Tauri command splits use glob re-exports** (`pub use submod::*`) so the hidden `__cmd__*` items generated by `#[tauri::command]` are resolvable by path in `tauri::generate_handler!`.
- **Tauri ACL**: any new command must be added to `apps/desktop/src-tauri/build.rs` `InlinedPlugin::commands()` list.
- **Stores preserve public setup-store API byte-for-byte** when decomposed into slices — slice factories are composed inside the orchestrator and every key is re-spread into the return object.

---

## Phase 11 — Frontend composables, mocks, and IPC plumbing (waves 88–100) ✅

Follow-up sweep targeting the green-field composables identified in the §"Frontend architectural polish" deferred list, plus the `@tracepilot/client` mock/IPC tidy-ups that were blocked on earlier decomposition.

| Wave | SHA | Summary |
|---|---|---|
| 88 | `829edc0b` | Add `useTheme` / `useKeyboard` / `useLocalStorage` composables (green-field from plan §4.3). |
| 89 | `0f48598c` | Unify mock / browser fallbacks across `sdk.ts` / `mcp.ts` / `skills.ts` behind a single helper. |
| 90 | `51c0cd64` | Move `IPC_EVENTS` registry into `@tracepilot/client` (domain-coupled with command registry). |
| 91 | `7b516116` | Final inline-`:style` + hex-fallback sweep; prerequisite for dropping `'unsafe-inline'`. |
| 92 | `ee5e99a1` | Final `runMutation` / `runAction` adoption sweep across remaining call sites. |
| 93 | `0467ab38` | `router.push` literals → `ROUTE_NAMES`; introduce feature-flag registry. |
| 94 | `645c555c` | Centralise dynamic Tauri imports behind a single gateway module. |
| 95 | `5f07797b` | Store-mutation-from-component clean-up (actions only, no direct `store.x = …`). |
| 96 | `2305f5fe` | `shallowRef` adoption for large immutable shapes (measurable paint wins). |
| 97 | `1ca19f5d` | `usePolling` → visibility-gated variant; pauses background tabs. |
| 98 | `fd9c2d73` | Expand `specta` codegen coverage; shrinks manual Rust ↔ TS type mirrors. |
| 99 | `9eae079e` | Replace `IPC_COMMANDS` regex test with generated-equality contract test. |
| 100 | `cb8aa9c7` | Tighter polymorphic-payload typing (`narrowSessionEvent`). |

**Highlights**
- All §"Frontend architectural polish" green-field composables from the Phase-7 deferred list are now landed.
- `@tracepilot/client` IPC registry (commands + events) is fully owned by one package; contract test guards Rust ↔ TS drift.
- Inline-style sweep reduces the number of blockers for a future CSP `'unsafe-inline'` removal (tracked in future-improvements).

**Gates:** `typecheck`, `vitest run`, `cargo check`/`test`/`clippy -D warnings` on touched crates, `pnpm --filter @tracepilot/desktop build`, `node scripts/check-file-sizes.mjs` — all green on every wave.

---

## Phase 12 — CI hard-fail, tooling, security, and dep hygiene (waves 101–108, 110, 115, 121, 122, 128) ✅

Flipping the lint/format guards from soft-warn to hard-fail, converging local/CI tooling, and landing the deferred security + docs items.

| Wave | SHA | Summary |
|---|---|---|
| 101 | `bcf5da41` | Flip `clippy -D warnings` + `cargo fmt --check` to hard-fail in CI. |
| 102 | `cdadf588` | Flip Biome to hard-fail (warns → errors; +one allow-listed `ts.store`, see `check-file-sizes.mjs`). |
| 103 | `3a366b1f` | Expand `lefthook` hooks (pre-commit + pre-push parity with CI). |
| 104 | `c6d42dac` | Adopt `pnpm` `catalog:` across workspace for shared dep versions. |
| 105 | `e84a4ffd` | Consolidate `copilot-sdk` cargo features; drop dead combinations. |
| 106 | `90804856` | Playwright E2E consolidation plan (docs-only hand-off; scripts under `scripts/e2e/*.mjs` remain). |
| 107 | `a9e3a9a9` | `justfile` for consolidated dev tasks (mirrors the surviving `.ps1` helpers). |
| 108 | `99efdd3b` | Tighten Tauri CSP with additional hardening directives (`'unsafe-inline'` removal is still future-work — see w91 prerequisite). |
| 110 | `e4155382` | Path validation completeness — last-mile coverage on IPC boundary. |
| 115 | `c02b45d4` | ADRs 0001–0006 landed (platforms, FS trust boundary, CLI runtime, specta, structured IPC errors, migration policy). |
| 121 | `8575bbcc` | IPC bench harness in `tracepilot-bench`; finally unblocks the `perf-budget.json` IPC thresholds (plan §6.5). |
| 122 | `08515ba4` | Frontend render budgets (dev-only guard). |
| 128 | `de483132` | Per-package / per-crate `README.md`s. |

**Highlights**
- `clippy` / `fmt` / biome are all **hard-fail** — no more warn-drift.
- `justfile` + expanded `lefthook` + CI hard-fail mean a dev who runs `just ci` locally gets the exact CI verdict before pushing.
- The `perf-budget.json` → `tracepilot-bench` IPC wiring (previously listed as "Perf budgets — partially done") is now fully wired via the w121 harness.
- ADRs 0001–0006 replace the ad-hoc design notes scattered across `docs/`; they are the canonical reference for platform scope, FS trust boundary, CLI runtime, specta, structured IPC errors, and migration policy.

**Gates:** identical matrix to Phase 11; hard-fail flip in w101/w102 was run against a clean tree before merge.

---

## Phase 13 — Final polish: benchmarks, budgets, sweeps, and audits (waves 123–127, 130) ✅

Closing sweep. Two of these intentionally concluded as "no change needed" after audit — recorded with rationale.

| Wave | SHA | Summary |
|---|---|---|
| 123 | `c901ec39` | TODO sweep across the repo; remaining TODOs categorised in `tech-debt-future-improvements-2026-04.md`. |
| 124 | `d136c143` | Orchestrator pub-surface tightening (`pub` → `pub(crate)` where possible). |
| 125 | `3df8150b` | Config struct split audit — **finding: already well-grouped**, no split needed. Rationale captured in the commit body. |
| 126 | `24c69e77` | Semaphore singleton unification (one `Arc<Semaphore>` source of truth across orchestrator + bindings). |
| 127 | `8c8ec6e8` | Test-helper consolidation into `tracepilot-test-support`. |
| 130 | `fa576f9b` | `syntaxHighlight.ts` evaluation — **keep as-is** (docs-only; rationale in commit body). |

**Highlights**
- The repo ends the cycle with the orchestrator owning a single semaphore, one test-support crate, and a documented audit trail for the two audits that concluded "no change".
- Remaining low-priority items are parked in [`tech-debt-future-improvements-2026-04.md`](./tech-debt-future-improvements-2026-04.md) (140+ entries across all phases).

**Gates:** identical matrix to Phase 11/12; `check-file-sizes.mjs` still passes with 50 allow-listed violations (monotonically ↓ vs. the 61 at end of Phase 7).

---

## Deferred / skipped waves (this session)

These wave slots were reviewed and explicitly deferred during the session. Each is documented in a hand-off doc so a future engineer can pick them up cleanly.

| Wave | Title | Disposition |
|---|---|---|
| w109 | Crash / telemetry (opt-in sentry-tauri + telemetry switch) | Skipped — needs privacy-policy review. See [`handoff-deferred-items-2026-04.md`](./handoff-deferred-items-2026-04.md). |
| w111 | Multi-OS release matrix (Windows + macOS DMG + Linux AppImage/deb) | Skipped — owned by release eng. See hand-off. |
| w112 | SBOM + SLSA provenance + cosign signing | Skipped — owned by release eng / security. See hand-off. |
| w113 | `git-cliff` CHANGELOG wiring (or delete `cliff.toml`) | Skipped — pending decision. See hand-off. |
| w114 | Docs regroup (`architecture/` / `guides/` / `plans/` / `reports/` / `research/` / `design/` / `archive/`) | Skipped — large restructuring, separate PR. See hand-off. |
| w116 | `docs/design/prototypes/` (~2.5 MB HTML) purge | Skipped — pending owner sign-off. See hand-off. |
| w117 | Future-dated report filenames (`2026-*`) normalise | Skipped — depends on w114. See hand-off. |
| w118–w120 | CLI "Option B" (Rust-backed CLI; delete duplicate TS discovery/search; remove checked-in `dist/`) | Deferred — full hand-off in [`handoff-cli-option-b-2026-04.md`](./handoff-cli-option-b-2026-04.md). |
| w129 | `@tracepilot/config` package decision | Skipped — needs design review. See [`handoff-deferred-items-2026-04.md`](./handoff-deferred-items-2026-04.md). |

Additional low-priority items identified during waves 88–130 (140+ entries across security, backend polish, frontend polish, IPC ergonomics, types/codegen, observability, release, scripts, deps, docs, and perf) are enumerated in [`tech-debt-future-improvements-2026-04.md`](./tech-debt-future-improvements-2026-04.md).

---

## Session wrap

- **Total commits this session (w88 → w130, inclusive of hand-off + docs commits):** 33 commits between `6261c6d2..fa576f9b` on `Matt/Opus47_TechDebt_Continued`.
- **Branch state:** `Matt/Opus47_TechDebt_Continued`, staged locally. **Nothing pushed.** Last pushed commit is `645c555c` (Wave 94) on `origin/Matt/Opus47_TechDebt_Continued`; everything after that is local-only pending author review.
- **How to review:**
  ```pwsh
  git --no-pager log --oneline 6261c6d2..HEAD
  git --no-pager log 6261c6d2..HEAD        # full messages / rationale
  git --no-pager diff 6261c6d2..HEAD --stat
  ```
- **Remaining items owned by others / deferred:** see [`handoff-cli-option-b-2026-04.md`](./handoff-cli-option-b-2026-04.md) (CLI Option B — w118–w120) and [`handoff-deferred-items-2026-04.md`](./handoff-deferred-items-2026-04.md) (w109, w111, w112, w113, w114, w116, w117, w129). Low-priority follow-ups across all phases live in [`tech-debt-future-improvements-2026-04.md`](./tech-debt-future-improvements-2026-04.md).

