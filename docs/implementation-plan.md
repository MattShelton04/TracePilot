# TracePilot Tech Debt Consolidation — Implementation Plan

**Generated**: 2026-04-11
**Last updated**: 2026-07-23 — All phases complete
**Source**: [tech-debt-consolidation-report.md](./archive/2026-04/tech-debt-consolidation-report.md)
**Status**: ✅ **Implementation complete.** See §9 of the report for full status and commit references.
**Scope**: 4 phases + backlog, 25 tasks total — 23 completed, 1 dropped, 1 deferred

> Each task includes: context, exact files to change, before/after examples, dependencies, testing strategy, and risks. Tasks within a phase can generally be parallelized unless noted.

---

## Table of Contents

- [Phase 1: Bug Fixes & Foundation](#phase-1-bug-fixes--foundation)
- [Phase 2: Standardization & New Gaps](#phase-2-standardization--new-gaps)
- [Phase 3: Architecture Improvements](#phase-3-architecture-improvements)
- [Phase 4: Cleanup & Polish](#phase-4-cleanup--polish)
- [Backlog](#backlog)

---

## Phase 1: Bug Fixes & Foundation

### 1.1 Fix Feature Flag Drift

**Context**: Three independent sources of feature flag defaults are already out of sync — this is an active bug affecting user-visible behavior.

| Flag | Rust (`config.rs:183-193`) | TS (`defaults.ts:111-120`) | Pinia (`preferences.ts:81-89`) |
|------|---------------------------|---------------------------|-------------------------------|
| `export_view` / `exportView` | `false` | `true` | `true` |
| `mcp_servers` / `mcpServers` | `true` | `false` | `false` |
| `skills` | `true` | `false` | `false` |

**⚠️ Product Decision Required**: Which defaults are correct? The Rust or TS values? This must be decided before implementation.

**Files to change**:
- `packages/types/src/defaults.ts:111-120` — single source of truth for TS defaults
- `crates/tracepilot-tauri-bindings/src/config.rs:183-193` — align Rust defaults
- `apps/desktop/src/stores/preferences.ts:81-89` — derives from `defaults.ts`, verify passthrough

**Implementation**:
1. **Decide** canonical defaults (product decision)
2. Align `defaults.ts` and `config.rs` to the same values
3. Verify `preferences.ts` already imports from `defaults.ts` (it does — lines 81-89 use the same object)
4. Add a comment in both files pointing to the other as the counterpart

**Before** (`defaults.ts:111-120`):
```typescript
featureFlags: {
  exportView: true,       // ← disagrees with Rust (false)
  healthScoring: false,
  sessionReplay: false,
  renderMarkdown: true,
  mcpServers: false,      // ← disagrees with Rust (true)
  skills: false,          // ← disagrees with Rust (true)
  aiTasks: false,
}
```

**After** (example if Rust values are canonical):
```typescript
// Feature flag defaults — MUST match crates/tracepilot-tauri-bindings/src/config.rs:183-193
featureFlags: {
  exportView: false,
  healthScoring: false,
  sessionReplay: false,
  renderMarkdown: true,
  mcpServers: true,
  skills: true,
  aiTasks: false,
}
```

**Testing**: Run `pnpm --filter @tracepilot/desktop test` + `cargo test -p tracepilot-tauri-bindings`
**Risk**: Changing defaults changes user-visible behavior. Users who haven't explicitly set flags will see features appear/disappear.
**Dependencies**: None (can be done first).

---

### 1.2 Fix Skills Store Repo Scope Bug

**Context**: `loadSkills(repoRoot?: string)` accepts an optional scope parameter, but 9 mutation functions call `loadSkills()` without it — losing the active repo filter after any mutation.

**File to change**: `apps/desktop/src/stores/skills.ts`

**Implementation**:
1. Add `currentRepoRoot` to store state
2. Set it in `loadSkills()` when provided
3. Use it as fallback in all reload calls

**Before** (`skills.ts:95-109`):
```typescript
async function loadSkills(repoRoot?: string) {
  loading.value = true;
  error.value = null;
  try {
    const result = await client.skills.listSkills(repoRoot);
    skills.value = result;
  } catch (e) {
    error.value = toErrorMessage(e);
  } finally {
    loading.value = false;
  }
}
```

**After**:
```typescript
const currentRepoRoot = ref<string | undefined>(undefined);

async function loadSkills(repoRoot?: string) {
  if (repoRoot !== undefined) {
    currentRepoRoot.value = repoRoot;
  }
  loading.value = true;
  error.value = null;
  try {
    const result = await client.skills.listSkills(currentRepoRoot.value);
    skills.value = result;
  } catch (e) {
    error.value = toErrorMessage(e);
  } finally {
    loading.value = false;
  }
}
```

Mutation functions (`createSkill`, `updateSkill`, `updateSkillRaw`, `renameSkill`, `duplicateSkill`, `importLocal`, `importFile`, `importGitHub`, `importGitHubSkill`) now automatically reload with the correct scope — no changes needed to their `loadSkills()` calls.

**Testing**: `pnpm --filter @tracepilot/desktop test` — existing skills store tests should pass; add a test that verifies reload after mutation uses stored repoRoot.
**Risk**: Low — additive change, no existing behavior altered for `repoRoot === undefined` case.
**Dependencies**: None.

---

### 1.3 Resolve `useAsyncData` — Adopt or Delete

**Context**: `useAsyncData` (332 lines, `composables/useAsyncData.ts`) provides `{ data, loading, error, execute, refresh, clearError, reset, retry, canRetry }` but has **zero production consumers**. Views use store-managed async state instead.

**Decision required**: Adopt it in views that manually manage `data/loading/error` refs, or delete it.

**Option A — Delete** (recommended if stores are the canonical pattern):
- Delete `apps/desktop/src/composables/useAsyncData.ts`
- Delete `apps/desktop/src/composables/__tests__/useAsyncData.test.ts`
- Verify no dynamic imports exist: `grep -r "useAsyncData" apps/desktop/src/ --include="*.ts" --include="*.vue"`

**Option B — Adopt** (recommended if moving toward composable-driven fetching):
Candidate views with manual `data/loading/error` refs:
- `HealthScoringView.vue:12-27`
- `SessionComparisonView.vue:53-55,80-106`
- `ExportView.vue` (session-dependent fetch)

Migration example for `HealthScoringView.vue`:
```typescript
// Before
const data = ref(null);
const loading = ref(false);
const error = ref<string | null>(null);
async function fetchData() { loading.value = true; ... }

// After
const { data, loading, error, execute: fetchData } = useAsyncData(
  () => client.analytics.getHealthScoring(/* params */),
  { immediate: false }
);
```

**Testing**: `pnpm --filter @tracepilot/desktop test`
**Risk**: Low either way. Deletion is cleanest if stores are the pattern.
**Dependencies**: Must decide before 1.5 (`runAction` helpers) — don't add a new async pattern while an unused one exists.

---

### 1.4 Extract Minimal `PageShell` Component

**Context**: 21 views repeat `<div class="page-content"><div class="page-content-inner">` wrapper. Per reviewer feedback, keep it **minimal** — wrapper + error slot only, no loading strategy.

**Files to create/change**:
- Create `packages/ui/src/components/PageShell.vue`
- Pilot migration: 4 analytics views first

**PageShell implementation**:
```vue
<template>
  <div class="page-content">
    <div class="page-content-inner">
      <slot name="error" />
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
// Minimal page wrapper — provides consistent page-content structure.
// Does NOT handle loading or empty states — those remain view-specific.
</script>
```

**Before** (`AnalyticsDashboardView.vue:188-193`):
```vue
<template>
  <div class="page-content">
    <div class="page-content-inner">
      <AnalyticsPageHeader title="Analytics Dashboard" ... />
      <LoadingOverlay :loading="loading" ...>
        ...
      </LoadingOverlay>
    </div>
  </div>
</template>
```

**After**:
```vue
<template>
  <PageShell>
    <AnalyticsPageHeader title="Analytics Dashboard" ... />
    <LoadingOverlay :loading="loading" ...>
      ...
    </LoadingOverlay>
  </PageShell>
</template>
```

**Migration order** (batch 1 — analytics):
1. `AnalyticsDashboardView.vue`
2. `ToolAnalysisView.vue`
3. `CodeImpactView.vue`
4. `ModelComparisonView.vue`

Then batch 2 (session views), batch 3 (task/MCP/skills views), batch 4 (remaining).

**Testing**: `pnpm --filter @tracepilot/ui test` + `pnpm --filter @tracepilot/desktop test` + visual smoke test
**Risk**: Medium — 21 views eventually touched. Mitigated by batched migration.
**Dependencies**: None (CSS stays in `layout.css`; component just wraps).

---

### 1.5 Extract `runAction` / `runMutation` Store Helpers

**Context**: 10+ stores repeat identical loading/error/try-catch boilerplate. Two distinct patterns exist:

**Pattern A — Load action** (~15-20 LOC each, 10+ stores):
```typescript
loading.value = true;
error.value = null;
try {
  const result = await apiCall();
  data.value = result;
} catch (e) {
  error.value = toErrorMessage(e);
} finally {
  loading.value = false;
}
```

**Pattern B — Mutation + reload** (~10-15 LOC each, 20+ instances across skills/mcp/presets):
```typescript
error.value = null;
try {
  await client.skills.createSkill(payload);
  await loadSkills();
  return true;
} catch (e) {
  error.value = toErrorMessage(e);
  return false;
}
```

**Files to create/change**:
- Create `packages/ui/src/composables/useStoreHelpers.ts`
- Migrate: `stores/skills.ts`, `stores/presets.ts`, `stores/mcp.ts` (start with these 3)
- Do NOT force on `stores/tasks.ts` (has in-flight dedupe) or `stores/sessions.ts` (has optimistic updates)

**Implementation**:
```typescript
import { type Ref } from 'vue';
import { toErrorMessage } from '@tracepilot/ui';

export async function runAction<T>(
  data: Ref<T | null>,
  loading: Ref<boolean>,
  error: Ref<string | null>,
  fn: () => Promise<T>,
  context?: string,
): Promise<T | undefined> {
  loading.value = true;
  error.value = null;
  try {
    const result = await fn();
    data.value = result;
    return result;
  } catch (e) {
    error.value = toErrorMessage(e);
    if (context) console.warn(`[${context}]`, e);
    return undefined;
  } finally {
    loading.value = false;
  }
}

export async function runMutation(
  error: Ref<string | null>,
  fn: () => Promise<void>,
  reload?: () => Promise<void>,
): Promise<boolean> {
  error.value = null;
  try {
    await fn();
    if (reload) await reload();
    return true;
  } catch (e) {
    error.value = toErrorMessage(e);
    return false;
  }
}
```

**Before** (`skills.ts:124-137`):
```typescript
async function createSkill(payload: CreateSkillPayload) {
  error.value = null;
  try {
    await client.skills.createSkill(payload);
    await loadSkills();
    return true;
  } catch (e) {
    error.value = toErrorMessage(e);
    return false;
  }
}
```

**After**:
```typescript
async function createSkill(payload: CreateSkillPayload) {
  return runMutation(error, () => client.skills.createSkill(payload), loadSkills);
}
```

**Testing**: `pnpm --filter @tracepilot/ui test` + `pnpm --filter @tracepilot/desktop test`
**Risk**: Low — opt-in adoption. Stores with custom lifecycles keep their implementations.
**Dependencies**: 1.3 (useAsyncData decision) should be resolved first.

---

### 1.6 Migrate Stat-Card Divs → `StatCard` Component

**Context**: `StatCard` component exists in `@tracepilot/ui` with props `{ value, label, color?, trend?, trendDirection?, gradient?, mini?, tooltip? }`, but 5 analytics views use raw `<div class="stat-card">` markup (21 instances).

**Files to change**: 5 views
- `AnalyticsDashboardView.vue` (5 stat-cards, `:197-217`)
- `ToolAnalysisView.vue` (4 stat-cards, `:167-183`)
- `CodeImpactView.vue` (4 stat-cards, `:103-120`)
- `ModelComparisonView.vue` (4 stat-cards, `:429-447`)
- `HealthScoringView.vue` (4 stat-cards, `:51-70`)

**Before** (`AnalyticsDashboardView.vue:197-200`):
```vue
<div class="stat-card">
  <div class="stat-card-value accent">{{ formatNumberFull(data.totalSessions) }}</div>
  <div class="stat-card-label">Total Sessions</div>
</div>
```

**After**:
```vue
<StatCard
  :value="formatNumberFull(data.totalSessions)"
  label="Total Sessions"
  color="accent"
/>
```

**Implementation steps**:
1. Add `import { StatCard } from '@tracepilot/ui'` to each view
2. Replace each `<div class="stat-card">` block with `<StatCard>` component
3. Map `class="stat-card-value accent"` → `color="accent"` prop
4. Map `class="stat-card-value success"` → `color="success"` prop
5. Verify visual consistency (component's scoped CSS vs global `.stat-card` rules)

**Testing**: `pnpm --filter @tracepilot/desktop test` + visual comparison
**Risk**: Low — pure template swap. CSS reconciliation needed if component styles differ from global `.stat-card`.
**Dependencies**: None.

---

### 1.7 Extract `with_task_db()` Rust Helper

**Context**: The same mutex lock + init check is repeated ~13 times in `commands/tasks.rs`. A `blocking_cmd!` macro exists in `blocking_helper.rs` but only wraps `spawn_blocking`.

**File to change**: `crates/tracepilot-tauri-bindings/src/commands/tasks.rs`
**File to create**: Helper function (in `tasks.rs` or `blocking_helper.rs`)

**Repeated pattern** (`tasks.rs:36-39`, repeated ~13 times):
```rust
let db = get_or_init_task_db(&state)?;
let result = tokio::task::spawn_blocking(move || {
    let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
    let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
    // ... actual work with db ...
}).await??;
```

**Implementation**:
```rust
/// Acquires the task DB, runs `f` on a blocking thread, and returns the result.
pub async fn with_task_db<T, F>(
    state: &tauri::State<'_, SharedTaskDb>,
    f: F,
) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&TaskDb) -> Result<T, BindingsError> + Send + 'static,
{
    let db = get_or_init_task_db(state)?;
    Ok(tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        f(db)
    }).await??)
}
```

**Before** (`tasks.rs:130-145` — example command):
```rust
#[tauri::command]
pub async fn get_task(
    state: tauri::State<'_, SharedTaskDb>,
    task_id: String,
) -> CmdResult<Task> {
    let db = get_or_init_task_db(&state)?;
    Ok(tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        db.get_task(&task_id).map_err(BindingsError::from)
    }).await??)
}
```

**After**:
```rust
#[tauri::command]
pub async fn get_task(
    state: tauri::State<'_, SharedTaskDb>,
    task_id: String,
) -> CmdResult<Task> {
    with_task_db(&state, move |db| {
        db.get_task(&task_id).map_err(BindingsError::from)
    }).await
}
```

**Testing**: `cargo test -p tracepilot-tauri-bindings`
**Risk**: Low — mechanical refactor with identical semantics.
**Dependencies**: None.

---

## Phase 2: Standardization & New Gaps

### 2.1 Rust ↔ TS Type Codegen

**Context**: Types are manually mirrored between Rust (serde) and TypeScript with no codegen. Known drift: `TaskResult.schemaValid` is `Option<bool>` in Rust but required `boolean` in TS.

**Approach**: Adopt `ts-rs` crate — it generates TypeScript type definitions from Rust structs via `#[derive(TS)]`.

**Files to change**:
- `Cargo.toml` (workspace) — add `ts-rs` dependency
- `crates/tracepilot-orchestrator/Cargo.toml` — add `ts-rs` feature
- `crates/tracepilot-orchestrator/src/task_db/types.rs` — add `#[derive(TS)]` to task types
- `packages/types/src/tasks.ts` — replace with generated output (or validate against it)

**Implementation steps**:
1. Add `ts-rs = "10"` to workspace `Cargo.toml`
2. Start with **one domain**: task types (`types.rs:103-189`)
3. Add `#[derive(TS)] #[ts(export)]` to `Task`, `NewTask`, `TaskResult`, `TaskStats`, `ManifestJob`, `ManifestTask`
4. Run `cargo test` to generate `.ts` files
5. Compare generated types against `packages/types/src/tasks.ts:35-104`
6. Fix any mismatches (e.g., `schemaValid: Option<bool>` → TS should be `boolean | null`)
7. Set up a CI check or build script to regenerate and diff

**Known mismatches to resolve**:
| Field | Rust | TS | Resolution |
|-------|------|----|------------|
| `Task.inputParams` | `serde_json::Value` | `Record<string, unknown>` | TS is narrower — widen to `unknown` or keep `Record` |
| `Task.resultParsed` | `Option<serde_json::Value>` | `Record<string, unknown> \| null` | Same |
| `TaskResult.schemaValid` | `Option<bool>` | `boolean` | TS should be `boolean \| null` |

**Testing**: `cargo test -p tracepilot-orchestrator` + type-check `pnpm --filter @tracepilot/desktop typecheck`
**Risk**: Medium — ts-rs may generate types that don't match existing TS conventions (e.g., `null` vs `undefined`). Start with one domain to validate.
**Dependencies**: None, but should be done before significant type changes.

---

### 2.2 Tauri Event Name Constants

**Context**: 6 unique event names are hardcoded as magic strings on both Rust and TS sides.

**Event inventory**:
| Event Name | Rust Emission | TS Listener |
|------------|--------------|-------------|
| `indexing-started` | `search.rs:99,207` | `useIndexingEvents.ts:25` |
| `indexing-progress` | `helpers.rs:46-64` | `useIndexingEvents.ts:29` |
| `indexing-finished` | `search.rs:131,226` | `useIndexingEvents.ts:33` |
| `search-indexing-started` | `search.rs:147,242,509` | `search.ts:134` |
| `search-indexing-progress` | `search.rs:153,248,518` | `search.ts:138` |
| `search-indexing-finished` | `search.rs:170,177,265,272,536` | `search.ts:141` |

**Files to create/change**:
- Create `crates/tracepilot-tauri-bindings/src/events.rs` — Rust constants
- Create `packages/types/src/events.ts` — TS constants
- Update Rust emission sites (6 files/locations)
- Update TS listener sites (2 files)

**Implementation**:

Rust:
```rust
// crates/tracepilot-tauri-bindings/src/events.rs
pub mod event_names {
    pub const INDEXING_STARTED: &str = "indexing-started";
    pub const INDEXING_PROGRESS: &str = "indexing-progress";
    pub const INDEXING_FINISHED: &str = "indexing-finished";
    pub const SEARCH_INDEXING_STARTED: &str = "search-indexing-started";
    pub const SEARCH_INDEXING_PROGRESS: &str = "search-indexing-progress";
    pub const SEARCH_INDEXING_FINISHED: &str = "search-indexing-finished";
}
```

TypeScript:
```typescript
// packages/types/src/events.ts
export const EVENT_NAMES = {
  INDEXING_STARTED: 'indexing-started',
  INDEXING_PROGRESS: 'indexing-progress',
  INDEXING_FINISHED: 'indexing-finished',
  SEARCH_INDEXING_STARTED: 'search-indexing-started',
  SEARCH_INDEXING_PROGRESS: 'search-indexing-progress',
  SEARCH_INDEXING_FINISHED: 'search-indexing-finished',
} as const;
```

**Testing**: `cargo test -p tracepilot-tauri-bindings` + `pnpm --filter @tracepilot/desktop test`
**Risk**: Low — purely mechanical string extraction.
**Dependencies**: None.

---

### 2.3 Mega-SFC Decomposition

**Context**: Three views are oversized monoliths that need breaking into sub-components.

| View | Lines | Script | Template | Extractable Sub-Components |
|------|-------|--------|----------|-----------------------------|
| `PresetManagerView.vue` | 3,075 | 381 | 1,170 | ~12 components |
| `SessionSearchView.vue` | 1,734 | 229 | 348 | ~10 components |
| `TaskDashboardView.vue` | 1,384 | 145 | 426 | ~8 components |

**PresetManagerView.vue extraction plan**:
| Sub-Component | Lines | Location |
|--------------|-------|----------|
| `PresetStatsStrip` | `:423-440` | Stats row at top |
| `PresetFilterToolbar` | `:459-516` | Search + category + view toggle |
| `PresetGrid` | `:540-708` | Grid layout of preset cards |
| `PresetList` | `:709-814` | List/table layout |
| `PresetEmptyState` | `:815-832` | Empty state |
| `DeletePresetModal` | `:833-865` | Confirmation modal |
| `NewPresetModal` | `:866-954` | Creation form |
| `EditPresetModal` | `:955-1272` | Edit form with 4 sections |
| `PresetDetailSlideover` | `:1273-1492` | Detail panel with 4 sections |

**TaskDashboardView.vue extraction plan**:
| Sub-Component | Lines | Location |
|--------------|-------|----------|
| `TaskStatsStrip` | `:199-262` | Stats cards |
| `OrchestratorStatusCard` | `:263-360` | Status + controls |
| `QuickPresetsCard` | `:361-405` | Preset shortcuts |
| `TaskFilterRow` | `:406-464` | Search + filters |
| `TaskGrid` | `:465-474` | Task cards grid |
| `TaskEmptyState` | `:475-509` | Empty state |
| `RecentJobsTable` | `:510-560` | Jobs table |

**SessionSearchView.vue extraction plan**:
| Sub-Component | Lines | Location |
|--------------|-------|----------|
| `SearchHero` | `:233-263` | Hero banner + search input |
| `SearchControlsBar` | `:265-285` | Sort + layout controls |
| `SearchActiveFilters` | `:288-303` | Active filter chips |
| `IndexingProgressBanner` | `:304-336` | Indexing status bar |
| `SearchFilterSidebar` | `:340-346` | Filter panel |
| `SearchResultsList` | `:498-528` | Grouped results |
| `SearchPagination` | `:529-556` | Pagination controls |

**Implementation approach**:
1. Extract one view at a time (start with `TaskDashboardView` — smallest)
2. Create sub-components in `apps/desktop/src/components/tasks/` (or `search/`, `presets/`)
3. Pass data via props; emit events for mutations
4. Move relevant scoped CSS into sub-components
5. Keep the parent view as an orchestrator

**Testing**: `pnpm --filter @tracepilot/desktop test` + visual smoke test
**Risk**: Medium — large template moves can break bindings. Do one view at a time.
**Dependencies**: 1.4 (PageShell) should be done first so extracted views use it.

---

### 2.4 Fix CSS Token Namespace Drift

**Context**: Legacy `--color-*`, `--bg-*`, and bare `--accent` tokens used alongside canonical design tokens.

**Files with legacy tokens**:
- `--color-*`: `UpdateBanner.vue:57,58,60,91,97,107`, `UpdateInstructionsModal.vue:166,167,193,221,235,245,257,266,269,277,280,285,326,331,333,349,355`
- `--bg-*`: `SessionSearchView.vue:1238,1267`, `TaskDashboardView.vue:781`, `PresetManagerView.vue:2963,3010`
- bare `--accent`: `TaskDashboardView.vue:790`

**Implementation**: For each legacy token, find the canonical equivalent in `design-tokens.css` and replace:

| Legacy Token | Canonical Token |
|-------------|----------------|
| `--color-primary` | `--accent-fg` |
| `--color-success` | `--success-fg` |
| `--color-warning` | `--warning-fg` |
| `--color-danger` | `--danger-fg` |
| `--bg-primary` | `--canvas-default` |
| `--bg-secondary` | `--canvas-subtle` |
| `--accent` | `--accent-fg` |

**Testing**: Visual comparison before/after
**Risk**: Low — purely CSS variable renames. Verify each mapping against `design-tokens.css`.
**Dependencies**: None.

---

### 2.5 Migrate Section-Panel Divs → `SectionPanel` Component

**Context**: `SectionPanel.vue` exists but 8 files use raw `.section-panel` CSS classes (19 instances). **CSS styles differ** between the component and global rules.

**⚠️ CSS Reconciliation Required First**:

| Property | `SectionPanel.vue` (scoped) | `components.css` (global) |
|----------|---------------------------|--------------------------|
| `.section-panel` | `margin-bottom: 1.5rem` only | `background`, `background-image`, `border`, `border-radius`, `overflow` |
| `.section-panel-header` | `font-weight: 700`, `letter-spacing: 0.05em`, `margin-bottom: 8px`, flex | `padding: 12px 16px`, `border-bottom`, `font-weight: 600`, `letter-spacing: 0.04em` |
| `.section-panel-body` | No styles | `padding: 18px` |

**Implementation steps**:
1. **First**: Create a visual comparison (screenshot both versions side-by-side)
2. **Decide**: Make the component the source of truth — absorb the global styles into it
3. Update `SectionPanel.vue` to include background, border, border-radius, padding
4. Remove the global `.section-panel` rules from `components.css`
5. Migrate raw HTML → `<SectionPanel>` component across 8 files

**Testing**: Visual comparison + `pnpm --filter @tracepilot/ui test`
**Risk**: Medium — CSS differences could cause visual regressions. Reconcile first, then migrate.
**Dependencies**: None, but do the CSS reconciliation as a distinct PR before migration.

---

### 2.6 Generalize `AnalyticsPageHeader` → `PageHeader`

**Context**: `AnalyticsPageHeader.vue` provides a title/subtitle header with actions slot, but it's coupled to `useAnalyticsStore()` for repo select and time range filter.

**Current analytics-specific coupling**:
- Imports `useAnalyticsStore()` (line 10)
- Binds to `selectedRepo`, `availableRepos`, `setRepo` (lines 20-28)
- Hardcoded `TimeRangeFilter` child (line 30)

**Implementation**:
1. Create `packages/ui/src/components/PageHeader.vue` — generic title + subtitle + actions slot
2. Keep `AnalyticsPageHeader.vue` as a thin wrapper that adds the analytics-specific controls

```vue
<!-- packages/ui/src/components/PageHeader.vue -->
<template>
  <div class="page-header">
    <div class="page-header-top">
      <div>
        <h1 class="page-header-title">{{ title }}</h1>
        <p v-if="subtitle" class="page-header-subtitle">{{ subtitle }}</p>
      </div>
      <div class="page-header-actions">
        <slot name="actions" />
      </div>
    </div>
    <slot name="controls" />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>
```

**Before** (analytics view):
```vue
<AnalyticsPageHeader title="Tool Analysis" subtitle="..." />
```

**After** (non-analytics views like `TaskDashboardView`):
```vue
<PageHeader title="Task Dashboard" subtitle="Manage orchestration tasks">
  <template #actions>
    <RefreshToolbar ... />
    <button @click="createTask">New Task</button>
  </template>
</PageHeader>
```

**Testing**: `pnpm --filter @tracepilot/ui test` + `pnpm --filter @tracepilot/desktop test`
**Risk**: Low — new component, existing views adopt incrementally.
**Dependencies**: 1.4 (PageShell) — PageHeader is used inside PageShell.

---

### 2.7 Implement `From<>` for DTO Conversions (Rust)

**Context**: `helpers.rs` has manual field-by-field mapping functions. Some have non-trivial transforms.

**Mapping functions to convert**:
| Function | Fields | Non-Trivial Transforms |
|----------|--------|----------------------|
| `emit_indexing_progress` (`:46-64`) | 11 | Session info extraction, `unwrap_or(0)`, field renames |
| `summary_to_list_item` (`:103-129`) | 16 | `has_lock_file()` check, datetime→RFC3339, nested `shutdown_metrics` extraction |
| `indexed_session_to_list_item` (`:140-161`) | 16 | `has_lock_file()` check, `Option<i64>` → `Option<usize>` via `maybe_i64_to_usize()` |

**⚠️ Not all are candidates for `From<>`**: Functions with side effects (like checking `has_lock_file()`) or that take extra parameters can't be simple `From` impls.

**Implementation approach**:
1. For pure field mappings: implement `From<SourceType> for TargetType`
2. For mappings with extra params: keep as functions but use builder-style with `impl Into<>` where possible
3. `emit_indexing_progress` — keep as function (it emits events)
4. `summary_to_list_item` — keep as function (needs `session_path` for `has_lock_file`)
5. `indexed_session_to_list_item` — keep as function (needs path for `has_lock_file`)
6. Focus on any simpler DTO mappings elsewhere (check for others in `helpers.rs`)

**Testing**: `cargo test -p tracepilot-tauri-bindings`
**Risk**: Low — but audit each mapping carefully for hidden transforms.
**Dependencies**: None.

---

## Phase 3: Architecture Improvements

### 3.1 Extract Shared SQLite Opener

**Context**: Identical PRAGMA block in 2 crates. Differences are only in error wrapping.

**Files**:
- `crates/tracepilot-indexer/src/index_db/mod.rs:49-56` — uses `IndexerError::database_config(...)`
- `crates/tracepilot-orchestrator/src/task_db/mod.rs:40-46` — uses `OrchestratorError::Task(format!(...))`

**Implementation**:
```rust
// crates/tracepilot-core/src/utils/sqlite.rs (add to existing file)
pub fn configure_connection(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;"
    )
}
```

Each crate wraps the `rusqlite::Result` in its own error type:
```rust
// indexer
core::utils::sqlite::configure_connection(&conn)
    .map_err(|e| IndexerError::database_config("Failed to set pragmas", e))?;
// orchestrator
core::utils::sqlite::configure_connection(&conn)
    .map_err(|e| OrchestratorError::Task(format!("Failed to set pragmas: {e}")))?;
```

**Testing**: `cargo test -p tracepilot-indexer` + `cargo test -p tracepilot-orchestrator`
**Risk**: Low — trivial extraction. Only 2 consumers.
**Dependencies**: None.

---

### 3.2 Derive Sidebar Items from Route Config

**Context**: `AppSidebar.vue:64-132` hardcodes nav arrays. Routes already have some `meta` but lack icon/group/order info.

**Required route meta additions**:
```typescript
declare module 'vue-router' {
  interface RouteMeta {
    sidebarIcon?: string;        // Icon component name or identifier
    sidebarGroup?: 'primary' | 'advanced' | 'orchestration' | 'tasks' | 'configuration' | 'settings';
    sidebarOrder?: number;
    sidebarLabel?: string;       // Override — titles don't always match (e.g., "Analytics Dashboard" → "Analytics")
    showInSidebar?: boolean;     // Default true; false for detail routes
    sidebarBadge?: 'count' | 'shortcut'; // Dynamic badge type
    sidebarShortcut?: string;    // Keyboard shortcut label
  }
}
```

**Implementation steps**:
1. Add meta fields to route definitions in `router/index.ts`
2. Create `useSidebarItems()` composable that reads `router.getRoutes()` and groups/sorts
3. Refactor `AppSidebar.vue` template to iterate over computed items
4. Keep icon rendering via a `SidebarIcon` component that maps names to SVGs

**Risk**: Medium — sidebar encodes grouping, badges, hotkeys, icons beyond just route paths. The derivation composable will be non-trivial.
**Dependencies**: None, but consider alongside 2.3 (mega-SFC decomposition) if sidebar is part of that.

---

### 3.3 Move Generic Composables to `@tracepilot/ui`

**Context**: Some composables are generic Vue utilities with no app-local dependencies.

| Composable | Imports | Movable? |
|-----------|---------|----------|
| `useAsyncGuard.ts` | None | ✅ Yes |
| `useAutoRefresh.ts` | `vue` only | ✅ Yes |
| `useCachedFetch.ts` | `vue`, `@tracepilot/ui`, **`@/utils/logger`** | ❌ Not yet — remove logger dep first |

**Implementation**:
1. Move `useAsyncGuard.ts` → `packages/ui/src/composables/`
2. Move `useAutoRefresh.ts` → `packages/ui/src/composables/`
3. For `useCachedFetch.ts`: either remove logger dep or make logger injectable
4. Update imports in consuming files
5. Export from `packages/ui/src/index.ts`

**Testing**: `pnpm --filter @tracepilot/ui test` + `pnpm --filter @tracepilot/desktop test`
**Risk**: Low for first two. Medium for `useCachedFetch` due to logger dependency.
**Dependencies**: 1.3 (useAsyncData decision) — if deleted, these become the canonical async utilities.

---

### 3.4 Create `packages/test-utils`

**Context**: `setActivePinia(createPinia())` repeated in 21+ test files. Domain builders (`makeTask`, `makeJob`, `makeStats`, etc.) duplicated.

**Implementation**:
1. Create `packages/test-utils/` with `package.json`, `tsconfig.json`
2. Create `packages/test-utils/src/pinia.ts`:
   ```typescript
   import { setActivePinia, createPinia } from 'pinia';
   export function setupPiniaTest() { setActivePinia(createPinia()); }
   ```
3. Create `packages/test-utils/src/builders/` with domain factories
4. Move `makeTask`, `makeJob`, `makeStats` from `apps/desktop/src/__tests__/stores/tasks.test.ts:20-68`
5. Update test files to import from `@tracepilot/test-utils`
6. Add to `pnpm-workspace.yaml`

**Testing**: All existing tests should pass with new imports
**Risk**: Low — purely organizational.
**Dependencies**: None.

---

### 3.5 Consolidate Client `invoke()` Wrapper

**Context**: 4 separate `invoke()` wrappers in `packages/client/src/`. Differences:
- `index.ts:51-68` — mock fallback (returns mock data)
- `skills.ts:17-23` — no fallback (throws)
- `orchestration.ts:27-33` — similar to index
- `mcp.ts:12-18` — similar to skills

**Implementation**:
```typescript
// packages/client/src/invoke.ts (extend existing)
export type FallbackStrategy = 'mock' | 'throw';

export function createInvoke(options: { domain: string; fallback: FallbackStrategy }) {
  return async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (isTauriAvailable()) {
      return invokePlugin<T>(cmd, args);
    }
    if (options.fallback === 'mock') {
      console.warn(`[${options.domain}] Not in Tauri — returning mock`);
      return getMockData(cmd) as T;
    }
    throw new Error(`[${options.domain}] Not in Tauri — no mock available for: ${cmd}`);
  };
}
```

**Testing**: `pnpm --filter @tracepilot/client test` (if tests exist) + `pnpm --filter @tracepilot/desktop test`
**Risk**: Low — but verify the intentional differences are preserved.
**Dependencies**: None.

---

## Phase 4: Cleanup & Polish

### 4.1 Remove Hard-Coded Colors → Token Refs

**Context**: ~50+ files use `#fff`, `#000`, `rgb()`, `rgba()` instead of CSS custom properties. Priority targets: shared UI components (`packages/ui/`).

**High-priority files** (shared components):
- `packages/ui/src/components/ConfirmDialog.vue`
- `packages/ui/src/components/SessionCard.vue`
- `packages/ui/src/components/SegmentedControl.vue`
- `packages/ui/src/components/ToastContainer.vue`
- All renderer components in `packages/ui/src/components/renderers/`

**Common mappings**:
| Hard-coded | Token Replacement |
|-----------|-------------------|
| `#fff`, `#ffffff` | `var(--text-inverse)` or `var(--canvas-default)` |
| `#000`, `#000000` | `var(--text-primary)` |
| `rgba(0,0,0,0.x)` | `var(--overlay-backdrop)` or `var(--border-default)` |
| `rgba(255,255,255,0.x)` | `var(--overlay-light)` |

**Testing**: Visual comparison
**Risk**: Low — but each replacement needs context-aware mapping.
**Dependencies**: 2.4 (CSS token drift fix) should go first.

---

### 4.2 Scope Unscoped Global CSS Blocks

**Context**: Two components have unscoped `<style>` blocks that leak global classes.

**Files**:
- `PresetManagerView.vue:2508+` — exports `.preset-backdrop`, `.preset-slideover`, `.slideover-*`, `.detail-*`, `.preset-section`
- `SearchableSelect.vue:316-365` — exports `.select-dropdown`, `.options-list`, `.option-item`, `.no-options`

**Implementation**: Scope the CSS or use `:deep()` / CSS modules for teleported content. For teleported overlays, use a unique data attribute:
```vue
<style scoped>
.preset-slideover[data-v-xxxxx] { ... }
</style>
```

Or for teleported content that can't be scoped:
```vue
<style>
.preset-manager__backdrop { ... }  /* BEM namespace to avoid collisions */
</style>
```

**Testing**: Visual smoke test of teleported overlays/dropdowns
**Risk**: Low-medium — teleported content may lose styles if naively scoped.
**Dependencies**: 2.3 (mega-SFC decomposition) may address this naturally.

---

### 4.3 Normalize Dependency Versions

**Context**: Minor version drift across workspace packages.

**Implementation**: Run `pnpm update --recursive --latest` for patch/minor versions, or manually align in `package.json` files. Focus on:
- `vitest` — ensure same version across all packages
- `@vitejs/plugin-vue` — ensure same version
- `vue-router` — ensure same version

**Testing**: `pnpm install` + `pnpm lint` + `pnpm --filter @tracepilot/desktop test`
**Risk**: Low — minor version bumps rarely break.
**Dependencies**: None.

---

### 4.4 Replace `window.confirm()` → `useConfirmDialog`

**Context**: `SkillEditorView.vue:160,171,193` uses native `window.confirm()` while rest of app uses `useConfirmDialog`.

**Implementation**: Replace each `window.confirm()` call with the shared composable.

**Testing**: `pnpm --filter @tracepilot/desktop test` + manual interaction test
**Risk**: Low — UI improvement.
**Dependencies**: None.

---

### 4.5 Consolidate E2E Test Helpers

**Context**: Raw `window.__TAURI_INTERNALS__.invoke` calls in 6 E2E scripts despite shared helper.

**Implementation**: Add `invoke(page, cmd, args)` to `scripts/e2e/connect.mjs` and replace raw calls.

**Testing**: Run E2E suite
**Risk**: Low.
**Dependencies**: None.

---

### 4.6 Replace Stringly-Typed Rust Error Variants

**Context**: `OrchestratorError` has 10 string-only variants (`Git(String)`, `Config(String)`, etc.) that lose source error chains. `ExportError` has 4 similar variants.

**Implementation** (incremental — one variant at a time):

Start with `OrchestratorError::Git`:
```rust
// Before
#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    #[error("Git error: {0}")]
    Git(String),
    // ...
}

// After
#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    #[error("Git error: {message}")]
    Git {
        message: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },
    // ...
}
```

**Testing**: `cargo test -p tracepilot-orchestrator`
**Risk**: Medium — changes error construction at every call site. Do one variant per PR.
**Dependencies**: None.

---

### 4.7 Consolidate Logger Usage in `packages/client/`

**Context**: App has a structured logger (`utils/logger.ts`) but `packages/client/` uses raw `console.log/warn`.

**Implementation**: Either import the logger or create a minimal logging abstraction in the client package.

**Testing**: `pnpm --filter @tracepilot/desktop test`
**Risk**: Low.
**Dependencies**: 3.3 (moving composables) may affect logger location.

---

## Backlog

| Task | Why Deferred | Revisit When |
|------|-------------|--------------|
| **`useFilteredCollection` composable** | Only 3 consumers (skills, presets, tasks). Filter logic differs enough that a generic version needs extensive config. | A 4th consumer appears |
| **`MigrationRunner` abstraction** | Only 2 consumers with different table names and semantics. 30-40 lines each. | A 3rd database appears |
| **Router file split** | 320-line file is linear, searchable, rarely causes merge conflicts. | File exceeds 500 lines or causes repeated merge conflicts |
| **Chart infrastructure extraction** | Analytics views repeat chart layout/grid/tooltip/SVG math, but extracting requires design exploration of a shared chart component API. | Dedicated chart component design sprint |

---

## Execution Notes

### PR Strategy
- **One task per PR** for Phase 1 items (they're independent)
- **Group related changes** in Phase 2+ (e.g., CSS token drift + hard-coded colors)
- **Never combine bug fixes with refactors** (1.1/1.2 should be separate PRs from 1.4/1.5)

### Testing Strategy
- Frontend: `pnpm --filter @tracepilot/desktop test` + `pnpm --filter @tracepilot/desktop typecheck`
- UI package: `pnpm --filter @tracepilot/ui test`
- Rust: `cargo test -p tracepilot-orchestrator` + `cargo test -p tracepilot-tauri-bindings`
- Visual: Screenshot comparison for CSS-touching changes (2.4, 2.5, 4.1)

### Dependency Graph

```
1.1 (flags) ─────────────────────────────────────────────→ done
1.2 (skills bug) ────────────────────────────────────────→ done
1.3 (useAsyncData) ──→ 1.5 (runAction) ──→ 3.3 (move composables)
1.4 (PageShell) ─────→ 2.3 (mega-SFC) ──→ 2.6 (PageHeader)
1.6 (StatCard) ──────────────────────────────────────────→ done
1.7 (with_task_db) ──────────────────────────────────────→ done
2.1 (type codegen) ──────────────────────────────────────→ done
2.2 (event names) ───────────────────────────────────────→ done
2.4 (CSS tokens) ───→ 4.1 (hard-coded colors)
2.5 (SectionPanel) ──── requires CSS reconciliation first
```
