# TracePilot Pre-Release Audit Report

**Generated**: 2026-03-24 · **Updated**: 2026-03-24 (post multi-model review)  
**Version Audited**: 0.4.0 (commit `a2eb981`, tag `v0.4.0`)  
**Scope**: Full codebase — 6 Rust crates, 5 TypeScript packages, desktop app, CLI, CI/CD, docs, scripts  
**Methodology**: 6 parallel AI exploration agents + targeted grep/glob analysis + existing doc cross-reference  
**Review**: Validated by 4 independent model reviews (Claude Opus 4.6, GPT 5.4, Codex 5.3, Gemini 3 Pro)  
**Codebase Size**: ~9,000 lines Rust · ~18,000 lines TS/Vue · ~1,500 lines CSS · 37 docs

---

## Executive Summary

TracePilot is a well-architected monorepo with strong foundations: clean Rust/TS separation, a solid design system (65+ CSS tokens, dark/light theming), comprehensive documentation, and a security-audited codebase with zero critical vulnerabilities. However, significant work remains before a public release:

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| **Feature Completeness** | 0 | 5 | 3 | 1 | **9** |
| **Code Quality & Safety** | 1 | 11 | 12 | 5 | **29** |
| **Testing** | 0 | 6 | 3 | 0 | **9** |
| **CI/CD & Infrastructure** | 1 | 4 | 4 | 3 | **12** |
| **Documentation & Legal** | 0 | 2 | 5 | 4 | **11** |
| **UX & Accessibility** | 0 | 2 | 8 | 5 | **15** |
| **Performance** | 0 | 2 | 4 | 2 | **8** |
| **Totals** | **2** | **32** | **39** | **20** | **93** |

> *Note: After multi-model review, several CRITICAL items were downgraded to HIGH (feature-flagged stubs, test gaps) and new HIGH items added (race conditions, mock bundling, config persistence). The 2 remaining CRITICALs are production panic paths and incomplete CI.*

**Overall Release Readiness: 🟡 NOT READY — Significant blockers remain**

Phases 1–3 are complete and solid. Phases 4–7 (Health Scoring, Export, Advanced Features, Distribution) are incomplete. Key gaps include: production panic paths in Rust, incomplete CI pipeline, async race conditions in stores, zero test coverage for the Tauri IPC bridge, and substantial accessibility debt. Stub views are feature-flagged off by default, reducing their immediate impact.

---

## 1. Feature Completeness

### 1.1 Stub Views Shipping Mock Data 🟠 HIGH

> *Downgraded from CRITICAL: All stub views are feature-flagged off by default.*

Four views render complete UI with hardcoded mock data rather than real backend integration:

| View | Status | Backend Status |
|------|--------|----------------|
| `HealthScoringView.vue` | 3 STUB markers | Health engine exists in core (`health/mod.rs`) but no IPC wiring |
| `ExportView.vue` | 4 STUB markers | Export crate is mostly a placeholder |
| `SettingsHealthScoring.vue` | 4 STUB markers | Local state only, not persisted |
| `OrchestrationHomeView.vue` | Hardcoded mock data (budget %, activity feed) | No STUB markers but data is fake |

> **Correction**: `SessionComparisonView.vue` was originally listed here but is **not a stub** — it loads real data via `getSessionDetail()`, `getShutdownMetrics()`, and `getSessionTurns()` (lines 77-103).

**Impact**: Users who enable experimental features see realistic-looking pages that do nothing. StubBanner warns users. Since these are gated behind feature flags (off by default), this is a **HIGH** not CRITICAL concern.

### 1.2 Export Crate is Mostly a Placeholder 🟠 HIGH

> *Downgraded from CRITICAL: Feature-flagged off by default. JSON export is implemented.*

`crates/tracepilot-export/` is ~35 lines across 3 source files:
- `export_session()` immediately returns `bail!("not yet implemented")` for Markdown/CSV
- `render_markdown()` returns a hardcoded string: `"# Session Export\n\n_Export not yet implemented_\n"`
- `ExportFormat::Csv` variant declared with no implementation
- **JSON export is implemented** (`json.rs:5-7` — functional `serde_json::to_string_pretty`)
- Cargo.toml declares unused deps: `chrono`, `thiserror`, `serde`
- Zero tests

**Recommendation**: Either complete Markdown/CSV or remove from workspace. JSON export works but the crate misleadingly appears non-functional.

### 1.3 Incomplete Features 🟠 HIGH

| Feature | Status | Details |
|---------|--------|---------|
| **Health Scoring Engine** | Phase 4 — Not started | Frontend stub ready, no Rust backend |
| **Secret/PII Detection** | Phase 4 — Not started | Planned regex scanner, not implemented |
| **Session Comparison** | Phase 6 — Not started | Frontend stub with mock data |
| **Headless Session Launch** | Disabled | UI present but disabled with "Coming Soon" label |

### 1.4 Partially Implemented Features 🟡 MEDIUM

| Feature | Gap |
|---------|-----|
| **CLI `index` command** | Stub — prints message, does nothing |
| **CLI `search`** | Only searches user messages, not assistant/tool text despite help text implying broader scope |
| **Mission Control** | Quick action defined in OrchestrationHome but disabled with empty route |

### 1.5 Feature Flag Gating ✅ GOOD

Export, Health Scoring, and Session Replay are properly gated behind feature flags with `SettingsExperimental.vue` toggles. This is the right pattern — extend it to all stub views.

---

## 2. Code Quality & Safety

### 2.1 Production Panic Paths in Rust 🔴 CRITICAL

These `unwrap()` calls can crash the application in production:

| Location | Code | Risk |
|----------|------|------|
| `tauri-bindings/lib.rs:253` | `state.read().unwrap()` | Poisoned RwLock after panic |
| `tauri-bindings/lib.rs:487,508` | `cache.lock().unwrap()` | Poisoned Mutex after panic |
| `tauri-bindings/lib.rs:1361,1489` | `state.write().unwrap()` | Poisoned RwLock after panic |
| `core/parsing/events.rs:367-368` | `shutdowns.first().unwrap()` | Empty shutdowns vec |
| `core/turns/mod.rs:744` | `self.current_turn.as_mut().unwrap()` | None state |
| `core/models/event_types.rs:176-177` | `s.parse().expect(...)` | Invalid event type string |
| `orchestrator/version_manager.rs:200` | `to_file.parent().unwrap()` | Root path |

