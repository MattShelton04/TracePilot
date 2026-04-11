# TracePilot Code Duplication & Architecture Consolidation Report

**Generated**: 2026-04-11
**Scope**: Full codebase audit — Rust backend (6 crates), Vue/TypeScript frontend (desktop app + 4 shared packages), infrastructure/config
**Review process**: Deep analysis by 5 parallel explore agents + manual investigation; reviewed and validated by Claude Opus 4.6, GPT 5.4, and GPT 5.3 Codex — see §7 for consolidated review findings, corrections, and reprioritization.

> **Methodology**: Findings are grounded in concrete code evidence — file paths, line numbers, grep counts, and code snippets. Where assumptions are made, they are flagged explicitly. This report supersedes the March 2026 tech-debt-report.md with deeper analysis of duplication patterns and architecture consolidation opportunities.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Frontend: Page Layout & View Architecture](#2-frontend-page-layout--view-architecture)
3. [Frontend: Store & Composable Patterns](#3-frontend-store--composable-patterns)
4. [Frontend: CSS & Styling Tech Debt](#4-frontend-css--styling-tech-debt)
5. [Backend: Rust Crate Architecture](#5-backend-rust-crate-architecture)
6. [Cross-Cutting: Config, Router, Tests, Packages](#6-cross-cutting-config-router-tests-packages)
7. [Model Review Panel (Opus 4.6 / GPT 5.4 / Codex 5.3)](#7-model-review-panel)
8. [Prioritized Implementation Plan](#8-prioritized-implementation-plan)

---

## 1. Executive Summary

TracePilot's codebase is well-structured at the macro level — monorepo with clear crate/package boundaries, shared types package, design token system, and a component library. However, **organic growth has introduced significant duplication** that increases maintenance cost and inconsistency risk. The most impactful findings:

| Area | Severity | Summary |
|------|----------|---------|
| **Page layout standardization** | 🔴 High | 21 views repeat `page-content > page-content-inner` wrapper + ad hoc loading/error/empty states. No shared page shell. |
| **Store async boilerplate** | 🔴 High | 10+ stores repeat identical `loading/error/try-catch` patterns (~15-20 LOC each). |
| **Stat card / section panel raw HTML** | 🟡 Medium | `StatCard` and `SectionPanel` Vue components exist in `@tracepilot/ui` but views use raw CSS classes instead (17+ stat-card instances, 19+ section-panel instances). |
| **Rust ↔ TS type mirroring** | 🔴 High | Types manually duplicated between Rust and TypeScript with no codegen; silent drift risk. |
| **Feature flag defaults drifting** | 🔴 High | Three sources of feature flag defaults are already out of sync (active bug). |
| **Rust DB connection setup** | 🟡 Medium | SQLite PRAGMA setup duplicated across 2 crates (indexer + orchestrator). |
| **Tauri command boilerplate** | 🟡 Medium | `SharedTaskDb` lock + init pattern repeated ~13 times; `spawn_blocking` repeated ~19 times. |
| **Mega-SFC views** | 🟡 Medium | PresetManagerView (3075 lines), SessionSearchView (1734), TaskDashboardView (1384) — logic, rendering, and styling fused. |
| **CSS token namespace drift** | 🟡 Medium | Legacy `--color-*`, `--bg-*` tokens used alongside canonical `--canvas-*`, `--text-*` tokens. |
| **Test helper duplication** | 🟢 Low | Pinia setup repeated 26 times; domain builders duplicated across packages. |
| **Dependency version drift** | 🟢 Low | Minor version mismatches across workspaces. |

---

## 2. Frontend: Page Layout & View Architecture

### 2.1 The Core Problem: No Shared Page Shell

**Every view independently implements the same page structure.** There are 21 views that follow this pattern:

```vue
<template>
  <div class="page-content">
    <div class="page-content-inner">
      <!-- Page header (ad hoc) -->
      <!-- Error state -->
      <!-- Loading state -->
      <!-- Content -->
      <!-- Empty state -->
    </div>
  </div>
</template>
```

**Evidence** (grep: `class="page-content"` across all `.vue` files — **21 matches**):

| View | Has page-content-inner | Loading pattern | Error pattern | Empty state |
|------|----------------------|-----------------|---------------|-------------|
| `SessionListView.vue` | ✅ | `LoadingSpinner` + custom div | `ErrorAlert` | `EmptyState` |
| `AnalyticsDashboardView.vue` | ✅ | `LoadingOverlay` | `ErrorState` | — |
| `HealthScoringView.vue` | ✅ | `LoadingOverlay` | `ErrorState` | — |
| `ToolAnalysisView.vue` | ✅ | `LoadingOverlay` | `ErrorState` | — |
| `CodeImpactView.vue` | ✅ | `LoadingOverlay` | `ErrorState` | — |
| `ModelComparisonView.vue` | ✅ | `LoadingOverlay` | `ErrorState` | — |
| `TaskDashboardView.vue` | ✅ | `LoadingSpinner` | `ErrorState` | `EmptyState` |
| `TaskDetailView.vue` | ✅ | `LoadingSpinner` | `ErrorState` | — |
| `TaskCreateView.vue` | ✅ | `LoadingSpinner` | `ErrorState` | — |
| `McpManagerView.vue` | ✅ | Custom | Custom | — |
| `SkillsManagerView.vue` | ✅ | Custom | Custom | — |
| `ExportView.vue` | ✅ | — | — | `EmptyState` |
| `SessionDetailView.vue` | ✅ | `SkeletonLoader` | `ErrorState` | — |
| `SettingsView.vue` | ✅ | — | — | — |
| And 7 more... | ✅ | Various | Various | Various |

**Inconsistencies observed:**
- **Loading**: Some use `LoadingOverlay` (analytics pages), some use `LoadingSpinner` in a custom wrapper div (session list, tasks), some have none.
- **Errors**: Some use `ErrorState` (retry callback), some use `ErrorAlert` (message only), some handle errors in custom markup.
- **Headers**: Analytics pages use `AnalyticsPageHeader`, task pages use a custom `.page-title-row`, other pages have ad hoc headers or none.

#### Recommended: `PageShell` Component

```vue
<!-- packages/ui/src/components/PageShell.vue -->
<template>
  <div class="page-content">
    <div class="page-content-inner">
      <slot name="header" />
      <ErrorState v-if="error" :heading="errorHeading" :message="error" @retry="$emit('retry')" />
      <LoadingOverlay v-else :loading="loading" :message="loadingMessage">
        <EmptyState v-if="empty" v-bind="emptyProps" />
        <slot v-else />
      </LoadingOverlay>
    </div>
  </div>
</template>
```

**Impact**: Eliminates ~8-15 lines of boilerplate per view (21 views = ~170-315 lines removed), plus ensures consistent loading/error UX.

### 2.1b Specialized Shells for Feature Areas

Beyond the generic `PageShell`, the analytics pages share an even more specific pattern — all 4 use `AnalyticsPageHeader` + `LoadingOverlay` + `ErrorState` with an identical template structure:

```vue
<AnalyticsPageHeader :title="..." :subtitle="..." />
<LoadingOverlay :loading="loading" message="...">
  <ErrorState v-if="store.xxxError" ... @retry="store.fetchXxx({ force: true })" />
  <template v-else-if="data">...</template>
</LoadingOverlay>
```

**Recommendation**: Extract `AnalyticsPageShell.vue` that wraps `PageShell` + `AnalyticsPageHeader`, reducing each analytics view to just the content slot.

### 2.1c Collection/Manager Page Pattern

Manager views (MCP, Skills, Tasks, Presets) share a distinct pattern — title row, search/filter toolbar, card grid, empty state. These could benefit from a `CollectionToolbar` component:

```vue
<CollectionToolbar>
  <template #search><SearchInput v-model="store.searchQuery" /></template>
  <template #filters><!-- FilterSelect instances --></template>
  <template #actions><!-- Count label, RefreshToolbar, Add button --></template>
</CollectionToolbar>
```

**Evidence**: 5 views implement this pattern independently:
- `SessionListView.vue:119-149`
- `TaskDashboardView.vue:406-449`
- `SkillsManagerView.vue:133-160`
- `PresetManagerView.vue:459-497`
- `McpManagerView.vue:140-168`

### 2.2 Stat Cards: Component Exists but Not Used

The `StatCard` component exists in `@tracepilot/ui` (`packages/ui/src/components/StatCard.vue`) with props for `value`, `label`, `color`, `trend`, `trendDirection`, `gradient`, `mini`, and `tooltip`.

**But views use raw HTML instead** (grep: `class="stat-card"` — **21 instances across 5 views**):

```vue
<!-- Current (repeated in AnalyticsDashboardView, ToolAnalysisView,
     CodeImpactView, ModelComparisonView, HealthScoringView) -->
<div class="stat-card">
  <div class="stat-card-value accent">{{ formatNumberFull(data.totalCalls) }}</div>
  <div class="stat-card-label">Total Tool Calls</div>
</div>

<!-- Should be -->
<StatCard :value="formatNumberFull(data.totalCalls)" label="Total Tool Calls" color="accent" />
```

**Files to update** (with approximate stat-card div counts):
- `AnalyticsDashboardView.vue` — 5 instances
- `ToolAnalysisView.vue` — 4 instances
- `CodeImpactView.vue` — 4 instances
- `ModelComparisonView.vue` — 4 instances
- `HealthScoringView.vue` — 4 instances

### 2.3 Section Panels: Same Story

`SectionPanel` exists in `@tracepilot/ui` (`packages/ui/src/components/SectionPanel.vue`) but views use raw `div class="section-panel"` + `div class="section-panel-header"` markup directly (grep count: **19 instances across 8 files**).

**Note**: The shared `SectionPanel` component has a slightly different style (scoped CSS adds `margin-bottom: 1.5rem` and different header styling). These would need reconciling — either the global CSS classes in `components.css` become the source of truth for the component, or the component overrides them. **This is a design decision to make before migrating.**

### 2.4 Analytics Page Header Pattern

The `AnalyticsPageHeader` component is used exclusively by 4 analytics views (`AnalyticsDashboardView`, `ToolAnalysisView`, `CodeImpactView`, `ModelComparisonView`) along with the `useAnalyticsPage` composable.

**This is a good pattern worth generalizing.** Other feature areas (tasks, MCP, skills) each implement their own header/toolbar pattern ad hoc.

#### Recommended: `PageHeader` Component

Generalize `AnalyticsPageHeader` to support:
- Title + subtitle
- Optional filter slot (for repo select, time range, etc.)
- Optional actions slot (for refresh, create buttons, etc.)

This replaces ad hoc headers in:
- `TaskDashboardView.vue` (lines 574-625: `.page-title-row`)
- `PresetManagerView.vue` (lines 1555-1597: `.page-title-row`)
- `McpManagerView.vue` (custom header)
- `SkillsManagerView.vue` (custom header)
- `OrchestrationHomeView.vue` (custom header)

### 2.5 Refresh Toolbar Duplication

The `RefreshToolbar` component is used in `SessionListView` and `TaskDashboardView` with the `useAutoRefresh` composable. Other views that need refresh (MCP, orchestration) implement their own refresh buttons.

**Recommendation**: Keep `RefreshToolbar` + `useAutoRefresh` as the standard pattern; migrate MCP and orchestration views to use them. Also standardize on preferences-backed vs local-ref refresh state — session views use `usePreferencesStore`, while task views use local `ref`. This should be unified.

### 2.6 Desktop Components Duplicating Shared UI

Several app-level components replicate functionality from `@tracepilot/ui`:

| Desktop Component | Shared UI Equivalent | Resolution |
|-------------------|---------------------|------------|
| `TaskStatusBadge.vue` | `Badge.vue` | Extend `Badge` with `dot`/`tone` props |
| `PriorityBadge.vue` | `Badge.vue` | Same — add priority-aware color mapping |
| `TaskTypeBadge.vue` | `Badge.vue` | Same |
| `SkillTokenBar.vue` | `TokenBar.vue` | Fold into `TokenBar` with optional `max` prop |

### 2.7 Data Fetching Adoption Gap

The codebase has good shared composables (`useAnalyticsPage`, `useSessionTabLoader`, `useAsyncData`, `useCachedFetch`) but several views don't use them:

| View | Current Pattern | Should Use |
|------|----------------|------------|
| `HealthScoringView.vue` | Manual `data/loading/error` refs | `useAsyncData` |
| `SessionComparisonView.vue` | Manual loading + stale guards | `useAsyncData` |
| `SessionReplayView.vue` | Manual stale-request token | `useAsyncData` |
| `ExportView.vue` | Manual session-dependent fetch | `useCachedFetch` |
| `SessionTimelineView.vue` | Manual watch-based loading | `useSessionTabLoader` |

---

## 3. Frontend: Store & Composable Patterns

### 3.1 Repeated Async Loading Boilerplate

**10+ stores repeat the same pattern** (~15-20 LOC each):

```typescript
// Pattern repeated in: skills.ts, presets.ts, mcp.ts, worktrees.ts,
// tasks.ts, sessions.ts, sessionDetail.ts, configInjector.ts,
// launcher.ts, orchestrator.ts, orchestrationHome.ts, search.ts
const token = loadGuard.start();
loading.value = true;
error.value = null;
try {
  const result = await apiCall(...);
  if (!loadGuard.isValid(token)) return;
  data.value = result;
} catch (e) {
  if (!loadGuard.isValid(token)) return;
  error.value = toErrorMessage(e, "Context message");
} finally {
  if (loadGuard.isValid(token)) loading.value = false;
}
```

**Evidence**: `loading.value = true` appears in **18 files**, `error.value = null` in **19 files**, `toErrorMessage` in **34 files**.

#### Recommended: Shared Store Action Helper

```typescript
// packages/ui/src/composables/useStoreAction.ts
export function useStoreAction(guard: AsyncGuard) {
  return async function runAction<T>(
    loading: Ref<boolean>,
    error: Ref<string | null>,
    fn: () => Promise<T>,
    context?: string,
  ): Promise<T | undefined> {
    const token = guard.start();
    loading.value = true;
    error.value = null;
    try {
      const result = await fn();
      if (!guard.isValid(token)) return undefined;
      return result;
    } catch (e) {
      if (!guard.isValid(token)) return undefined;
      error.value = toErrorMessage(e, context);
      return undefined;
    } finally {
      if (guard.isValid(token)) loading.value = false;
    }
  };
}
```

### 3.2 Repeated Mutation Wrappers

**Stores repeat this mutation pattern 20+ times** across `skills.ts` (19×), `mcp.ts` (11×), `tasks.ts` (9×), `presets.ts` (5×):

```typescript
error.value = null;
try {
  await clientCall(...);
  await reload();
  return true;
} catch (e) {
  error.value = toErrorMessage(e, "context");
  return false;
}
```

#### Recommended: `runMutation` Helper

```typescript
async function runMutation(fn: () => Promise<void>, context: string): Promise<boolean> {
  error.value = null;
  try { await fn(); await reload(); return true; }
  catch (e) { error.value = toErrorMessage(e, context); return false; }
}
```

### 3.3 Repeated Filtered Collection Pattern

Three stores (`skills.ts`, `presets.ts`, `tasks.ts`) implement near-identical list filtering:

```typescript
const searchQuery = ref("");
const filterX = ref("all");
const sortedItems = computed(() => [...items.value].sort((a, b) => a.name.localeCompare(b.name)));
const filteredItems = computed(() => {
  let list = sortedItems.value;
  if (filterX.value !== "all") list = list.filter(/* ... */);
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase();
    list = list.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
  }
  return list;
});
```

#### Recommended: `useFilteredCollection` Composable

```typescript
function useFilteredCollection<T>(items: Ref<T[]>, options: {
  searchFields: (keyof T)[];
  sortBy?: keyof T;
  filters?: Record<string, (item: T, value: string) => boolean>;
}) { /* ... */ }
```

### 3.4 `useAsyncData` is Effectively Unused

`useAsyncData` (`apps/desktop/src/composables/useAsyncData.ts`, 332 lines) is a well-designed composable with retry, refresh, and guard support — **but it has zero production usage**. Analytics uses `useCachedFetch` instead; stores use manual boilerplate.

**Recommendation**: Either adopt `useAsyncData` in simple stores or delete it and standardize on `useCachedFetch` + the `runAction` helper proposed above.

### 3.5 Generic Composables Should Be in Shared Package

These composables in `apps/desktop/src/composables/` are generic Vue utilities, not desktop-specific:

| Composable | Lines | Should move to `@tracepilot/ui` |
|------------|-------|---------------------------------|
| `useAsyncGuard.ts` | 179 | ✅ (pure Vue reactivity) |
| `useAsyncData.ts` | 332 | ✅ (if kept) |
| `useCachedFetch.ts` | 327 | ✅ (generic caching pattern) |
| `useAutoRefresh.ts` | ~60 | ✅ (generic interval/refresh) |

### 3.6 Skills Store Likely Loses Repo Scope After Mutations

`loadSkills(repoRoot?: string)` accepts an optional repo root, but mutations call `await loadSkills()` without it (lines 132, 148, 160, 187, 199, 274, 286, 305, 338 in `skills.ts`).

**This appears to be a bug**: after any mutation, the skill list reverts to global scope regardless of current view context.

**Recommendation**: Persist `currentRepoRoot` in the store and use it for reload.

### 3.7 Client Package `invoke()` Wrapper Duplicated

Four files in `packages/client/src/` each define their own `invoke()` function with slightly different mock behavior:

- `index.ts:60-66` — returns mock data
- `orchestration.ts:27-33` — returns mock data
- `skills.ts:17-23` — throws in non-Tauri
- `mcp.ts:12-18` — throws in non-Tauri

**Recommendation**: Extract to a single `internal/invoke.ts` with configurable fallback strategy.

### 3.8 Types Should Live in `@tracepilot/types`, Not Client

`FtsHealthInfo` and `ContextSnippet` are defined in `packages/client/src/index.ts` (lines 516-545) but consumed as domain types in stores. They should be in `packages/types/src/search.ts`.

---

## 4. Frontend: CSS & Styling Tech Debt

### 4.1 Token Namespace Drift

The canonical design token system uses `--canvas-*`, `--text-*`, `--accent-*`, etc. But several components still use legacy/undefined namespaces:

| File | Legacy Token | Should Be |
|------|-------------|-----------|
| `UpdateBanner.vue:57-60` | `--color-accent-subtle` | `--accent-subtle` |
| `UpdateInstructionsModal.vue:166+` | `--color-fg-default` | `--text-primary` |
| `SessionSearchView.vue:1238` | `--bg-secondary` | `--canvas-subtle` |
| `TaskDashboardView.vue:781,790` | `--bg-tertiary`, `--accent` | `--canvas-inset`, `--accent-fg` |
| `PresetManagerView.vue:2963,3010` | `--bg-tertiary`, `--bg-secondary` | `--canvas-inset`, `--canvas-subtle` |

**Impact**: These tokens fall through to CSS fallback values (often hard-coded hex), creating visual inconsistency across themes.

### 4.2 Hard-Coded Colors Bypassing Tokens

Several files use raw `#fff` instead of `var(--text-on-emphasis)`:
- `UpdateBanner.vue:77-82`
- `UpdateInstructionsModal.vue:313-318`
- `SessionSearchView.vue:1094-1097`
- `SearchResultCard.vue:305-307`
- `ConfirmDialog.vue:179-186` (shared UI!)
- `SegmentedControl.vue:62-65` (shared UI!)

**Hard-coded brand colors** in `SetupWizard.vue` (lines 380-384, 721-722): `#4f46e5`, `#fafafa`, multiple `rgba(99, 102, 241, ...)`. These should be tokenized.

**Syntax highlight palette** duplicated in:
- `CodeBlock.vue:178-191`
- `SqlResultRenderer.vue:133-193`

### 4.3 Duplicate CSS Across Views

- **Search result card styles** duplicated between `SessionSearchView.vue` (lines 988-1097) and `SearchResultCard.vue` (lines 201-308).
- **Page title row** duplicated between `TaskDashboardView.vue` (lines 574-625) and `PresetManagerView.vue` (lines 1555-1597).
- **Button/badge primitives** re-declared in `PresetManagerView.vue` (lines 1719-1805, 1909-1939) despite existing global styles in `components.css`.

### 4.4 Unscoped Global CSS Blocks

- `PresetManagerView.vue:2508-3075` — large unscoped block for teleported slideover.
- `SearchableSelect.vue:316-365` — generic `.select-dropdown`, `.option-item` class names without scoping. **High collision risk.**

### 4.5 Mixed Styling Methodology

The codebase mixes three approaches:
1. **Global primitives** via `components.css`, `layout.css`
2. **BEM-ish local CSS** (e.g., `.preset-card__header`)
3. **Tailwind** (imported in `styles.css:1` but barely used)

**Recommendation**: Pick one direction. Given the existing investment in design tokens + global primitives, recommend standardizing on **tokenized global primitives + scoped local classes**, and deprecating ad hoc Tailwind usage.

---

## 5. Backend: Rust Crate Architecture

### 5.1 SQLite Connection Setup Duplicated

Two crates independently configure SQLite connections with the same PRAGMAs:

```rust
// Repeated in: tracepilot-indexer/index_db/mod.rs:41-57,
//              tracepilot-orchestrator/task_db/mod.rs:28-48
conn.execute_batch("
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
")?;
```

> **Correction**: The original analysis listed 3 crates, but `tracepilot-core/utils/sqlite.rs:45-59` is a `open_readonly()` utility that does NOT set PRAGMAs. Only 2 crates have the full PRAGMA block.

**Recommendation**: Extract to `tracepilot-core::utils::sqlite::open_with_defaults(path, flags) -> rusqlite::Result<Connection>`. With only 2 consumers, this is lower priority than originally assessed — consider as a Phase 3 item.

### 5.2 Migration Runners Inconsistent

- **Indexer** (`index_db/migrations.rs:337-403`): uses `schema_version` table + transactional migration loop.
- **Task DB** (`task_db/mod.rs:70-108`): uses `task_meta` table + ad hoc version checks.

**Recommendation**: Extract a reusable `MigrationRunner` abstraction:
```rust
struct MigrationRunner { migrations: &[Migration], version_table: &str }
impl MigrationRunner { fn run(&self, conn: &Connection) -> Result<()> { ... } }
```

### 5.3 Transaction Handling is Raw SQL

Multiple crates use raw `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` strings:
- `task_db/operations.rs:36-78`
- `index_db/session_writer.rs:103-106, 328-336`
- `index_db/search_writer/mod.rs:115-179`
- `export/import/writer.rs:288-345`

**Recommendation**: Use `rusqlite::Transaction`/`Savepoint` wrappers, or add `with_transaction(conn, |tx| ...)` helper.

### 5.4 Tauri Command Boilerplate: `SharedTaskDb` Lock Pattern

The same 3-line mutex lock + init check is repeated **~13 times** in `commands/tasks.rs` (with broader `spawn_blocking` pattern appearing ~19 times):

```rust
let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
```

**Recommendation**: Extract `with_task_db(state, |db| ...)`:
```rust
fn with_task_db<T>(
    state: &SharedTaskDb,
    f: impl FnOnce(&TaskDb) -> Result<T, OrchestratorError>,
) -> CmdResult<T> {
    let guard = state.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
    let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
    f(db).map_err(BindingsError::Orchestrator)
}
```

### 5.5 Reindex Background Phase Duplicated

`commands/search.rs` has two near-identical background indexing spawns:
- Lines 136-184 (incremental)
- Lines 231-279 (full rebuild)

**Recommendation**: Extract `spawn_search_rebuild_phase(app, cfg, full: bool)`.

### 5.6 DTO Mappings are Manual Field-for-Field Copies

Three conversion sites in `tauri-bindings` manually copy fields between near-identical types:

| From | To | Location |
|------|----|----------|
| `IndexedSession` | `SessionListItem` | `helpers.rs:140-161` |
| `IndexedIncident` | `SessionIncidentItem` | `commands/session.rs:190-200` |
| `SearchResult` | `SearchResultItem` | `commands/search.rs:341-359` |

**Recommendation**: Implement `From<IndexedSession> for SessionListItem`, etc. Example:
```rust
impl From<IndexedSession> for SessionListItem {
    fn from(s: IndexedSession) -> Self {
        SessionListItem {
            id: s.id, summary: s.summary, repository: s.repository,
            // ... remaining fields
        }
    }
}
```

### 5.7 Error Handling: Stringly-Typed Variants

Many orchestrator error variants carry only `String`:
```rust
// tracepilot-orchestrator/error.rs
Git(String), Config(String), Launch(String), Worktree(String),
Registry(String), Task(String), Preset(String)
```

This loses source error chains. Also, `tracepilot-export/json.rs` uses `anyhow::Result` while the rest of the crate uses `ExportError`.

**Recommendations**:
1. Replace string variants with structured variants carrying `#[source]` where possible.
2. Remove `anyhow` from `tracepilot-export::json` — use `ExportError`.
3. Consider `strum` for enum string boilerplate (`TaskStatus`, `JobStatus`, `McpTransport`, `SkillScope`).

### 5.8 RFC3339 Date Conversion Repeated

Manual `DateTime::parse_from_rfc3339` / `to_rfc3339` calls appear across:
- `tauri-bindings/helpers.rs:115-116`
- `indexer/index_db/session_writer.rs:165-166`
- `indexer/index_db/types.rs:189-199`
- `orchestrator/task_db/operations.rs:146,229,252,267`
- `export/import/writer.rs:184,190,202`

**Recommendation**: Serialize `DateTime<Utc>` directly via serde where possible, or add shared chrono helpers.

---

## 6. Cross-Cutting: Config, Router, Tests, Packages

### 6.1 Router: Monolithic + Sidebar Duplication

The route table is a single 320-line file (`router/index.ts`). More critically, **sidebar navigation duplicates route configuration**:

- Routes defined in `router/index.ts` with `meta.sidebarId`, `meta.featureFlag`
- Sidebar items defined separately in `AppSidebar.vue:72-132`
- Feature flags duplicated in `stores/preferences.ts:81-89`

**Recommendation**:
1. Split routes into feature modules (`sessions.routes.ts`, `tasks.routes.ts`, etc.)
2. Derive sidebar items from route records instead of maintaining parallel arrays
3. Define `FEATURE_FLAGS` as a typed const and reference it everywhere

### 6.2 Breadcrumb Magic String

`App.vue:121-137` has a hardcoded string check: `if (route.meta?.title && route.meta.title !== "Session Detail")`.

**Recommendation**: Add `meta.breadcrumb: false` to routes that should suppress breadcrumbs.

### 6.3 Config/Alias Duplicated Across TS/Vite/Vitest

The `@ → src` alias is defined identically in three files:
- `apps/desktop/tsconfig.json:7-10`
- `apps/desktop/vite.config.ts:7-11`
- `apps/desktop/vitest.config.ts:7-11`

**Recommendation**: Share via `vite-tsconfig-paths` plugin or a common config helper.

### 6.4 Test Helper Duplication

**Pinia setup**: `setActivePinia(createPinia())` appears **26 times** across desktop tests. Should be a shared `setupPiniaTest()` helper.

**Domain builders** are duplicated across packages:
- `desktop/__tests__/helpers/testBuilders.ts` — `makeTurn`, `makeSession`
- `packages/ui/__tests__/agentGrouping.test.ts:10-26` — `makeTurn` (different impl)
- `packages/ui/__tests__/useConversationSections.test.ts:6-22` — `makeTurn` (yet another)
- `packages/ui/__tests__/SessionList.test.ts:6-20` — `mockSession`

**Recommendation**: Create `packages/test-utils/` with shared builders and mount helpers.

### 6.5 Dependency Version Drift

Minor but creates maintenance noise:
| Package | Desktop | UI | CLI/Other |
|---------|---------|-----|-----------|
| `vitest` | `^3.2.0` | `^3.2.0` | `^3.2.4` |
| `@vitejs/plugin-vue` | `^5.2.0` | `^5.2.4` | — |
| `vue-router` | `^4.5.0` | `^4.6.4` (dev) | — |

**Recommendation**: Use pnpm catalog or root-level overrides for toolchain dependencies.

### 6.6 `@tracepilot/config` Package is a Phantom

`packages/config/` exists as a workspace package but only contains `typescript/base.json`. Consumers reference it via relative path (`../../packages/config/typescript/base.json`), not as a package import.

**Recommendation**: Either expose proper package exports or remove from workspace packaging.

### 6.7 E2E Test Script Duplication

Raw `window.__TAURI_INTERNALS__.invoke` calls appear in 6 E2E scripts despite a shared helper existing in `scripts/e2e/connect.mjs`.

**Recommendation**: Add `invoke(page, cmd, args)` to `connect.mjs` and use it everywhere.

---

## 7. Model Review Panel

This report was independently reviewed by three AI models. Below is a consolidated summary of their feedback.

### 7.1 Factual Corrections Applied

| Claim | Original | Corrected | Source |
|-------|----------|-----------|--------|
| SQLite PRAGMA duplication | "3 crates" | **2 crates** (indexer + orchestrator) | All 3 reviewers — `core/utils/sqlite.rs` is readonly, no PRAGMAs |
| StatCard raw instances | "22 across 5 views" | **21 across 5 views** | Codex + GPT — the 22nd match is in `StatCard.vue` itself |
| SharedTaskDb lock repeats | "15+ times" | **~13 times** (10 exact 2-line patterns, 13 broader matches) | Opus |
| Pinia setup repetitions | "26 times" | **27 times** | Opus — minor off-by-one |

### 7.2 New Findings from Reviewers

#### 🔴 Rust ↔ TypeScript Type Mirroring (Opus — HIGH severity)

**The single largest architectural risk not previously covered.** Types are manually duplicated between Rust and TypeScript with no codegen (`ts-rs`, `specta`, `typeshare` — none found):

| Domain | Rust Source | TypeScript Mirror |
|--------|-----------|-------------------|
| Config | `crates/tracepilot-tauri-bindings/src/config.rs:30-46,166-193` | `packages/types/src/config.ts:19-84` |
| Health | `crates/tracepilot-core/src/health/mod.rs:27-49` | `packages/types/src/session.ts:97-106` |
| Search | `crates/tracepilot-indexer/src/lib.rs:407-412` | `packages/types/src/search.ts:77-100` |
| Tasks | `crates/tracepilot-orchestrator/src/task_db/types.rs:103-189` | `packages/types/src/tasks.ts:35-104` |
| Events | `crates/tracepilot-core/src/models/event_types/event_type_enum.rs:12-70` | `packages/types/src/known-events.ts:2-55` |

A field added in Rust but missed in TS won't fail at compile time — it surfaces as a runtime `undefined`.

#### 🔴 Feature Flag Defaults Already Drifting (Opus — active bug)

Three independent sources of feature flag defaults are **already out of sync**:

| Flag | Rust default (`config.rs:183-193`) | TS default (`defaults.ts:111-120`) |
|------|-----------------------------------|------------------------------------|
| `export_view` | `false` | `true` |
| `mcp_servers` | `true` | `false` |
| `skills` | `true` | `false` |

This is an **active bug**, not just tech debt. Users see different defaults depending on load order.

#### 🟡 Tauri Event Names are Magic Strings (Opus)

Event names like `"search-indexing-started"`, `"indexing-progress"` are hardcoded on both sides:
- Rust emits: `commands/search.rs:99-131,147-153,207-248`
- TS listens: `composables/useIndexingEvents.ts:23-35`, `stores/search.ts:124-158`

No shared constant file. A typo breaks the connection silently.

#### 🟡 Mega-SFC Problem (GPT — structural debt)

Several views are oversized feature containers with logic, rendering, and styling fused:
- `PresetManagerView.vue` — **3,075 lines**
- `SessionSearchView.vue` — **1,734 lines**
- `TaskDashboardView.vue` — **1,384 lines**

These views are not just duplicating markup; they're monoliths that need decomposition independently of the shared component work.

#### 🟡 Hand-Rolled Chart Infrastructure (GPT)

Analytics views repeat chart layout, grid generation, tooltip wiring, and SVG math:
- `AnalyticsDashboardView.vue:61-65`
- `CodeImpactView.vue:54-65`
- `ToolAnalysisView.vue:16-18,135-154`

Extracting `PageShell` will not touch this higher-value duplication.

#### 🟡 Additional CSS Gaps (GPT + Codex)

- `McpManagerView.vue:316-335` hardcodes `color: white` and brand `rgba(99, 102, 241, ...)`
- Similar patterns in `SkillsManagerView.vue:495-501`, `McpServerDetailView.vue:1340-1346`
- `window.confirm()` used in `SkillEditorView.vue:160,171,193` instead of shared `useConfirmDialog`
- App logger exists (`utils/logger.ts`) but `packages/client/` uses raw `console.log/warn`

### 7.3 Challenged Recommendations

All three reviewers converged on these pushbacks:

| Recommendation | Challenge | Resolution |
|---------------|-----------|------------|
| **`PageShell` as "low risk"** | Views have meaningfully different loading UX (LoadingOverlay vs LoadingSpinner vs SkeletonLoader). A kitchen-sink component may regress UX. | **Accepted**: Make PageShell minimal (wrapper + error slot only). Let feature-area shells handle loading. Migrate in batches (analytics first). |
| **`useFilteredCollection`** | Only 3 consumers. Filter logic differs enough that a generic composable needs extensive config. | **Accepted**: Defer to backlog. Revisit when a 4th consumer appears. |
| **`MigrationRunner` abstraction** | Only 2 consumers with different table names and semantics. | **Accepted**: Align approach (both use schema_version) but keep implementation local. Drop from plan. |
| **Router split** | 320-line file is linear, searchable, rarely changes. High disruption, low value. | **Accepted**: Keep sidebar derivation, drop file split. |
| **`runAction`/`runMutation`** | Tasks store has in-flight dedupe; MCP store does optimistic updates. A generic lifecycle may regress. | **Partially accepted**: Provide the helper but don't force all stores to use it. Design API to accept `data` ref directly. |
| **Client `invoke()` consolidation** | The wrappers already share a common file; remaining differences are intentional fallback policies. | **Accepted**: Demote to low priority. |
| **Moving composables to `@tracepilot/ui`** | `useCachedFetch` imports app-local logger — not truly generic yet. | **Accepted**: Audit import graph of each composable before moving. |

### 7.4 Consensus Prioritization Changes

| Item | Original Phase | New Phase | Rationale |
|------|---------------|-----------|-----------|
| **Feature flag drift fix** | Not in report | **Phase 1** | Active bug — users see wrong defaults |
| **Skills store repo scope bug** | Phase 4 (4.4) | **Phase 1** | Confirmed real bug, low blast radius |
| **Rust ↔ TS type codegen** | Not in report | **Phase 2** | Prevents silent drift; pairs with DTO work |
| **Tauri event name constants** | Not in report | **Phase 2** | Trivial to do; prevents subtle event bugs |
| **Mega-SFC decomposition** | Not in report | **Phase 2** | Higher value than dependency drift cleanup |
| **`useAsyncData` decision** | Phase 4 (4.6) | **Phase 1** | Must decide before adding new async helpers |
| **`useFilteredCollection`** | Phase 3 (3.1) | **Backlog** | Only 3 consumers; premature |
| **`MigrationRunner`** | Phase 3 (3.2) | **Dropped** | Only 2 consumers; keep local |
| **Router split** | Phase 3 (3.3) | **Dropped** | Keep sidebar derivation only |
| **SQLite opener** | Phase 1 (1.5) | **Phase 3** | Only 2 crates, not 3 |

### 7.5 Key Risks Identified

1. **`PageShell` migration (21 views)** — highest risk item. Will produce merge conflicts with in-flight feature branches. Migrate in batches. *(All 3 reviewers)*
2. **`SectionPanel` CSS reconciliation** — scoped styles in the component differ from global `.section-panel` class. Visual comparison needed before migrating. *(All 3 reviewers)*
3. **Feature flag consolidation** — changing defaults changes user-visible behavior. Treat as a product decision, not just engineering. *(Opus)*
4. **Rust error refactors** — touching error handling throughout orchestrator is persistence-sensitive and can change failure semantics. Do incrementally. *(GPT)*
5. **Sidebar derivation** — entries encode section grouping, icons, badges, hotkeys beyond route meta. Hidden complexity. *(GPT + Codex)*
6. **Store helper type inference** — `runAction<T>` returning `Promise<T | undefined>` changes ergonomics at every call site. *(Opus)*

---

## 8. Prioritized Implementation Plan (Post-Review)

> **Note**: This plan incorporates all reviewer feedback from §7. Items have been reprioritized, some dropped, and new items added.

### Phase 1: Bug Fixes & Foundation

| # | Task | Files Touched | Risk | Notes |
|---|------|---------------|------|-------|
| 1.1 | **Fix feature flag drift** — single source of truth for defaults | `config.rs` + `defaults.ts` + `preferences.ts` | Medium | Active bug. Requires product decision on correct defaults. |
| 1.2 | **Fix skills store repo scope bug** — store/persist `currentRepoRoot` | `stores/skills.ts` | Low | Confirmed bug. Small, isolated fix. |
| 1.3 | **Resolve `useAsyncData`** — adopt across views OR delete | composables + stores | Low | Must decide before adding new async helpers. Zero production usage currently. |
| 1.4 | Extract minimal `PageShell` (wrapper + error slot only, no loading mode) | `packages/ui/` + pilot on 4 analytics views | Low | Migrate analytics views first, then expand. Do NOT include loading strategy. |
| 1.5 | Extract `runAction`/`runMutation` store helpers | `packages/ui/` + 3-4 stores | Low | Design API to accept `data` ref directly. Don't force on stores with custom lifecycles (tasks, mcp). |
| 1.6 | Migrate stat-card divs → `StatCard` component | 5 analytics views (21 instances) | Low | Pure HTML→component swap. |
| 1.7 | Extract `with_task_db()` Rust helper | `tauri-bindings/commands/tasks.rs` | Low | Eliminates ~13 mutex lock repetitions. |

### Phase 2: Standardization & New Gaps

| # | Task | Files Touched | Risk | Notes |
|---|------|---------------|------|-------|
| 2.1 | **Rust ↔ TS type codegen** (e.g., `ts-rs` or `specta`) | Rust crates + `packages/types/` | Medium | Prevents silent drift. Start with one domain (tasks), expand. |
| 2.2 | **Tauri event name constants** — shared constant file | Rust `commands/` + TS `composables/` | Low | Trivial to implement, high safety value. |
| 2.3 | **Mega-SFC decomposition** — break up 3000+ line views | `PresetManagerView`, `SessionSearchView`, `TaskDashboardView` | Medium | Extract sub-components, not just shared ones. |
| 2.4 | Fix CSS token namespace drift — replace legacy `--color-*`, `--bg-*` | ~5 components | Low | |
| 2.5 | Migrate section-panel divs → `SectionPanel` component | 8 views (19 instances) | Medium | **Requires CSS reconciliation first** — scoped vs global styles differ. |
| 2.6 | Generalize `AnalyticsPageHeader` → `PageHeader` | 10+ views | Medium | Decouple from store first; make it a dumb title/actions shell. |
| 2.7 | Implement `From<>` for DTO conversions (Rust) | `tauri-bindings/helpers.rs` | Low | Audit each mapping for non-trivial transforms first. |

### Phase 3: Architecture Improvements

| # | Task | Files Touched | Risk | Notes |
|---|------|---------------|------|-------|
| 3.1 | Extract shared SQLite opener | `core/utils/sqlite.rs` + indexer + orchestrator | Low | Only 2 consumers — lower priority than originally assessed. |
| 3.2 | Derive sidebar items from route config | `AppSidebar.vue` + router meta | Medium | Hidden complexity: icons, badges, grouping, hotkeys. |
| 3.3 | Move generic composables to `@tracepilot/ui` | `useAsyncGuard`, `useAutoRefresh` (verify import graphs first) | Medium | `useCachedFetch` may not be movable due to app-local imports. |
| 3.4 | Create `packages/test-utils` | test files across packages | Low | Eliminate 27× `setActivePinia(createPinia())` repetitions. |
| 3.5 | Consolidate client `invoke()` wrapper | `packages/client/src/` | Low | Differences may be intentional — verify before merging. |

### Phase 4: Cleanup & Polish

| # | Task | Files Touched | Risk | Notes |
|---|------|---------------|------|-------|
| 4.1 | Remove hard-coded colors → token refs | ~10 components including shared UI | Low | |
| 4.2 | Scope unscoped global CSS blocks | `PresetManagerView`, `SearchableSelect` | Low | |
| 4.3 | Normalize dependency versions | `package.json` files | Low | |
| 4.4 | Replace `window.confirm()` → `useConfirmDialog` | `SkillEditorView.vue` | Low | |
| 4.5 | Consolidate E2E test helpers | `scripts/e2e/` | Low | |
| 4.6 | Replace stringly-typed Rust error variants | orchestrator + export | Medium | Do incrementally — one variant at a time. |
| 4.7 | Consolidate logger usage in `packages/client/` | client package | Low | Use app logger instead of raw console.* |

### Backlog (Deferred)

| Task | Reason |
|------|--------|
| `useFilteredCollection` composable | Only 3 consumers; premature generalization |
| `MigrationRunner` abstraction | Only 2 consumers; different semantics |
| Router file split | Low value; file is linear and rarely changes |
| Chart infrastructure extraction | Needs design exploration first |

---

## Assumptions & Caveats

1. **Assumption**: The `SectionPanel` component's scoped CSS vs the global `.section-panel` class in `components.css` will need reconciling. This report recommends making the component the source of truth, but this is a design decision.
2. **Assumption**: `useAsyncData` has zero production usage based on grep. It's possible there's dynamic import usage not caught by static search — verify before deletion.
3. **Assumption**: The skills store repo-scope issue (§3.6) is a bug, not intentional behavior. Confirm with product team.
4. **Assumption**: Migrating to `PageShell` assumes all views want the same error UX. ~~Some views~~ **Reviewers confirmed** many views (HealthScoringView, ExportView, SettingsView, NotFoundView) want different loading/error behavior — PageShell should be minimal (wrapper + error only).
5. **Assumption**: The CSS methodology recommendation (§4.5) favors the existing design token approach over Tailwind. If the team wants to go Tailwind-first, the recommendation changes significantly.
6. **Assumption**: Feature flag defaults (§7.2) — which defaults are *correct* is a product decision, not an engineering one. The report flags the drift but doesn't prescribe the right values.
7. **Line numbers** are from the codebase as of 2026-04-11 and may drift with ongoing development.

---

## Appendix: Review Artifacts

- **Full Opus 4.6 review**: `docs/tech-debt-report-review.md` (detailed spot-check of 12 claims + gap analysis)
- **GPT 5.4 and Codex 5.3 reviews**: Consolidated into §7 above
