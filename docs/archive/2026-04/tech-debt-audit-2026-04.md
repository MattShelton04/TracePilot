# TracePilot Tech-Debt & Architecture Audit — April 2026

**Generated:** 2026-04-16
**Scope:** Full monorepo — Rust backend (6 crates + `src-tauri`), Vue 3/TypeScript frontend (desktop app + CLI + 5 shared packages), cross-cutting tooling (CI, scripts, docs, build, release).
**Method:** Four parallel Claude Opus 4.7 exploration agents with distinct scopes, grounding every claim in `file:line` evidence. This report supersedes the earlier `tech-debt-report.md`, `tech-debt-consolidation-report.md`, `tech-debt-report-review.md`, and `tech-debt-future-improvements.md`.
**Context:** This project has been developed primarily via AI "vibe-coding" sessions. The goal of this audit is to enumerate the accumulated architectural drift so a deliberate consolidation/modernization pass can bring the repo to a maintainable, single-source-of-truth baseline.

> **⚠️ Revision note (post peer-review):** This audit was peer-reviewed by three independent models (Claude Opus 4.7, GPT-5.4, GPT-5.3-Codex). Directional findings are confirmed, but several specific LOC counts and adoption-gap claims had drifted since the initial audit. See [`tech-debt-review-consolidation-2026-04.md`](./tech-debt-review-consolidation-2026-04.md) §1 for the authoritative corrections table. Most-material corrections:
> - `check_session_freshness` **IS** present in `build.rs:11` (not missing).
> - Vue SFCs >1000 LOC: **17** (not 20+).
> - `PageShell` adopted in **≥4** views; `StatCard` in **≥11** views; `TabNav` is imported by `SessionDetailPanel`.
> - `spawn_blocking` duplication in `commands/tasks.rs`: **10×** (not "≥14"); half already migrated to `with_task_db`.
> - `packages/client/src/index.ts` is **~798 LOC** (not 883).
> - The plan's reference to `packages/types/src/commands.ts` is wrong — the hand-maintained registry is at `packages/client/src/commands.ts`.
> - Peer-review also surfaced missing items (MCP SSRF surface, migration fixture tests, listener ownership, cross-platform CI parity, a11y tooling, i18n policy) — all incorporated into the revised plan [`tech-debt-plan-revised-2026-04.md`](./tech-debt-plan-revised-2026-04.md).

---

## Table of Contents