**Recommendation**: Replace all production unwraps with `match`/`?` or `.unwrap_or_else()` with graceful degradation.

### 2.2 Tauri Error Handling — All Context Lost 🔴 CRITICAL

**171 instances** of `.map_err(|e| e.to_string())` across tauri-bindings flatten structured `TracePilotError` variants into opaque strings. The frontend cannot distinguish "session not found" from "database locked" from "parse error".

**Recommendation**: Define `TauriError` enum with `Serialize`, replace `Result<T, String>` boundary.

### 2.3 Frontend Error Handling Gaps 🟠 HIGH

> *Downgraded from CRITICAL: A global Vue error handler exists at `main.ts:19-25`.*

| Issue | Location |
|-------|----------|
| Store errors only `console.error`'d, no UI state | `sessionDetail.ts:162-274` (7 load functions) |
| No `window.onerror` / `unhandledrejection` handler | `main.ts` (Vue handler exists, but not window-level) |
| `ErrorBoundary` catches sync child errors but not async/store failures | `ErrorBoundary.vue:8-15` |
| `Promise.all` in configInjector — one failure blocks all | `configInjector.ts:51-57` |
| 18+ silent `catch` blocks across stores | `sessions.ts`, `search.ts`, `worktrees.ts`, `orchestrationHome.ts`, `launcher.ts` |

### 2.4 ~~Client-Side Search Bypasses FTS Backend~~ 🟢 INTENTIONAL

> **Not an issue.** Client-side filtering in `sessions.ts` searches visible metadata (summary, branch, repo name). A dedicated FTS-backed search feature exists separately. This is by design.

### 2.5 Cross-Boundary Type Safety Drift 🟠 HIGH

| Boundary | Issue |
|----------|-------|
| Rust → TS session IDs | Plain `String` everywhere — no UUID validation |
| Timestamps | `DateTime<Utc>` → `Option<String>` → `string | undefined` — lossy |
| Status fields | Enums in TS, strings in Rust |
| IPC commands | Hardcoded string names in `@tracepilot/client` — no contract tests |
| `HealthFlag.severity` | `"info" | "warning" | "error"` vs `"warning" | "danger"` — incompatible |

### 2.6 Stringly-Typed Data in Rust 🟠 HIGH

| Field | Location | Should Be |
|-------|----------|-----------|
| `shutdown_type` | `models/event_types.rs:153` | `ShutdownType` enum |
| `HealthFlag.category` | `health/mod.rs:18` | `HealthCategory` enum |
| `TodoItem.status` | TS types package | `'done' | 'in_progress' | 'blocked' | 'pending'` |
| `RewindSnapshot.timestamp` | `parsing/rewind_snapshots.rs:22` | `DateTime<Utc>` |

### 2.7 Code Duplication 🟠 HIGH

| What | Where | Count |
|------|-------|-------|
| Agent color maps | AgentTreeView, NestedSwimlanesView, TurnWaterfallView | 3× |
| Format functions | Analytics views (local `fmtTokens`, `fmtCost`, `fmtDate`) | 3× vs shared formatters that exist |
| `SessionCard` relative time | Local helper vs shared `formatRelativeTime()` | 2× |
| `@keyframes spin` | LoadingOverlay, SessionListView, ExportView | 3× |
| Hardcoded session paths | CLI utils.ts, version-analyzer.ts (×2), Rust discovery | 4× |

### 2.8 CSS Paradigm Conflict 🟠 HIGH

Four styling strategies coexist with conflicting values:
1. Global BEM-ish classes in `styles.css`
2. Tailwind CSS v4 utility classes
3. Scoped `<style scoped>` blocks (25 components)
4. Inline styles (130+ static, 26+ dynamic)

Critical issue: Inline styles (130+ instances) force CSP `unsafe-inline` for styles, weakening security posture.

### 2.9 Hardcoded Colors Breaking Light Theme 🟠 HIGH

67+ hardcoded hex values bypass the design system. Critical light-theme breakages:
- `ToolAnalysisView:403` — `rgba(255, 255, 255, 0.85)` renders invisible text on white bg
- Multiple `#ffffff` / `rgba(255,255,255,...)` values throughout chart views
- `SessionComparisonView` — 6 hardcoded colors (`#27272a`, `#3f3f46`, `#fafafa`)

### 2.10 Async Race Conditions in Stores 🟠 HIGH *(NEW — from review)*

Multiple stores have unguarded async operations that can produce stale state:

| Store | Issue | Location |
|-------|-------|----------|
| `preferences.ts` | `scheduleSave()` has no generation token — overlapping saves can write stale config | `preferences.ts:237-255` |
| `search.ts` | `fetchFacets()` has no stale-response guard unlike `executeSearch()` | `search.ts:234-248` |
| `worktrees.ts` | `loadBranches()` has no cancellation — fast repo switching shows wrong branches | `worktrees.ts:143-148` |
| `worktrees.ts` | `loadAllWorktrees()` replaces state wholesale — concurrent add/delete gets reverted | `worktrees.ts:105-121` |
| `sessionDetail.ts` | `reset()` does not bump `requestToken` — pre-reset requests repopulate cleared state | `sessionDetail.ts:77-93` |

### 2.11 Mock Data Bundled into Production 🟠 HIGH *(NEW — from review)*

`packages/client/src/index.ts:34-47` eagerly imports `mock/index.ts` (**68,988 bytes / 703 lines**) at module level. Mock payloads are bundled into production regardless of whether Tauri IPC is available. Should use dynamic `import()`.

### 2.12 Config Persistence Bug 🟠 HIGH *(NEW — from review)*

The `renderMarkdown` setting is exposed in the UI and TS types but **omitted from the Rust `AppConfig` struct** (`tauri-bindings/config.rs`). It resets to default on every restart.

### 2.13 No Config Upgrade/Recovery Path 🟠 HIGH *(NEW — from review)*

If `config.toml` is malformed or from a future version, `read_config()` silently falls back to defaults (`unwrap_or_default`). No migration logic, version field, or user notification.

