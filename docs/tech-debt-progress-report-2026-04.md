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
| Desktop Vitest tests | 1,255 | **1,628** | **+373** |
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

---

## What's deferred — roadmap for the next passes

Grouped by theme. Each bullet is its own future wave; all were intentionally skipped because they require design review, security review, or touch behaviour in ways that warrant a dedicated PR.

### Security & CSP
- **Remove `'unsafe-inline'`** from `style-src` in `apps/desktop/src-tauri/tauri.conf.json` once inline styles are < 10. Requires a final styling sweep + CSP-breakage smoke pass.
- **Remove hex fallbacks** in `designTokens.ts:65-78` and `App.vue:339` — unclear whether intentional defaults.
- **Harden migration paths** — currently 5 call sites in the Tauri bindings still do `spawn_blocking { db.lock() … }` instead of the canonical `with_task_db` helper.

### Backend architectural polish
- `cli_url: Option<String>` → `enum ConnectionMode { Stdio, Tcp { url } }` and surface the enum across the `BridgeStatus::connection_mode` IPC payload. Shape-change territory.
- Move `is_process_alive` from `commands/tasks/orchestrator.rs` to `orchestrator::process::is_alive` (cross-crate).
- Deep propagation of `SessionId`/`PresetId`/`SkillName` newtypes past the IPC validation boundary into internal APIs.
- Regression tests for `unlink_session`/`destroy_session` `.abort()` on `event_tasks`.
- Per-submodule unit tests for `commands/tasks/*` (integration tests currently cover handlers).

### Frontend architectural polish
- **`AppPhase` bootstrap state-machine extraction** from `App.vue:30` into `useBootstrapPhase()`.
- **`useToast`** from module-level singleton → `provide/inject`.
- **`formatters.ts` back-compat shim** removal after migrating call sites.
- **New UI composables**: `useTheme`, `useKeyboard`, `useLocalStorage` (green-field).
- **Call-site migration** of `@/composables/{useAsyncData,useCachedFetch}` → `@tracepilot/ui` (shims in place; batch rename pending).

### IPC / client ergonomics (plan §5.1 deferrals)
- `mcpListServers` returns `Record<string, McpServerConfig>` (wrap tuple response).
- `AbortSignal` / timeout support in `createInvoke`.
- Replace `window.__TRACEPILOT_IPC_PERF__` side-effect import with explicit `enablePerfTracing()`.
- Unify mock fallback across `sdk.ts`/`mcp.ts`/`skills.ts`, or extract mocks into opt-in `@tracepilot/client-mocks`.
- Move `FtsHealthInfo`/`ContextSnippet`/`SessionHealth` to `@tracepilot/types/src/search.ts`.

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
- Finish Rust workspace hoisting for `tokio`, `uuid`, `tauri-plugin-*` (features currently diverge across crates).
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

## Commit log (latest 27 waves)

```
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