1. [Executive Summary — Top 20](#1-executive-summary)
2. [Cross-Cutting Themes](#2-cross-cutting-themes)
3. [Rust Backend Findings](#3-rust-backend-findings)
4. [Frontend Desktop Findings](#4-frontend-desktop-findings)
5. [Shared Packages & CLI Findings](#5-shared-packages--cli-findings)
6. [Build / CI / Release / Docs Findings](#6-build--ci--release--docs-findings)
7. [Largest Files Index](#7-largest-files-index)
8. [Missing Capabilities Checklist](#8-missing-capabilities-checklist)

Severity legend: 🔴 High · 🟡 Medium · 🟢 Low.

---

## 1. Executive Summary

The repo is well-structured at the macro level (monorepo, crate/package boundaries, shared types, design tokens, component library) but has significant **single-source-of-truth (SSoT)**, **adoption-gap**, and **oversized-file** problems typical of AI-assisted development:

| # | Severity | Theme | Blast radius |
|---|---|---|---|
| 1 | 🔴 | **No Rust↔TS codegen** (no `ts-rs`/`specta`/`typeshare`). ~150 IPC commands, ~40 DTOs, 10+ event names, feature-flag keys, model IDs, error codes all hand-mirrored. | Every layer |
| 2 | 🔴 | **Tauri command names duplicated 2–3×** (`build.rs` list, `generate_handler!` macro, TS `commands.ts`, per-capability). Silent drift risk. | IPC boundary |
| 3 | 🔴 | **Capability permissions = `AllowAllCommands`** for every window (incl. `viewer-*`). No per-window scoping for destructive ops like `factory_reset`, `rebuild_search_index`. | Security |
| 4 | 🔴 | **33 Rust files >500 LOC** (top: `search_reader.rs` 1413, `bridge/manager.rs` 1132, `index_db/mod.rs` 1060, `events.rs` 933, `commands/tasks.rs` 886). God-modules fuse SQL/domain/tests/state machines. | Backend |
| 5 | 🔴 | **20+ Vue SFCs >1000 LOC** (top: `PresetManagerView.vue` 2365, `ConfigInjectorView.vue` 2020, `WorktreeManagerView.vue` 1990, `AgentTreeView.vue` 1928). Typically fuse list+modal(s)+filter+style in one file with 600–1100 LOC of scoped CSS. | Frontend |
| 6 | 🔴 | **Helper-adoption gap**: `runAction`/`runMutation`, `useAsyncData`, `PageShell`, `StatCard`, `SectionPanel`, `TabNav`, `SegmentedControl`, `FilterSelect`, `ErrorState`, `EmptyState` all exist — but only 1–3 views/stores use each. ~90 manual `toErrorMessage(e)` try/catch sites across 13 stores. | Frontend |
| 7 | 🔴 | **CI is dangerously thin**: clippy, fmt-check, biome lint, cargo-audit, pnpm-audit all disabled or absent (`ci.yml:71-80`); Ubuntu-only despite Windows-first app; release builds Windows-only, no checksums/SBOM/provenance. Dependabot disabled (`dependabot.yml:34`). | Infra |
| 8 | 🔴 | **Error handling collapses to `String` at IPC**: `BindingsError::serialize` (`error.rs:73-80`) flattens the entire thiserror layered error chain to plain text. `AlreadyIndexing` is detected by frontend via substring match on `"ALREADY_INDEXING"`. | IPC |
| 9 | 🔴 | **String-soup SSoT violations**: hardcoded route paths (10+), `sidebarId` (25+), feature-flag keys, localStorage keys (≥9 distinct, mixed `tracepilot-*` / `tracepilot:*` naming), magic numbers (`MAX_EVENTS`, `POLL_FAST_MS`, `REFRESH_THROTTLE_MS`, `DEFAULT_MODEL`, etc.). | Frontend |
| 10 | 🔴 | **Legacy export modules** (`export/src/markdown.rs` 434 LOC, `export/src/json.rs`) coexist with `export/src/render/{markdown,json}.rs` — comment says "kept until Phase A2". Sole `anyhow` usage in workspace is in the legacy file. | Backend |
| 11 | 🔴 | **`spawn_blocking` + `SharedTaskDb` lock pattern reimplemented ≥14× in `commands/tasks.rs`** despite `helpers::with_task_db` / `blocking_cmd!` doing exactly that. | Backend |
| 12 | 🔴 | **Module-singleton state in `useAlertWatcher.ts`** (8 module-level mutable refs). Not a Pinia store. Defensive `alertInitDone` guard in `App.vue` compensates. | Frontend |
| 13 | 🔴 | **Design tokens live in `apps/desktop/src/styles/design-tokens.css`, not `@tracepilot/ui`** — yet `@tracepilot/ui` components reference `var(--text-placeholder)` etc. The UI package is unusable without the desktop app. No `tokens.css` export, no docs. | Packages |
| 14 | 🔴 | **`packages/client/src/index.ts` is 883 LOC / 28 KB kitchen-sink**: public API + 29 KB of inline mock fixtures + leaked types (`FtsHealthInfo`, `ContextSnippet`) + a `getHealthScores` STUB that bypasses invoke entirely. | Packages |
| 15 | 🔴 | **CLI (`apps/cli`) duplicates backend logic in TS**: session discovery, workspace.yaml parsing, turn reconstruction from `events.jsonl` are all re-implemented. Does not consult `TracePilotConfig`. `index` is a stub. Huge drift with desktop. | CLI |
| 16 | 🔴 | **Page shell / stat card duplication**: `<div class="page-content"><div class="page-content-inner">` hand-rolled in 16 views despite `PageShell` existing; raw `.stat-card` HTML in 6 views despite `StatCard` existing. | Frontend |
| 17 | 🔴 | **Six mega-composables/stores >300 LOC**: `useSessionDetail.ts` 698, `search.ts` 668, `sdk.ts` 615, `useOrbitalAnimation.ts` 602, `preferences.ts` 548, `useAlertWatcher.ts` 451. | Frontend |
| 18 | 🔴 | **Shell-injection surface on Windows**: `run_hidden_shell` (`process.rs:226`) feeds a raw string to `powershell -Command`; plus inline `Command::new("where"/"ps"/"lsof"/"ss"/...)` reimplemented in `bridge/discovery.rs` (4 sites). | Security |
| 19 | 🔴 | **Docs folder is unmanaged**: ~45 flat files, overlapping tech-debt reports (4), SDK reports (5), implementation plans (3), AI-task docs (3); no `docs/archive/`; stale `docs/README.md` index; future-dated reports (`2026-*` → probably `2025`); 2.5 MB of HTML prototypes live in `docs/`. | Docs |
| 20 | 🟡 | **Schema migrations duplicated**: `IndexDb` has `run_migrations`; `TaskDb` rolls its own in `task_db/mod.rs:66-103`. Two different `schema_version` conventions. | Backend |

---

## 2. Cross-Cutting Themes

1. **No contract codegen.** The biggest force-multiplier for every other class of tech-debt below is the lack of generated Rust↔TS contracts. Adopting `specta` + `tauri-specta` (or `ts-rs` + `typeshare`) alone would collapse SSoT violations #1, #2, #4, and parts of #8, #13.
2. **Helper adoption gap.** The codebase already ships the right abstractions (`runAction`, `useAsyncData`, `PageShell`, `StatCard`, `with_task_db`, `blocking_cmd!`, `configure_connection`). New code rarely adopts them. Classic vibe-coded symptom: each generation re-invents yesterday's solution.
3. **"Bigger-is-worse."** Every >1000 LOC SFC contains ≥4 separable concerns plus 600–1100 LOC of per-file CSS. Every >700 LOC Rust file fuses domain/state/SQL/tests. Rule-of-thumb not enforced anywhere.
4. **String soup.** Route names, feature flags, sidebar IDs, localStorage keys, IPC event names, model IDs, tab IDs, command names, permission IDs — all stringly typed and duplicated in multiple places.
5. **Defensive singletons via module state.** `useAlertWatcher` module refs + `App.vue alertInitDone` guard point to Pinia-avoidance in an otherwise Pinia-first app.
6. **Style drift.** Inline `:style`, inline `style="…"`, 6 separate hex-fallback palettes (`designTokens.ts`, `AgentTreeView.vue`, `SearchResultCard.vue`, chart utils) make theme switching fragile and prevent tightening the Tauri CSP.
7. **Error-layer decoration.** Rust has 8 layered `thiserror` enums that all flatten to `String` at the IPC edge — the layered design is mostly decorative.
8. **Test coverage hole at the SFC layer.** Stores are well tested; the very views that most need decomposition (`PresetManagerView`, `ConfigInjectorView`, `SdkSteeringPanel`, `SessionLauncherView`) have zero component coverage.
9. **Platform story ambiguous.** README says Windows-only; CI says Ubuntu-only; release says Windows-only. Scripts are Windows-biased (7 `.ps1` vs 1 `.sh`). Either commit fully to cross-platform or fully to Windows-only.
10. **"Late migration" comments persist** (export legacy modules "Phase A2", `formatTokens` back-compat alias, `formatters.ts` shim in `@tracepilot/ui`). Comment-driven tech debt.

---

## 3. Rust Backend Findings

### 3.1 Oversized files (>500 LOC)

| LOC | File | Decomposition suggestion |
|---:|---|---|
| 1413 | `crates/tracepilot-indexer/src/index_db/search_reader.rs` | → `search_reader/{query_builder, facets, browse, tests}.rs` |
| 1132 | `crates/tracepilot-orchestrator/src/bridge/manager.rs` | → `bridge/{lifecycle, raw_rpc, session_tasks, ui_server, tests}.rs` |
| 1060 | `crates/tracepilot-indexer/src/index_db/mod.rs` | Move bodies to submodules; keep mod.rs as re-export hub |
| 933 | `crates/tracepilot-core/src/parsing/events.rs` | → `events/{raw, typed, tests}.rs` |
| 907 | `crates/tracepilot-orchestrator/src/skills/import.rs` | Split per import source (local/GitHub/file) |
| 892 | `crates/tracepilot-core/src/turns/tests/builders.rs` | Promote to `tracepilot-test-support` dev-dep crate |
| 886 | `crates/tracepilot-tauri-bindings/src/commands/tasks.rs` | → `tasks/{crud, jobs, orchestrator, ingest, presets}.rs` |
| 840 | `crates/tracepilot-indexer/src/lib.rs` | Move body into `crate::indexing` submodule |
| 839 | `crates/tracepilot-orchestrator/src/process.rs` | → `process/{hidden, terminal, timeout}.rs` |
| 811 | `crates/tracepilot-orchestrator/src/mcp/health.rs` | Stdio vs HTTP probes into separate files |
| 756 | `crates/tracepilot-indexer/src/index_db/session_writer.rs` | Split upsert / pruning / analytics |
| 751 | `crates/tracepilot-tauri-bindings/src/config.rs` | Per sub-config file + defaults module |
| 713 | `crates/tracepilot-tauri-bindings/src/helpers.rs` | → `helpers/{path, db, cache, emit}.rs` |
| 661 | `crates/tracepilot-orchestrator/src/task_db/operations.rs` | Split per entity (tasks/jobs/results/stats) |
| 658 | `crates/tracepilot-tauri-bindings/src/validators.rs` | Extract rules + tests submodules |

Plus 18 more files 500–650 LOC — see §7.

### 3.2 Duplicated logic 🔴

- **PRAGMA setup:** `core::utils::sqlite::configure_connection` centralized; `IndexDb::open_readonly` (`indexer/src/index_db/mod.rs:95`) re-implements busy_timeout instead.
- **`CREATE_NO_WINDOW = 0x08000000`:** canonical in `orchestrator/src/process.rs:25` but `pub(crate)`. `tauri-bindings/src/commands/tasks.rs:710` uses the literal instead. Fix: make `pub` or expose `process::hidden_command()` helper.
- **Shell command spawn boilerplate:** inline `Command::new("where"/"which"/"powershell")` reimplemented in `bridge/manager.rs:807-840` and `bridge/discovery.rs:65,137,201,228` despite `process::run_hidden_stdout` existing.
- **`spawn_blocking` + `SharedTaskDb` lock pattern:** `commands/tasks.rs` has 14 hand-rolled expansions of what `helpers::with_task_db` already does.
- **LRU cache constructors:** Turn-cache vs event-cache constructors duplicated verbatim (`tauri-bindings/src/lib.rs:40-50`). Should be a generic `build_session_lru::<T>()`.
- **Broadcast→Tauri-emit forwarder:** duplicated twice (event vs status) in `tauri-bindings/src/lib.rs:69-103`. Extract `forward_broadcast<T: Serialize>`.
- **Atomic install helpers:** `atomic_json_write` (`orchestrator/src/json_io.rs:17`) and `atomic_dir_install` (`orchestrator/src/skills/import.rs:32`) implement write-to-temp-then-rename separately.
- **Schema migration runner:** `IndexDb` uses `run_migrations`; `TaskDb` rolls its own (`task_db/mod.rs:66-103`). Consolidate behind a `core::utils::sqlite::Migrator` trait.

### 3.3 Single-source-of-truth violations 🔴

- **Command-name list in 2 places:** `apps/desktop/src-tauri/build.rs:7-175` and `crates/tracepilot-tauri-bindings/src/lib.rs:108-282`. Also the TS `packages/client/src/commands.ts`. 161 vs 178 count drift already visible.
- **`default_cli_command()` = `"copilot"`** duplicated in `tauri-bindings/src/config.rs:357` and `orchestrator/src/types.rs:102`. Canonicalize in `tracepilot-core::constants`.
- **`default_subagent_model()`** cloned through 10+ call sites in `commands/tasks.rs`.
- **Connection profiling:** same `conn.profile(...)` 10ms slow-query block in `indexer/src/index_db/mod.rs:63-74` and `orchestrator/src/task_db/mod.rs:45-54`. Different log messages. Fold into `core::utils::sqlite::attach_slow_query_profiler`.
- **SQLite read-only opening** reimplemented: `core::utils::sqlite::open_readonly` (`:65`) vs `IndexDb::open_readonly` (`indexer/src/index_db/mod.rs:88-99`).

### 3.4 Weak abstractions / missing design patterns 🔴

- **God module `bridge/manager.rs`** (1132): state machine + RPC + session map + event fan-out + UI-server launcher.
- **God module `commands/tasks.rs`** (886): CRUD + orchestrator lifecycle + PID liveness + manifest mutation + ingestion. `is_process_alive` (`:701`) shouldn't live in a Tauri command module.
- **No `BlockingCommand` trait.** `blocking_cmd!` macro + `with_task_db` helper + hand-rolled `spawn_blocking` coexist.
- **Newtype opportunities:** `SessionId`, `PresetId`, `SkillName`, `RepoId` are all `String`. `validate_session_id` returns `()` instead of a `SessionId`.
- **Strategy pattern bypassed:** `ExportRenderer` trait exists in `render/mod.rs`; legacy `export/src/{markdown,json}.rs` bypass it.
- **Tight crate coupling:** `tracepilot-orchestrator` depends on `tracepilot-export` only for one error variant — reverse the direction.
- **Excessive `pub` surface in orchestrator** (`pub mod` count = 21). Demote internals (`task_ipc`, `task_attribution`, `task_recovery`, `task_context`) to `pub(crate)`.
- **Config struct serves both TOML and IPC** (`config.rs:24-27`). Pins IPC-visible shape to disk format.

### 3.5 Tauri command layer 🔴

- **Capability default-allow-all:** `build.rs:176` `.default_permission(AllowAllCommands)` + `capabilities/default.json:4` windows `["main", "viewer-*"]` — every window gets every command.
- **Command list duplication** (see 3.3).
- **Missing commands:** `check_session_freshness` in `lib.rs:114` is absent from `build.rs` command list. Masked by AllowAllCommands.
- **`SharedTaskDb` cross-await `std::sync::Mutex`** (`types.rs:10`). Risk of !Send futures if `.await` sneaks between lock and drop.
- **`with_session_path` vs `with_task_db` inconsistent API** (`helpers.rs:29` vs `:115`). Unify behind one `with_state<S,T>`.
- **Sparse `#[tracing::instrument]`:** <30 places across ~150 commands. Spans at IPC boundary are the most valuable spans.
- **No uniform argument validation.** `task_create` validates only `preset_id`; missing enum/range/structural checks. By contrast `commands/session.rs` uses `validate_session_id`.

### 3.6 Error handling 🔴

- **Mutex-poison swallowing:** `helpers.rs:78-82` logs then returns default config; `commands/session.rs:39-41,61-63` (event cache) same pattern.
- **`let _ = …` proliferation:** 20+ sites in non-test code; `tauri-bindings/src/lib.rs:78,95` ignores emit failures.
- **Panics:** `orchestrator/src/process.rs:811` `panic!("invalid base64")` — in test module today but dangerous if hoisted.
- **Stringly-typed error variants:** `AlreadyIndexing` serialized as `"ALREADY_INDEXING"` (`error.rs:63-64`), forcing substring match on frontend.
- **IPC error collapse:** `BindingsError::serialize` flattens all 13 variants to a single `String`, defeating the layered error design.
- **`OrchestratorError::TaskDb(#[from] rusqlite::Error)`** blanket wrapper misattributes unrelated SQLite errors as "Task database error".

### 3.7 Async / concurrency 🟡

- **`get_or_init_task_db`** locks `std::sync::Mutex` on async executor thread (`helpers.rs:93-107`) and does sync FS/SQLite work inside a tokio worker. Use `tokio::sync::OnceCell`.
- **`commands/tasks.rs:52-90`** holds `SharedOrchestratorState.lock()` while running `std::fs::create_dir_all`, preset IO, and context assembly. Serializes all task creation.
- **`bridge/manager.rs`** uses `tokio::sync::RwLock` but many commands `.write()` even for read-ish ops (`commands/sdk.rs:24,33,61,72,104,113`).
- **`Arc<Mutex<Option<T>>>` × 3:** `SharedTaskDb`, `SharedOrchestratorState`, config — all classic pre-`OnceCell` idiom.
- **Two `Semaphore` singletons** for indexing (`lib.rs:36-39`) with inconsistent newtype wrapping.

### 3.8 SDK integration 🔴

- **Session subprocess leakage risk:** `event_tasks: HashMap<String, JoinHandle<()>>` (`manager.rs:40`) — audit `unlink_session`/`destroy_session` for `.abort()` calls.
- **`launch_ui_server`** (`manager.rs:801-840`) reimplements `which/where` logic instead of `process::run_hidden_stdout`.
- **Raw-JSON-RPC fallback workaround** embedded in `manager.rs:502` instead of a dedicated `raw_rpc.rs`.
- **`cli_url: Option<String>`** mixes connection modes; better as `enum ConnectionMode { Stdio, Tcp { url } }`.

### 3.9 Tests 🟡

- **Test helper duplication:** `core/src/turns/tests/builders.rs` (892), `export/src/test_helpers.rs` (122), `core/src/analytics/test_helpers.rs` (157) all build fixture events/sessions. No shared `test-support` crate.
- **Integration tests over-use `.expect()`** (179 in `export/tests/integration.rs`); TempDir deletion lazy on Windows.
- **`TEST_ENV_LOCK`** global mutex in `orchestrator/src/lib.rs:36` — document which tests need it.

### 3.10 Rust↔TS contract 🔴

- **Zero codegen** (`grep ts-rs|specta|typeshare *.toml` → 0). 40+ IPC DTOs hand-mirrored.
- **Polymorphic event payloads via `serde_json::Value`** on both sides: `EventItem.data`, `SessionIncidentItem.detail_json`, `task_create.input_params`.

### 3.11 Build / Cargo 🟡

- `src-tauri/Cargo.toml:16` path-imports bindings; others use `workspace`. Inconsistent.
- `bindings` is absent from `[workspace.dependencies]` (only 4 of 5 internal crates listed).
- `uuid`, `tokio`, `tauri`, `tauri-plugin-*`, `sha2`, `tempfile` declared directly in some crates instead of inherited.
- `default = ["copilot-sdk"]` repeated on 3 crates — consolidate via workspace feature.

### 3.12 Logging / tracing 🟡

- **Mixed `log::` and `tracing::`.** `src-tauri/src/main.rs:64` uses `log::info!`; crates use `tracing::`.
- **Sparse spans:** only `list_sessions` / `search_sessions` have `#[tracing::instrument]`.
- **Log-injection defense only local:** `mcp/health.rs:24-30 sanitize_error_msg` not promoted to `core::utils::log_sanitize`.
- **No PII redaction** on session summaries/paths/repos in logs.

### 3.13 Security 🔴

- **Allow-all capabilities** (#3 in top-20).
- **Command injection via `run_hidden_shell`** (`orchestrator/src/process.rs:226`): raw string into `powershell -Command`. Callers must not pass user input; audit required. Prefer `run_hidden(program, args)`.
- **Path validation only partial.** `validate_path_within` covers skills/export; `launch_session`, `open_in_explorer`, `open_in_terminal` accept arbitrary paths.

---

## 4. Frontend Desktop Findings

### 4.1 Mega-SFCs (top 20, >400 LOC)

| Rank | File | Total | Script | Template | Style |
|---|---|---:|---:|---:|---:|
| 1 | `views/tasks/PresetManagerView.vue` | 2365 | 372 | 431 | **954** |
| 2 | `views/orchestration/ConfigInjectorView.vue` | 2020 | 409 | 302 | **1121** |
| 3 | `views/orchestration/WorktreeManagerView.vue` | 1990 | 434 | 67† | 974 |
| 4 | `components/timeline/AgentTreeView.vue` | 1928 | **762** | 306 | 752 |
| 5 | `views/orchestration/SessionLauncherView.vue` | 1855 | 382 | 36† | **1002** |
| 6 | `views/SessionSearchView.vue` | 1734 | 228 | 83† | **1157** |
| 7 | `views/tasks/OrchestratorMonitorView.vue` | 1690 | 242 | 198 | 980 |
| 8 | `views/skills/SkillEditorView.vue` | 1635 | 330 | 223 | **1055** |
| 9 | `views/tasks/TaskCreateView.vue` | 1566 | 259 | 57† | 832 |
| 10 | `views/ExportView.vue` | 1481 | 253 | 254 | 702 |
| 11 | `views/tasks/TaskDetailView.vue` | 1441 | 316 | 377 | 672 |
| 12 | `components/conversation/SdkSteeringPanel.vue` | 1364 | 371 | 248 | 687 |
| 13 | `views/mcp/McpServerDetailView.vue` | 1360 | 220 | 75† | 823 |
| 14 | `components/skills/SkillImportWizard.vue` | 1350 | 361 | 303 | 681 |
| 15 | `views/SessionComparisonView.vue` | 1186 | 353 | 256 | 497 |
| 16 | `components/TodoDependencyGraph.vue` | 1125 | 541 | 231 | 351 |
| 17 | `views/ModelComparisonView.vue` | 1120 | 415 | 233 | 326 |
| 18 | `components/timeline/TurnWaterfallView.vue` | 1070 | 415 | 201 | 375 |
| 19 | `components/timeline/NestedSwimlanesView.vue` | 1063 | 314 | 306 | 441 |
| 20 | `components/conversation/ChatViewMode.vue` | 1010 | 415 | 126† | 363 |

†Template count low due to nested `</template>` in v-slot — actual template size larger. An additional 23 files fall in the 400–1000 LOC band.

**Decomposition rule** to enforce: >400 LOC template → extract child SFC; >500 LOC style → move to `styles/features.css` or per-child scoped styles.

### 4.2 Mega stores / composables (>300 LOC) 🔴

| File | LOC | Problems |
|---|---:|---|
| `composables/useSessionDetail.ts` | 698 | Cache + fingerprinting + 5 async sections + turns merge + freshness polling + provide/inject |
| `stores/search.ts` | 668 | Query + execute + facets + stats + indexing events + maintenance |
| `stores/sdk.ts` | 615 | 17 actions + event wiring + localStorage. No tests. |
| `composables/useOrbitalAnimation.ts` | 602 | Animation loop + SVG + lane geometry + phase messages |
| `stores/preferences.ts` | 548 | 28 refs + `applyConfig`/`buildConfig` mirror pair + localStorage migration |
| `composables/useAlertWatcher.ts` | 451 | **Module-level mutable state** — 8 refs in module scope |

### 4.3 Duplicated logic 🔴

- **`error.value = toErrorMessage(e)` repeated ~90 times** across 13 stores. `runAction`/`runMutation` is used only in `stores/skills.ts` (4 call sites).
- **`loading + error + data` ref trio** re-created in 13 places; `useAsyncData` exists but only its own test imports it.
- **Manual deduplication promises** (`fetchPromise`, `indexingPromise`, `postIndexRefreshPromise`) in `sessions.ts:19-23` — abstract into `useInflightPromise<T>()`.
- **localStorage writes reimplemented** in `sdk.ts:64-73`, `alerts.ts:47-60`, `sessionTabs.ts:29-43`, `preferences.ts:112-186`. Need `usePersistedRef(key, default)`.
- **Dynamic Tauri imports** bypassing `@tracepilot/client`: `App.vue:59 import("@tauri-apps/api/window")`, `App.vue:74 import("@tauri-apps/api/event")`, raw event `"popup-session-closed"` (`App.vue:75`).

### 4.4 Single-source-of-truth violations 🔴

- **Route paths hardcoded** 10+ times: `router.push("/tasks")`, `"/tasks/new"`, `"/tasks/monitor"`, `"/tasks/presets"`, `"/orchestration/launcher"`, `"/orchestration/config"`, `"/orchestration/worktrees"`, `"/"` in `App.vue:225,234`, `TaskDetailView.vue:299,306`, `TaskDashboardView.vue:48`, `TaskCreateView.vue:417`, `OrchestrationHomeView.vue:92,106,113`, `NotFoundView.vue:12`, `OrchestratorStatusCard.vue:150`, `QuickPresetsCard.vue:16`.
- **`sidebarId`** free-strings used 25+ times in `router/index.ts`.
- **Feature-flag keys** `"healthScoring"`, `"sessionReplay"`, `"exportView"`, `"mcpServers"`, `"skills"`, `"aiTasks"`, `"copilotSdk"` referenced as untyped `to.meta?.featureFlag as string` (`router/index.ts:353`).
- **localStorage keys scattered:** `"tracepilot-theme"`, `"tracepilot-prefs"`, `"tracepilot-last-session"`, `"tracepilot-last-seen-version"`, `"tracepilot-dismissed-update"`, `DISMISSED_KEY`, `CACHE_KEY`, `STORAGE_KEY` (twice), `"tracepilot:sdk-settings"`. Mixed `tracepilot-*` vs `tracepilot:*` naming.
- **`DEFAULT_MODEL = "claude-haiku-4.5"`** hardcoded in `stores/orchestrator.ts:27` while `@tracepilot/types` exports `DEFAULT_MODEL_ID`.
- **Magic numbers:** `MAX_EVENTS=500`, `MAX_HISTORY`, `MAX_SENT_LOG=5`, `ACTIVITY_FEED_LIMIT=30`, `HYDRATION_CONCURRENCY=4`, `POLL_FAST_MS`, `POLL_SLOW_MS`, `REFRESH_THROTTLE_MS`, `DEBOUNCE_MS` scattered.
- **`AGENT_META`** hardcoded in `ConfigInjectorView.vue:33-43` — should be in shared registry alongside `AGENT_COLORS`/`inferAgentTypeFromToolCall`.

### 4.5 Shared-component adoption gap 🔴

`@tracepilot/ui` exports `PageShell`, `PageHeader`, `SectionPanel`, `StatCard`, `EmptyState`, `ErrorState`, `ErrorAlert`, `LoadingOverlay`, `LoadingSpinner`, `SearchInput`, `FilterSelect`, `DataTable`, `TabNav`, `BtnGroup`, `SegmentedControl`, `Badge`, `ProgressBar`, `ModalDialog`, `ConfirmDialog`, `ToastContainer`, `SearchableSelect`.

Adoption:

- **`PageShell`:** 1 of 16 views (`ExportView.vue:12`). 16 views hand-roll `<div class="page-content"><div class="page-content-inner">`.
- **`StatCard`:** 3 of 9 views. 6 views hand-roll `.stat-card` DOM.
- **`TabNav`:** not imported anywhere despite 4 views with bespoke tab markup.
- **`SegmentedControl`/`FilterSelect`/`SearchInput`:** `PresetManagerView.vue:438-530` reimplements all three.
- **`PageHeader`:** only `AnalyticsPageHeader.vue` wraps it; 4 views build bespoke page headers.

### 4.6 Styling 🔴

- **100+ inline `:style="…"` bindings** across 50+ files; many are static tokens (e.g. `:style="{ background: CHART_COLORS.success }"`) that should be CSS variables on classes.
- **Hardcoded hex literals in CSS:** `#888` fallbacks in `SearchResultCard.vue:146,153,159`, `rgba(255,255,255,0.02)` in `App.vue:339`, theme hex fallbacks in `designTokens.ts:65-78`.
- **Design-token bypass at scale.** CSP `style-src 'self' 'unsafe-inline'` is required because of this (`tauri.conf.json:24`). Blocking a CSP tightening.
- **CSS dominates SFCs.** `ConfigInjectorView.vue` has 1121 LOC of CSS — larger than its script + template combined.

### 4.7 Testing 🔴

- 49 `.test.ts` files — good coverage of stores.
- **Zero tests** for `stores/sdk` (615 LOC, critical bridge), `stores/presets`, `stores/sessionTabs`, `stores/alerts`, `useAlertWatcher`, `useAlertDispatcher`, `useOrbitalAnimation`, `useParallelAgentDetection`, `useTimelineToolState`, `useGitRepository`.
- **Zero component tests** for the 10 largest SFCs (`PresetManagerView`, `ConfigInjectorView`, `WorktreeManagerView`, `SessionLauncherView`, `SkillEditorView`, `TaskCreateView`, `TaskDetailView`, `OrchestratorMonitorView`, `ModelComparisonView`, `SdkSteeringPanel`).

### 4.8 Other 🟡

- **Typescript `as` casts** for meta/feature-flag reads; `Window` augmentation missing (`__TRACEPILOT_READY__`, `__TRACEPILOT_IPC_PERF__`).
- **`ChildApp.vue` purpose undocumented.**
- **`stores/sessionDetail.ts`** (18 LOC) is a thin pinia wrapper around `useSessionDetail` composable — two copies of truth.
- **`stores/toast.ts`** (7 LOC) likely stub; confirm & delete.
- **Store mutations from components** (e.g., `PresetManagerView.vue:164 store.error = …`).
- **Silent catches in `App.vue:68,71,78,128`** — `:128` marks app ready even on config read failure.
- **Large reactive arrays not `shallowRef`:** `turns`, `events`, `results`, `facets` in `useSessionDetail.ts`.
- **Session/orchestrator polling not gated on `document.visibilityState`.**
- **`App.vue:39 AppPhase` mini state machine** could be `useBootstrapPhase()`.

---

## 5. Shared Packages & CLI Findings

### 5.1 `@tracepilot/client` 🔴

- **`src/index.ts` is 883 LOC / 28 KB** kitchen-sink. Mixes public API, 29 KB inline mock fixtures, leaked type defs (`FtsHealthInfo` L509, `ContextSnippet` L526), and `getHealthScores` STUB (L594-599, bypasses invoke).
- **Inconsistent mock fallback.** `sdk.ts:17`, `mcp.ts:11`, `skills.ts:16` create invoke without a fallback and will throw in dev mode.
- **Validation drift:** `exportSessions`/`previewExport` flatten nested config to camelCased keys by hand with no shared validator.
- **`null` vs `undefined` hand-mapped** via `?? null` in 20+ places — needs `toRustOptional`.
- **`mcpListServers` returns tuple-of-tuple** `[string, McpServerConfig][]` — wrap as `Record<>` for ergonomics.
- **No retry/timeout/abort policy** in any wrapper.
- **Mock bundle ships in prod** (~29 KB) — should be `@tracepilot/client-mocks` opt-in subpackage or env-guarded dynamic import.
- **Module-level side effect** on import: `window.__TRACEPILOT_IPC_PERF__` (`invoke.ts:53-58`) kills `sideEffects: false`.

### 5.2 `@tracepilot/ui` 🔴

- **Design tokens not shipped from package.** Components use `var(--text-placeholder)` etc. but tokens live in `apps/desktop/src/styles/design-tokens.css`. Package is unusable without the desktop app. No `tokens.css` export, no docs.
- **Duplicate prototype token block** at `docs/design/prototypes/shared/design-system-c.css` drifts from desktop.
- **`utils/formatters.ts` is a back-compat shim** (20 LOC re-exporting from types). Delete after migrations.
- **Heavy deps `markdown-it`/`dompurify` hard-required** — no `peerDependencies` option.
- **Mixed barrel vs named re-exports** (`index.ts:32` vs `:63-76`) — convention drift.
- **Missing composables:** no `useTheme`, `useKeyboard` (shortcut manager), `useAsyncData`, `useCachedFetch`, `useLocalStorage`. Desktop app has locally-scoped versions.
- **`vue-router` declared as optional peer** but not used in `ui/src/**` — dead peer dep.
- **`useToast` module-singleton** state (`useToast.ts:27`).
- **20+ `.vue` files >5 KB**, several `utils` files 6–17 KB (`syntaxHighlight.ts` 16.7 KB hand-rolled regex highlighter — drift hazard).

### 5.3 `@tracepilot/types` 🟡

- **Type leakage from client:** `FtsHealthInfo`, `ContextSnippet` should live in `types/src/search.ts`.
- **Manual Rust mirror with no runtime check.** Only `IPC_COMMANDS` has a regex-based contract test against `build.rs`.
- **`formatTokens` alias for `formatNumber`** kept for CLI back-compat — tech debt.
- **`index.ts` uses `export *` × 17** — collision risk.
- **`utils/` subdir is half-populated** (only `formatters.ts`) — inconsistent.
- **`IPC_EVENTS` is a domain runtime constant** in the types package — better in `@tracepilot/client`.

### 5.4 `@tracepilot/config` 🟢

- One-file package with no `main`/`exports`/scripts. Advertises "presets" (plural). Either grow or document as `tsconfig` holder only.

### 5.5 `@tracepilot/test-utils` 🟡

- Very thin. Could promote: mock Tauri invoke setup, session-detail fixture builder, task fixture builder, `flushPromises` wrapper.
- UI package tests don't use it (inconsistent).
- No `scripts` in `package.json`, no README.

### 5.6 `apps/cli` 🔴

- **Duplicates backend logic in TS**: session discovery (`list.ts:22-55`), `workspace.yaml` parsing, turn reconstruction (`show.ts`), event extraction (`search.ts:41-85`) — all exist more completely in Rust crates.
- **Ignores `TracePilotConfig`.** `lib/session-path.ts:21-32` resolves only env vars + hard-coded default.
- **Command coverage drift.** CLI has 6 commands; desktop has 25+ feature areas. `index` is a stub. `resume` just echoes a shell command.
- **Unused `better-sqlite3` dep** (`package.json:23`).
- **`version-analyzer.ts` 38.5 KB** — largest TS file in the repo. Possibly duplicates desktop `discover_copilot_versions`.
- **Partial `@tracepilot/types` reuse** — imports only `formatTokens`/`TRACEPILOT_KNOWN_EVENTS`; reimplements own `SessionInfo`/`TurnInfo`.
- **`dist/` in working tree** — confirm gitignore.

### 5.7 Cross-package 🟡

- **No `README.md`** in any of 5 packages.
- **No `sideEffects: false`** anywhere.
- **All packages ship raw TS** as `"main": "src/index.ts"`; `declaration`/`sourceMap` in base tsconfig are dead config.
- **No subpath exports** — rely on discipline.
- **Versions hard-pinned together** (all `0.6.2`) — fine with `private: true`, but document convention.

---

## 6. Build / CI / Release / Docs Findings

### 6.1 CI/CD 🔴

- **Disabled gates** (`ci.yml:71-80`): `cargo clippy`, `pnpm lint`, `cargo audit`, `cargo fmt --check` all commented out or absent.
- **Ubuntu-only** (`ci.yml:14`) despite Windows-first app.
- **`tracepilot-desktop` excluded from `cargo check`** (`ci.yml:55,65`).
- **Release builds Windows-only** (`release.yml:65`). No macOS `.dmg`, no Linux `.AppImage`/`.deb`.
- **No checksums, no SBOM, no SLSA provenance, no cosign/minisign.** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ''` empty.
- **Budgets warn-only:** `bundle-analysis.yml:80` `::warning::`; `benchmark.yml:110` warn; `benchmark.yml:134 fail-on-alert: false`.
- **No concurrency groups** → duplicate runs on push+PR.
- **Unpinned action SHAs.**
- **No scheduled security audit run.**
- **`python3` inline CLI version extraction** (`ci.yml:45`) — fragile.

### 6.2 Dependency hygiene 🔴

- **Dependabot disabled** (`dependabot.yml:34` → `updates: []`).
- **`copilot-sdk` git-rev pin** with no semver (`Cargo.toml:40`).
- **Workspace dep inheritance inconsistent:** `tauri`, `tauri-plugin-*`, `tempfile` (used directly in some), `uuid`, `tokio`, `sha2` declared per-crate in some places. `bindings` absent from `[workspace.dependencies]`.
- **`playwright-core`** in root devDeps but no `.spec.ts` Playwright tests.
- **`ui` `vue-router`** dev version drift with root app.

### 6.3 Lefthook / linting 🟡

- **Only Biome lint on staged TS/JS.** No `cargo fmt`, no `cargo clippy`, no typecheck, no tests.
- **CI runs less than lefthook.**
- **`biome.json:22-44`** `noExplicitAny: "warn"`, `noNonNullAssertion: "warn"`, Vue override disables `noUnusedImports`/`noUnusedVariables`.

### 6.4 Rust tooling config 🔴

- Missing: `rustfmt.toml`, `clippy.toml`, `deny.toml`, `.cargo/audit.toml`, `[workspace.lints]` in Cargo.toml.

### 6.5 Governance 🔴

- Missing: `CODEOWNERS`, `SECURITY.md`, `PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/`, `FUNDING.yml`.

### 6.6 Scripts 🟡

- 7 `.ps1` vs 1 `.sh` vs 13 `.mjs` vs 1 `.py`. Windows-biased.
- `scripts/e2e/*.mjs` — 13 overlapping/stale ad-hoc test scripts that should be consolidated under Playwright (already in devDeps).
- `scripts/validate-session-versions.py` 14 KB — Python in an otherwise JS+Rust monorepo.
- No `scripts/README.md`.

### 6.7 Release process 🟡

- **`cliff.toml` present, never invoked.** Release workflow hand-greps `CHANGELOG.md` with awk (`release.yml:43`). Wire `git-cliff` or delete `cliff.toml`.
- `CHANGELOG.md:10` dated `2026-04-12` — future-dated typo.
- `[profile.release] opt-level = 2` not 3 — document rationale.

### 6.8 Docs hygiene 🔴

- **~45 top-level `.md` files flat**, no folder grouping.
- **No `docs/archive/`** for superseded plans/reports.
- **`docs/README.md` is stale** — misses ~20 files.
- **4 overlapping tech-debt reports** (this file supersedes them), 5 copilot-SDK reports, 3 implementation plans, 3 AI-task docs.
- **Future-dated reports** `docs/reports/versions/2026-*.md` — almost certainly `2025` typo.
- **Capitalisation drift:** `SECURITY_AUDIT_REPORT.md` (SHOUT) vs kebab-case siblings.
- **`docs/design/prototypes/`** contains 2.5 MB of HTML mocks — belongs in `assets/` or outside docs.

### 6.9 Platform coverage 🔴

- README Windows-only; CI Ubuntu-only; release Windows-only; scripts PowerShell-biased. Pick a story.
- `apps/desktop/package.json:11` uses `cmd.exe`-specific `set "PATH=..."`.

### 6.10 Observability 🟡

- Tracing + `tauri-plugin-log` present ✅.
- **No crash reporter** (sentry / crashpad).
- **No telemetry opt-in flow.**
- IPC perf log stored in `window.__TRACEPILOT_IPC_PERF__` (`invoke.ts:26-58`) with no sink.

---

## 7. Largest Files Index

### Rust (top 15, >700 LOC)

```
1413  indexer/src/index_db/search_reader.rs
1132  orchestrator/src/bridge/manager.rs
1060  indexer/src/index_db/mod.rs
 933  core/src/parsing/events.rs
 907  orchestrator/src/skills/import.rs
 892  core/src/turns/tests/builders.rs
 886  tauri-bindings/src/commands/tasks.rs
 840  indexer/src/lib.rs
 839  orchestrator/src/process.rs
 811  orchestrator/src/mcp/health.rs
 772  core/src/turns/tests/model_tracking.rs
 756  indexer/src/index_db/session_writer.rs
 751  tauri-bindings/src/config.rs
 732  core/src/turns/tests/session_events.rs
 728  core/src/turns/reconstructor.rs
```

### TypeScript / Vue (top 15, >900 LOC)

```
2365  apps/desktop/src/views/tasks/PresetManagerView.vue
2020  apps/desktop/src/views/orchestration/ConfigInjectorView.vue
1990  apps/desktop/src/views/orchestration/WorktreeManagerView.vue
1928  apps/desktop/src/components/timeline/AgentTreeView.vue
1855  apps/desktop/src/views/orchestration/SessionLauncherView.vue
1734  apps/desktop/src/views/SessionSearchView.vue
1690  apps/desktop/src/views/tasks/OrchestratorMonitorView.vue
1635  apps/desktop/src/views/skills/SkillEditorView.vue
1566  apps/desktop/src/views/tasks/TaskCreateView.vue
1481  apps/desktop/src/views/ExportView.vue
1441  apps/desktop/src/views/tasks/TaskDetailView.vue
1364  apps/desktop/src/components/conversation/SdkSteeringPanel.vue
1360  apps/desktop/src/views/mcp/McpServerDetailView.vue
1350  apps/desktop/src/components/skills/SkillImportWizard.vue
1186  apps/desktop/src/views/SessionComparisonView.vue
```

### Shared packages / CLI (top 10, by KB)

```
38.5 KB  apps/cli/src/lib/version-analyzer.ts
28.5 KB  packages/client/src/index.ts
17.1 KB  packages/client/src/mock/index.ts
16.7 KB  packages/ui/src/utils/syntaxHighlight.ts
15.1 KB  apps/cli/src/commands/show.ts
14.1 KB  apps/cli/src/commands/versions.ts
13.9 KB  packages/ui/src/components/renderers/EditDiffRenderer.vue
11.7 KB  packages/client/src/mock/orchestration.ts
10.8 KB  packages/ui/src/utils/agentGrouping.ts
10.5 KB  packages/ui/src/components/renderers/WebSearchRenderer.vue
```

---

## 8. Missing Capabilities Checklist

**Governance:** `CODEOWNERS`, `SECURITY.md`, PR template, issue templates, `FUNDING.yml`, signed-commits policy, branch protection doc.

**Rust tooling:** `rustfmt.toml`, `clippy.toml` (or `[workspace.lints]`), `deny.toml` (cargo-deny), `.cargo/audit.toml`.

**CI/CD:** clippy `-D warnings`, `cargo fmt --check`, `cargo audit`, `cargo deny check`, `pnpm audit --prod`, OS matrix (Win/mac/Linux), concurrency groups, pinned action SHAs, nightly scheduled security, coverage reporting.

**Release:** multi-OS Tauri matrix, SHA256SUMS, SBOM (syft/cyclonedx), SLSA provenance, cosign/minisign signing, wired `git-cliff`, package tap/winget/Flathub targets.

**Rust↔TS:** `tauri-specta` or `ts-rs`/`typeshare` codegen; generated `commands.ts`; CI diff check.

**Dev tooling:** `justfile` / `taskfile` for cross-platform task running; bash equivalents of PS scripts; `docs/dev.md`; `.vscode/extensions.json`; devcontainer / nix-shell.

**Observability:** crash reporter (sentry-tauri / minidump), telemetry opt-in + privacy doc, structured log export.

**Docs:** `docs/archive/` for superseded plans; up-to-date `docs/README.md`; `docs/adr/` (architecture decision records); flat docs reorganised into `architecture/`, `guides/`, `plans/`, `reports/`, `research/`, `design/`, `archive/`; fix `2026-*` date typos.

**Perf/budget:** IPC budget bench matching `perf-budget.json`; bundle budget hard-fail.

**Dependency hygiene:** pnpm `catalog:` protocol for shared TS deps; re-enable Dependabot; vendor or release-tag `copilot-sdk`.

---

## Appendix: Audit Agent Traces

Per-agent raw audits were produced by four parallel Claude Opus 4.7 exploration agents (Rust, Frontend, Packages, Cross-cutting) on 2026-04-16 with ~280–450 s runtimes per agent. Individual raw outputs are archived in the session workspace.