### 2.14 Broken Package Module Resolution 🟠 HIGH *(NEW — from review)*

`@tracepilot/client` and `@tracepilot/types` `package.json` files point `main`/`types` at TypeScript source and define no build step. Direct Node.js import fails — missing compiled `.js` siblings. Works only because Vite handles TS resolution at dev/build time.

### 2.15 Undefined CSS Variables 🟡 MEDIUM

| Variable | Used In | Should Be |
|----------|---------|-----------|
| `--fg-muted` | SessionTimelineView:112 | `--text-secondary` |
| `--fg-subtle` | SessionTimelineView:119 | `--text-tertiary` |
| `--text-on-emphasis` | TimeRangeFilter:107 | Add to token system |

### 2.11 Dead Code 🟡 MEDIUM

| Item | Location |
|------|----------|
| `ThemeToggle.vue` | Never imported (AppSidebar has own toggle) |
| `EditDiffRenderer` word-level highlight code | Lines 40-99 — computed but never rendered |
| `EditDiffRenderer` `oldLineCount`/`newLineCount` | Computed but unused |
| `Badge.vue` `useSlots`/`slots` | Imported but unused |
| `search.ts:7` unused `readFile` import | CLI |
| `versions.ts:17` unused type import | CLI |

### 2.12 `WebSearchRenderer` Privacy Leak 🟡 MEDIUM

`WebSearchRenderer.vue:121-123,148-156` makes third-party requests to Google's favicon service (`https://www.google.com/s2/favicons?domain=...`), leaking visited domains to Google and failing offline.

### 2.13 CLI Argument Validation Bugs 🟡 MEDIUM

| Command | Issue |
|---------|-------|
| `list --sort` | Advertised but completely ignored in implementation |
| `list --limit -5` | Accepts negative values — returned 230 sessions |
| `search ''` | Empty query returns all 235 sessions |
| `versions diff` | Invalid versions exit code 0 instead of non-zero |
| `versions --output` | Writes to arbitrary filesystem paths with no validation |

### 2.14 Silent Error Swallowing in CLI 🟡 MEDIUM

~15 catch blocks across CLI commands silently drop parse/data errors:
- `list.ts:37-45`, `search.ts:34-57,63-93`, `show.ts:347-349,409-413`
- `version-analyzer.ts:201-239,247-291,301-317,357-360`
- Users see incomplete/missing data with no indication of failure

### 2.15 `SqlResultRenderer` Null Crash 🟢 LOW

`SqlResultRenderer.vue:35-45` — guard uses `typeof parsed[0] === "object"`, but `typeof null === "object"`, so `Object.keys(parsed[0])` throws on `[null]` JSON results.

### 2.16 `FormInput` Emits 0 for Empty Numeric Fields 🟢 LOW

`FormInput.vue:13-16` — `Number('') === 0`, so clearing a numeric field emits `0` instead of empty/null.

---

## 3. Testing

### 3.1 Zero Tests for Tauri IPC Bridge 🟠 HIGH

> *Downgraded from CRITICAL: Serious test gap, but not itself a shipping defect.*

`tracepilot-tauri-bindings` has 2,328 lines in lib.rs, 78 `#[tauri::command]` annotations, and **zero tests**. This is the critical bridge between Rust backend and Vue frontend. Any regression here silently breaks the entire app.

### 3.2 Zero Tests for CLI 🟠 HIGH

5 CLI commands (~800 lines including version-analyzer), zero test files, no `test` script in `package.json`. `pnpm -r test` silently skips CLI — workspace appears green while CLI is completely untested.

### 3.3 Zero Tests for `@tracepilot/client` 🟠 HIGH

193-line IPC bridge with mock fallback — zero tests. Type contracts between Rust commands and TS invocations are unverified.

### 3.4 Zero Tests for Export Crate 🟠 HIGH

`tracepilot-export` — zero tests for a crate that is entirely placeholder code.

### 3.5 Desktop App Test Coverage Gaps 🟠 HIGH

**15 test files exist** (good), but major areas are untested:

| Untested Area | Files |
|---------------|-------|
| All view pages | SessionListView, SessionDetailView, SessionSearchView, ExportView, HealthScoringView, SessionComparisonView, ModelComparisonView, SettingsView, all orchestration views |
| All tab views | OverviewTab, ConversationTab, EventsTab, TodosTab, MetricsTab, TokenFlowTab |
| All settings components | 8 SettingsX.vue subcomponents |
| All replay components | ReplayStepContent, ReplayTransportBar |
| Key stores | sessionDetail, search, configInjector, orchestrationHome, worktrees, toast |
| Key components | SearchPalette, SetupWizard, IndexingLoadingScreen |

### 3.6 UI Package Test Gaps 🟡 MEDIUM

424 tests across 45 files (excellent), but 30+ source files have zero tests:
- 10 exported components (ActionButton, ConfirmDialog, DataTable, ErrorAlert, StatusIcon, TokenBar, etc.)
- 14 internal renderers (AskUserRenderer, GlobTreeRenderer, ShellOutputRenderer, SqlResultRenderer, WebSearchRenderer, etc.)
- 3 composables (useLiveDuration, useSessionTabLoader, useToggleSet)
- 2 utilities (syntaxHighlight, agentTypes, toolCall)

### 3.7 No Coverage Configuration 🟡 MEDIUM

Neither `apps/desktop/vitest.config.ts` nor `packages/ui/vitest.config.ts` configure coverage. No `@vitest/coverage-v8` dependency. Cannot measure actual line/branch coverage.

### 3.8 No End-to-End Tests 🟡 MEDIUM

No Playwright or Cypress tests. No cross-platform testing infrastructure.

### 3.9 Rust Test Gaps 🟡 MEDIUM

Strong Rust testing overall (156 core + 40 indexer + 52 orchestrator), but gaps:
- No integration test for full pipeline (discovery → parsing → summary → analytics)
- No parity tests between in-memory aggregator and indexer analytics paths

> **Correction**: Tests for `health::compute_health` DO exist at `health/mod.rs:228-250`.

---

## 4. CI/CD & Infrastructure

### 4.1 CI Pipeline Incomplete 🔴 CRITICAL

`.github/workflows/ci.yml` exists but has critical gaps:

| Issue | Impact |
|-------|--------|
| **No PR trigger** — only runs on push to `main` | PRs are not validated before merge |
| **Rust lint (clippy) disabled** — commented out at line 54-56 | Rust quality not enforced |
| **Frontend lint (biome) disabled** — commented out at line 64-66 | TS/Vue quality not enforced |
| **No security scanning** — no `cargo audit`, `npm audit`, CodeQL | Vulnerabilities undetected |
| **No production build step** — CI only runs tests/typecheck | Build breakage undetected until release |

### 4.2 Dependabot Disabled 🟠 HIGH

`.github/dependabot.yml` has `updates: []`. The original configuration for npm, cargo, and github-actions is commented out. No automated dependency updates.

### 4.3 Release Pipeline — Windows-Only Binaries 🟠 HIGH

`.github/workflows/release.yml` — release creation runs on `ubuntu-latest` (L24) but **installer/binary builds only target `windows-latest`** (L65). No macOS or Linux release artifacts. For a Tauri app claiming cross-platform support, this is a major gap.

### 4.4 No Cargo Release Profile 🟠 HIGH

Root `Cargo.toml` has no `[profile.release]` section. Missing LTO, strip, codegen-units optimization. Release binary is larger and slower than necessary.

### 4.5 Deprecated Dependency 🟡 MEDIUM

`serde_yaml = "0.9"` is archived/deprecated by its author. Should migrate to `serde_yml` or another maintained alternative.

### 4.6 Scripts Are Windows-Only 🟡 MEDIUM

All 5 scripts are `.ps1` (PowerShell). No cross-platform alternatives (Makefile, justfile, shell scripts). Desktop `package.json` tauri script is also Windows-specific.

### 4.7 Script Robustness Issues 🟡 MEDIUM

| Script | Issue |
|--------|-------|
| `build.ps1` | Assumes repo-root cwd, unlike `clean.ps1` which self-resolves |
| `bump-version.ps1` | `cargo check` failure ignored before printing success |
| `clean.ps1` | Prints frontend clean success without checking exit code |
| `bench.ps1` | `-Save`/`-Compare` without `-Baseline` silently degrades |

### 4.8 Version Scattered Across 13+ Files 🟡 MEDIUM

Version `0.4.0` appears in Cargo.toml (workspace), all package.json files, tauri.conf.json, and hardcoded in SetupWizard.vue, AppSidebar.vue, SettingsView.vue. `bump-version.ps1` exists but is easy to forget. CI checks version consistency but only between Cargo and root package.json.

### 4.9 Biome Rules Too Lenient 🟢 LOW

`biome.json` sets `noExplicitAny` to `"warn"` instead of `"error"`. `any` types can slip through unchallenged.

### 4.10 Unused Workspace Dependencies 🟢 LOW

`clap` declared in workspace deps but only used by bench crate (if at all). `tracing-subscriber` declared but initialization may be incomplete.

### 4.11 `.gitignore` Gaps 🟢 LOW

Missing patterns: `coverage/`, `*.log`, `pnpm-debug.log*`, `.cache/`, `.turbo/`, generic `.env.*` (only `.env.*.local` covered).

---

## 5. Documentation & Legal

### 5.1 Stale Documentation 🟠 HIGH

Several docs contain statements that are now false:

| Doc | False Claim | Reality |
|-----|------------|---------|
| `versioning-updates-release-strategy.md:59-70` | "No CHANGELOG.md, no .github/workflows/" | Both exist |
| `archive/2026-04/tech-debt-report.md:580-585` | "No CI/CD pipeline exists" | CI exists (incomplete) |
| `archive/2026-04/tech-debt-report.md:572` | "apps/cli/dist/ committed to git" | Not tracked currently |
| `archive/2026-04/tech-debt-report.md:625` | "No LICENSE file" | LICENSE exists (GPL-3.0) |
| CLI `README.md:8-10` | `search` "coming soon" | Implemented |
| CLI `README.md` | Missing `resume`, `index`, `versions` docs | Commands exist |

### 5.2 Broken Links 🟠 HIGH

`docs/copilot-sdk-deep-dive.md:1559-1562` links to 4 missing files:
- `docs/reviews/sdk-review-opus.md`
- `docs/reviews/sdk-review-gpt54.md`
- `docs/reviews/sdk-review-codex53.md`
- `docs/reviews/sdk-review-gemini.md`

### 5.3 Missing Essential Docs 🟡 MEDIUM

| Document | Status |
|----------|--------|
| `CONTRIBUTING.md` | Does not exist |
| `SECURITY.md` | Does not exist |
| API reference for Tauri IPC commands | Does not exist |
| `docs/README.md` or docs index | Does not exist |
| Package-level README for `@tracepilot/ui` | Does not exist |

### 5.4 Missing Rust Doc Comments 🟡 MEDIUM

Substantial public API surface is undocumented:
- `tracepilot-tauri-bindings` — 60+ public commands/DTOs with zero doc comments
- `tracepilot-orchestrator/types.rs` — 20+ public types undocumented
- `tracepilot-core/models/event_types.rs` — 30+ public event data structs undocumented
- `ConversationTurn` — 10/13 fields undocumented
- `analytics/types.rs` — 16 public structs with zero field docs

### 5.5 README Screenshot Placeholders 🟡 MEDIUM

Root README has 5 `<!-- SCREENSHOT: ... -->` HTML comment placeholders with no actual images. Published README would show no visual representation of the app.

### 5.6 Historical Docs Not Clearly Marked 🟡 MEDIUM

Many docs under `docs/` are historical planning/research docs that can confuse readers into thinking they represent current state. No clear separation between "current operational docs" and "historical records".

### 5.7 License Wording Inconsistency 🟢 LOW

LICENSE file is GPL-3.0, SPDX identifiers say `GPL-3.0-or-later`, README says "GNU General Public License v3.0". Minor inconsistency.

### 5.8 Empty Directories 🟢 LOW

`docs/decisions/` — empty (ADRs planned but none written).

### 5.9 Design Prototype Dead Weight 🟢 LOW

`docs/design/prototypes/shared/` contains ~3,300 lines of dead CSS (`design-system-{a,b,c}.css`) and a `shared.js` with mock data. Archival candidates.

### 5.10 `@tracepilot/config` Package Near-Empty 🟢 LOW

Description claims "Shared TypeScript, ESLint, and Tailwind configuration presets". Reality: only `typescript/base.json` has content. `eslint/` directory is empty (repo uses Biome).

---

## 6. UX & Accessibility

### 6.1 Dialog/Modal Accessibility 🟠 HIGH

Multiple dialog implementations lack critical a11y features:

| Component | Missing |
|-----------|---------|
| `ModalDialog.vue` | Focus trap, focus restoration, `aria-labelledby` |
| `ConfirmDialog.vue` | Focus trap, focus restoration (inherits ModalDialog issues) |
| `SearchPalette.vue` | `aria-modal`, focus trap |
| `UpdateInstructionsModal.vue` | `aria-modal`, Escape handling, focus trap |
| `WhatsNewModal.vue` | Same as above |

### 6.2 Missing `type="button"` on Buttons 🟠 HIGH

22+ `<button>` elements across UI package components are missing `type="button"`, risking unintentional form submission. Affects: ActionButton, BtnGroup, ConfirmDialog, ErrorAlert, ErrorState, FormSwitch, ModalDialog, ReasoningBlock, SearchInput, TabNav, TerminologyLegend, ToastContainer, ToolCallDetail, ToolCallItem, ToolDetailPanel, EditDiffRenderer, RendererShell, ToolArgsRenderer.

### 6.3 Clickable Divs Without Keyboard Support 🟡 MEDIUM

Multiple interactive elements use `<div>` with click handlers but lack proper keyboard semantics:
- `ToolCallsGroup.vue:28-39` — no tabindex, no keyboard handlers
- `OverviewTab.vue:246-255` — checkpoint rows
- `SessionSearchView.vue:551-558` — search result cards
- `WorktreeManagerView.vue:451-494,667-676` — tree/worktree rows
- `OrchestrationHomeView.vue:195-204` — quick action cards (Space not handled)

### 6.4 Icon-Only Buttons Without Accessible Names 🟡 MEDIUM

15+ icon-only buttons across the desktop app use `title` or symbol text (✕, +, −) without `aria-label`:
- RefreshToolbar, SearchPalette, TodoDependencyGraph zoom controls
- SettingsPricing add/remove buttons
- ConfigInjectorView dismiss/remove buttons
- WorktreeManagerView action buttons

### 6.5 Inputs Missing Programmatic Labels 🟡 MEDIUM

12+ inputs/selects across the app rely on visual proximity rather than `<label for>` or `aria-label`:
- SearchPalette, TodoDependencyGraph, ExportView, SettingsLogging
- SessionSearchView, ConfigInjectorView, SessionLauncherView, WorktreeManagerView

### 6.6 TabNav ARIA Pattern Incomplete 🟡 MEDIUM

`TabNav.vue` uses `role="tablist"`/`role="tab"` but doesn't implement the expected pattern: missing `aria-controls`, tabpanel association, and arrow-key roving focus.

### 6.7 GlobTreeRenderer Tree Semantics Without Keyboard 🟡 MEDIUM

Applies `role="tree"`/`role="treeitem"` to non-focusable `<div>` elements with no keyboard navigation.

### 6.8 `aria-expanded` Without `aria-controls` 🟡 MEDIUM

4 disclosure components use `aria-expanded` without `aria-controls`: ReasoningBlock, TerminologyLegend, ToolCallItem, ToolArgsRenderer.

### 6.9 No i18n Infrastructure 🟡 MEDIUM

Zero localization setup — no `createI18n`, no `$t()`, all strings hardcoded in English. Not a blocker for English-only release but limits international adoption.

### 6.10 `TokenBar` Missing Progress Semantics 🟢 LOW

Visually a progress bar but has no `role="progressbar"` or associated ARIA attributes.

### 6.11 `FormSwitch` Can Be Unnamed 🟢 LOW

`aria-label` depends on optional `label` prop. If omitted, switch has no accessible name.

### 6.12 `MiniTimeline` Progressbar Incomplete 🟢 LOW

Has `role="progressbar"` but no accessible name and no `aria-valuemin`.

### 6.13 Global Keyboard Shortcut Interference 🟢 LOW

`SearchPalette.vue:173-181` — Ctrl/Cmd+K handler fires even when user is typing in input/textarea/contenteditable fields.

### 6.14 Feature-Flagged Routes Silently Redirect 🟢 LOW

Router guard silently redirects disabled experimental routes to sessions list with no explanation.

---

## 7. Performance

### 7.1 N+1 Query in Search 🟠 HIGH

`tauri-bindings` search performs disk I/O per FTS result to hydrate session summaries. For large result sets, this is slow.

### 7.2 Full Event Re-Parse on Every Paginated Request 🟠 HIGH

`tauri-bindings/lib.rs` re-parses entire `events.jsonl` on every paginated events request. Large sessions (5000+ events) cause noticeable lag.

### 7.3 No Virtual Scrolling 🟡 MEDIUM

No virtualization for session lists, event lists, or timeline views. 1000+ items render all DOM nodes.

### 7.4 Timeline Component Monoliths 🟡 MEDIUM

Three 1,000+ line components (AgentTreeView, TurnWaterfallView, NestedSwimlanesView) re-render entire trees on any state change. No `v-memo`, no component splitting.

### 7.5 Inline Computed Calls in Templates 🟡 MEDIUM

`ConversationTab.vue:91` — `turn.assistantMessages.filter(m => m.trim())` called inline in `v-for` 3× (should be computed property).

### 7.6 Memory Leaks — Uncleaned Timers 🟡 MEDIUM *(NEW — from review)*

| Component | Issue | Location |
|-----------|-------|----------|
| `ConfigInjectorView.vue` | `autoSaveTimer` setTimeout not cleared on unmount | Lines 87-94 |
| `SessionListView.vue` | `driftTimeout` not cleared in `onUnmounted` | Lines 84-103 |
| `ConversationTab.vue` | `IntersectionObserver` + 2 timers created in `scrollAndHighlight()` with no teardown | Lines 51-66 |

### 7.7 Preferences Watch Without Debounce 🟢 LOW

`preferences.ts:95` — `watch(modelWholesalePrices, { deep: true })` triggers full `save()` on every cell edit.

### 7.8 No Responsive Chart Handling 🟢 LOW

Chart SVGs use fixed viewBox coordinates. No responsive resize handling for window size changes.

---

## 8. Security (Remaining Items from Security Audit)

The security audit (2026-03-22) fixed 7 issues. 11 remain, all Low-Medium:

| ID | Issue | Severity |
|----|-------|----------|
| R-1 | CSP allows `unsafe-inline` for styles | Medium |
| R-2 | CLI command whitelist includes colon | Medium |
| R-4 | Unbounded FTS search results | Medium |
| R-3 | TOCTOU in version manager file ops | Low |
| R-5 | Integer casts without bounds checking in analytics | Low |
| R-6 | Env var trust for home directory | Low |
| R-7 | `v-html` with pre-escaped content (safe but unnecessary) | Low |
| R-9 | Path input without client-side validation | Low |
| R-10 | Manifest response not validated with `Array.isArray()` | Low |
| R-11 | `unsafe env::set_var` in test code | Low |
| NEW | `WebSearchRenderer` leaks domains to Google favicon service | Medium |

---

## 9. Miscellaneous Issues

### 9.1 `tauri-bindings/lib.rs` Monolith 🟡 MEDIUM

2,328 lines in a single file. 78 Tauri commands live together. Should split into domain modules (session, indexing, analytics, config, utility).

### 9.2 Dual Analytics Path 🟡 MEDIUM

Two parallel analytics systems: in-memory aggregator (core) and pre-computed indexer path. Tauri app only uses indexer. No parity tests. Risk of divergent results.

### 9.3 Wrong Default Path in Settings 🟠 HIGH

`SettingsDataStorage.vue:25` shows `~/.copilot/sessions/` but actual path is `~/.copilot/session-state/`. Concrete product bug that would confuse users.

### 9.4 `ToolDetailPanel` vs `ToolCallDetail` Default Disagreement 🟡 MEDIUM

`ToolDetailPanel` defaults `richEnabled` to **false** (`?? false`); `ToolCallDetail` defaults it to **true** (`!== false`). Inconsistent behavior depending on which component renders the tool.

### 9.5 `ViewCodeRenderer` Misclassifies Extensionless Files 🟢 LOW

Files like `LICENSE`, `README`, `Gemfile`, `Procfile` are treated as directory listings because the extension check fails for extensionless filenames.

### 9.6 Feature-Flag Guard Race with Preferences Hydration 🟡 MEDIUM *(NEW — from review)*

Router guard at `router/index.ts:233-242` checks feature flags synchronously, but preferences hydrate asynchronously. Deep-linking to `/health`, `/replay`, or `/export` during startup will be wrongly redirected to `/sessions` before preferences load.

### 9.7 No Router Error Handling 🟡 MEDIUM *(NEW — from review)*

No `router.onError()` handler. Failed lazy-loaded chunk imports (network errors, cache issues) produce blank pages with no recovery UI. No `<Suspense>` boundary or async component loading state.

### 9.8 Search Palette Masks Backend Failures 🟡 MEDIUM *(NEW — from review)*

`SearchPalette.vue` swallows search errors and displays "no results" state, making backend failures indistinguishable from empty results.

> **Removed**: §9.6 originally claimed version `v0.1.0` hardcoded in SetupWizard/AppSidebar — this is **false**. Both use `useAppVersion()` composable for dynamic versioning.

---

## Appendix A: Quantitative Summary

| Metric | Value |
|--------|-------|
| Rust crates | 6 (+ 1 desktop) |
| TS/Vue packages | 5 |
| Total Rust tests | ~248 |
| Total TS/Vue tests | ~640 |
| STUB comments in frontend | ~20 |
| Production `unwrap()` in Rust | 7 critical paths |
| `.map_err(\|e\| e.to_string())` flattening | **171** instances |
| Tauri `#[tauri::command]` annotations | **78** |
| `console.error/warn` in shipped code | 33+ |
| `as any` in production code | 3 |
| `as any` in test code | 50+ |
| Hardcoded hex colors bypassing design system | 67+ |
| Inline styles | 130+ static, 26+ dynamic |
| Undocumented public Rust items | 100+ |
| Views with zero test coverage | 20+ |
| CI lint steps disabled | 2 (clippy + biome) |
| Phases complete | 3 of 7 |
| Phases remaining | 4 (Health, Export, Advanced, Distribution) |
| Production bundle JS | ~400 kB (144 kB gzip) |
| Mock data bundled in production | ~69 kB |

---

## Appendix B: What's Working Well ✅

Credit where due — these areas are solid:

1. **Architecture** — Clean Rust/TS separation, modular crate design, Tauri 2 integration
2. **Design System** — 65+ CSS tokens, dark/light theming, `prefers-reduced-motion`, `prefers-contrast`
3. **Security** — Zero critical vulnerabilities, proper HTML escaping, parameterized SQL, path traversal prevention
4. **Session Parsing** — Robust Rust parsers for all Copilot CLI session artifacts
5. **FTS5 Search** — Well-implemented full-text search with incremental indexing
6. **Orchestration** — Session launcher, config injector, worktree manager — unique differentiating features
7. **Conversation Viewer** — Excellent tool renderers (15+ specialized), subagent attribution, 3 viewing modes
8. **Analytics Dashboards** — Interactive SVG charts with tooltip composable, repo filtering, time ranges
9. **Session Replay** — Step-through playback with rich content rendering
10. **Documentation** — 37 docs covering architecture, design, security, research — unusually thorough
11. **Conventional Commits** — lefthook enforcement, git-cliff changelog, version bumping script
12. **UI Component Library** — 30+ shared components with 424 tests
13. **Version Analysis CLI** — Unique tooling for tracking Copilot CLI schema changes

---

## Appendix C: Multi-Model Review Summary

This report was validated by 4 independent AI models. Here is the consolidated outcome:

| Reviewer | Verdict | False Positives Found | Missing Issues Found | Key Contribution |
|----------|---------|----------------------|---------------------|-----------------|
| **Claude Opus 4.6** | 92% validated | 3 (SessionComparison, version hardcoding, .mb-4) | 8 (race conditions, timer leaks, router gaps) | Deepest validation — async race condition analysis |
| **GPT 5.4** | Mostly validated | 5 (SessionComparison, health tests, main.ts handler, release workflow, export crate) | 5 (mock bundling, module resolution, cross-platform, dependency hygiene, bundle size) | Mock bundling discovery, dependency audit |
| **Codex 5.3** | Partially validated | 3 (SessionComparison, guarded unwraps, health API) | 4 (restore path bypass, CI no build, main.rs panic, diff hide) | Security-focused — restore path validation gap |
| **Gemini 3 Pro** | Mostly validated | 4 (SessionComparison, main.ts handler, phases doc, ModalDialog aria-modal) | 3 (config persistence bug, config upgrade path, search palette masking) | Config persistence gap discovery |

### Consolidated Corrections Applied
- **Removed**: SessionComparisonView from stub list (functional since review)
- **Removed**: Version hardcoding false positive (uses `useAppVersion()`)
- **Removed**: `health::compute_health` no-tests claim (tests exist)
- **Corrected**: `.map_err` count from ~37 → **171**
- **Corrected**: Tauri command count from 25+ → **78**
- **Corrected**: lib.rs line count from 2,475 → **2,328**
- **Corrected**: Screenshot placeholders from 7 → **5**
- **Corrected**: Release workflow is not entirely Windows-only (release creation on Ubuntu)
- **Corrected**: Global Vue error handler exists (window-level handlers still missing)
- **Downgraded**: 5 items from CRITICAL → HIGH (feature-flagged stubs, test gaps, error handling)
- **Added**: 10 new findings from review (race conditions, mock bundling, config bugs, timer leaks, etc.)

---

---

# ADDENDUM: Pre-Release Action Plan

## Methodology

Issues are grouped into **workstreams** and ordered by **criticality** (blocking → important → nice-to-have). Dependencies between items are noted. Each workstream can be executed by a separate developer or in sequence by one.

---

## Priority Tier 1: RELEASE BLOCKERS
*Must fix before any public release. These can crash the app, corrupt data, or undermine basic trust.*

### Workstream A: Rust Safety & Error Handling

| # | Task | Findings | Effort |
|---|------|----------|--------|
| A1 | **Replace production `unwrap()` on locks** — Use `match` or `.unwrap_or_else()` with graceful degradation for all 5 RwLock/Mutex unwraps in `tauri-bindings/lib.rs` | §2.1 | Small |
| A2 | **Replace production panic paths** — Fix unwraps in `events.rs:367`, `turns/mod.rs:744`, `event_types.rs:177`, `version_manager.rs:200`, `main.rs:60` | §2.1, Codex review | Small |
| A3 | **Define `TauriError` enum with Serialize** — Replace all 171 `.map_err(\|e\| e.to_string())` with structured error types. Frontend can then distinguish error kinds. | §2.2 | Large |
| A4 | **Add `[profile.release]`** — LTO, strip, codegen-units=1 for smaller/faster binaries | §4.4 | Tiny |

**Dependency**: A3 is the largest item here. Consider an incremental approach — define the enum first, migrate top-20 most-called commands, then sweep the rest.

### Workstream B: CI/CD Pipeline

| # | Task | Findings | Effort |
|---|------|----------|--------|
| B1 | **Add PR trigger** to `ci.yml` (`on: pull_request`) | §4.1 | Tiny |
| B2 | **Enable clippy** — Uncomment lines 54-56, fix any warnings | §4.1 | Small |
| B3 | **Enable biome lint** — Uncomment lines 64-66, fix any warnings | §4.1 | Small |
| B4 | **Add production build step** — `cargo build --release` + `pnpm build` in CI | §4.1, GPT review | Small |
| B5 | **Add `cargo audit`** step for dependency vulnerability scanning | §4.1 | Tiny |
| B6 | **Re-enable Dependabot** — Uncomment `.github/dependabot.yml` config | §4.2 | Tiny |

**Dependency**: B1 first, then B2-B6 can be done in parallel.

---

## Priority Tier 2: HIGH IMPORTANCE
*Should fix before release. These cause data corruption, hide failures, or break user trust.*

### Workstream C: Frontend Reliability

| # | Task | Findings | Effort |
|---|------|----------|--------|
| C1 | **Fix async race conditions in 5 stores** — Add generation tokens to preferences save, stale-response guards to search facets, cancellation to worktrees branches, requestToken bump in sessionDetail reset | §2.10 (NEW) | Medium |
| C2 | **Surface store errors to UI** — Replace console.error-only catches in sessionDetail (7 functions) with reactive error state + ErrorState components | §2.3, §2.23 | Medium |
| C3 | **Add `window.onerror` + `unhandledrejection` handlers** in main.ts | §2.3 | Small |
| C4 | **Replace `Promise.all` with `Promise.allSettled`** in configInjector.ts | §2.3 | Tiny |
| C5 | **Fix wrong settings path** — `SettingsDataStorage.vue:25` → `~/.copilot/session-state/` | §9.3 | Tiny |
| C6 | **Fix config persistence bug** — Add `renderMarkdown` to Rust `AppConfig` struct | §2.12 (NEW) | Small |
| C7 | **Add config version field + migration logic** — Handle malformed/future configs gracefully | §2.13 (NEW) | Medium |
| C8 | **Lazy-load mock data** — Dynamic `import()` in client package instead of eager import | §2.11 (NEW) | Small |
| C9 | **Clean up timer/observer leaks** — Add `onUnmounted` cleanup in ConfigInjectorView, SessionListView, ConversationTab | §7.6 (NEW) | Small |

### Workstream D: Testing Foundation

| # | Task | Findings | Effort |
|---|------|----------|--------|
| D1 | **Add Tauri IPC bridge tests** — At minimum, test top-10 most-used commands with mock state | §3.1 | Large |
| D2 | **Add CLI test suite** — Cover list, show, search, versions commands + argument validation | §3.2 | Medium |
| D3 | **Add `@tracepilot/client` tests** — Verify mock fallback, IPC invoke naming | §3.3 | Small |
| D4 | **Add coverage configuration** — `@vitest/coverage-v8` to both desktop and UI vitest configs | §3.7 | Small |
| D5 | **Fix CLI argument bugs** — `--sort` ignored, `--limit` accepts negatives, empty search | §2.13 | Small |

### Workstream E: Accessibility (WCAG AA Minimum)

| # | Task | Findings | Effort |
|---|------|----------|--------|
| E1 | **Add focus trap to ModalDialog** — Use `@vueuse/integrations/useFocusTrap` or custom | §6.1 | Medium |
| E2 | **Add `type="button"` to all 22+ buttons** in UI package | §6.2 | Small |
| E3 | **Replace clickable divs with `<button>` or add keyboard semantics** — 5+ components | §6.3 | Medium |
| E4 | **Add `aria-label` to icon-only buttons** — 15+ instances | §6.4 | Small |
| E5 | **Add programmatic labels** to 12+ inputs/selects | §6.5 | Small |

---

## Priority Tier 3: MEDIUM IMPORTANCE
*Should fix before or shortly after initial release. Improves quality and maintainability.*

### Workstream F: Code Quality Cleanup

| # | Task | Findings | Effort |
|---|------|----------|--------|
| F1 | **Split `tauri-bindings/lib.rs`** into domain modules (session, index, analytics, config, orchestration) | §9.1 | Medium |
| F2 | **Extract duplicated agent color maps** into shared util | §2.7 | Small |
| F3 | **Replace hardcoded colors** with CSS variable references (67+ instances) | §2.9 | Medium |
| F4 | **Consolidate inline styles** into CSS classes (130+ instances) | §2.8 | Large |
| F5 | **Remove dead code** — ThemeToggle, EditDiffRenderer unused code, Badge unused import, CLI unused imports | §2.11 | Small |
| F6 | **Fix `WebSearchRenderer` privacy leak** — Bundle favicon locally or use data URIs | §2.12 | Small |
| F7 | **Fix `ToolDetailPanel`/`ToolCallDetail` default disagreement** | §9.4 | Tiny |

### Workstream G: Documentation

| # | Task | Findings | Effort |
|---|------|----------|--------|
| G1 | **Update stale docs** — Fix false claims in tech-debt-report, versioning doc, CLI README | §5.1 | Medium |
| G2 | **Fix broken links** in copilot-sdk-deep-dive.md | §5.2 | Tiny |
| G3 | **Create CONTRIBUTING.md and SECURITY.md** | §5.3 | Small |
| G4 | **Add README screenshots** — Replace 5 placeholders with actual app screenshots | §5.5 | Small |
| G5 | **Add Rust doc comments** to public API (prioritize tauri-bindings and core/models) | §5.4 | Large |
| G6 | **Create docs index** (`docs/README.md`) separating current vs historical docs | §5.6 | Small |

### Workstream H: Infrastructure

| # | Task | Findings | Effort |
|---|------|----------|--------|
| H1 | **Add macOS/Linux release targets** to release.yml | §4.3 | Medium |
| H2 | **Migrate from deprecated `serde_yaml`** to `serde_yml` or alternative | §4.5 | Small |
| H3 | **Add cross-platform scripts** — Justfile or Makefile alongside .ps1 | §4.6 | Medium |
| H4 | **Fix `.gitignore` gaps** — Add coverage/, *.log, .cache/, .turbo/ | §4.11 | Tiny |
| H5 | **Fix package module resolution** — Add build steps or use `.ts` extensions in exports for `@tracepilot/client` and `@tracepilot/types` | §2.14 (NEW) | Small |

---

## Priority Tier 4: LOW / POLISH
*Address when time permits. Improves polish but not blocking.*

### Workstream I: Remaining Items

| # | Task | Findings | Effort |
|---|------|----------|--------|
| I1 | **Complete TabNav ARIA pattern** — Add arrow-key roving focus, aria-controls | §6.6 | Medium |
| I2 | **Add virtual scrolling** for session/event lists | §7.3 | Medium |
| I3 | **Fix ViewCodeRenderer** extensionless file handling | §9.5 | Tiny |
| I4 | **Add `TokenBar` progressbar role** | §6.10 | Tiny |
| I5 | **Add responsive chart handling** | §7.8 | Small |
| I6 | **Remove design prototype dead weight** from docs/design/prototypes/shared/ | §5.9 | Tiny |
| I7 | **Clean up `@tracepilot/config`** — Either populate or remove | §5.10 | Tiny |
| I8 | **Address remaining 11 security audit items** (all Low-Medium) | §8 | Medium |
| I9 | **Scope Ctrl+K shortcut** to not fire from inputs | §6.13 | Tiny |
| I10 | **Add `FormSwitch` required aria-label** when label prop omitted | §6.11 | Tiny |

---

## Suggested Execution Order

For a solo developer or small team, the recommended order maximizes safety and unblocks dependent work:

```
Week 1:  B1-B6 (CI pipeline) → A1-A2 (crash fixes) → C5-C6 (quick product bugs)
Week 2:  A3 (structured errors — start) → C1 (race conditions) → C3-C4 (error handlers)
Week 3:  A3 (continue) → D1 (tauri tests) → E1-E2 (critical a11y)
Week 4:  D2-D3 (CLI/client tests) → C7-C8 (config migration, mock bundling)
Week 5:  F1 (split lib.rs) → G1-G3 (docs) → E3-E5 (remaining a11y)
Week 6:  H1 (cross-platform builds) → F3-F4 (style cleanup) → G4-G5 (screenshots, doc comments)
Ongoing: I1-I10 as time permits
```

For parallel teams:
- **Team Backend**: A1-A4 → D1 → F1 → A3
- **Team Frontend**: C1-C9 → E1-E5 → F2-F6
- **Team Infra/Docs**: B1-B6 → H1-H5 → G1-G6

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| A3 (structured errors) is large and touches 171 call sites | Incremental migration — start with enum + top-20 commands |
| F4 (inline style cleanup) is tedious and risky for regressions | Add visual regression tests (Playwright screenshots) first |
| D1 (tauri tests) requires Tauri test harness setup | Start with unit tests on pure logic extracted from lib.rs |
| H1 (cross-platform builds) may surface platform-specific bugs | Start with macOS (most users), Linux second |

---

*End of Pre-Release Audit Report and Action Plan*
