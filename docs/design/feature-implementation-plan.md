# TracePilot Feature Implementation Plan

## 8 Selected Features — Deep Integration Analysis

> **Purpose**: This document provides a complete, implementation-ready plan for integrating 8 new features into TracePilot. Each feature includes: backend changes, frontend changes, data model modifications, UI discovery points, feasibility assessment, and implementation notes.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Feature 1: Token Flow Sankey](#feature-1-token-flow-sankey)
3. [Feature 2: Model Comparison Matrix](#feature-2-model-comparison-matrix)
4. [Feature 3: Session Comparison Enhanced](#feature-3-session-comparison-enhanced)
5. [Feature 4: Checkpoint Navigator](#feature-4-checkpoint-navigator)
6. [Feature 5: Todo Dependency Graph](#feature-5-todo-dependency-graph)
7. [Feature 6: Tool Ecosystem Map](#feature-6-tool-ecosystem-map)
8. [Feature 7: MCP Server Analytics](#feature-7-mcp-server-analytics)
9. [Feature 8: Agent Effectiveness Scorecard](#feature-8-agent-effectiveness-scorecard)
10. [Shared Infrastructure](#shared-infrastructure)
11. [Implementation Order](#implementation-order)
12. [New Index DB Tables Summary](#new-index-db-tables-summary)
13. [New Tauri Commands Summary](#new-tauri-commands-summary)
14. [Risk Assessment](#risk-assessment)

---

## Architecture Overview

### Current Stack
- **Backend**: Rust (Tauri 2) with 22 existing commands in `crates/tracepilot-tauri-bindings/src/lib.rs`
- **Index DB**: SQLite with 6 tables (`sessions`, `session_model_metrics`, `session_tool_calls`, `session_modified_files`, `session_activity`, `sessions_fts` + `conversation_fts`)
- **Frontend**: Vue 3 + Pinia stores + Vue Router (hash-based)
- **Shared UI**: `@tracepilot/ui` package with reusable components (StatCard, Badge, SectionPanel, DataTable, etc.)
- **Client**: `@tracepilot/client` package wrapping all Tauri `invoke()` calls
- **Types**: `@tracepilot/types` package with shared TypeScript interfaces

### Key Patterns to Follow
1. **New Tauri commands** must be registered in THREE places:
   - `#[tauri::command]` function in `crates/tracepilot-tauri-bindings/src/lib.rs`
   - `generate_handler![]` macro in the same file
   - `.commands(&[...])` in `apps/desktop/src-tauri/build.rs`
   - **Command signature pattern**: Use `state: tauri::State<'_, SharedConfig>` + `read_config(&state)` + `tokio::task::spawn_blocking(...)` (NOT `AppState`)
   - **Serialization**: All Rust response structs must use `#[serde(rename_all = "camelCase")]`
2. **New routes**: Add to `apps/desktop/src/router/index.ts` as lazy-loaded components
3. **New session tabs**: Add child route under `/session/:id` + entry in `SessionDetailView.vue` tabs array
4. **New sidebar items**: Add to `primaryNav` or `advancedNav` in `AppSidebar.vue` + icon SVG. Group niche items under collapsible "Intelligence" section to avoid sidebar crowding.
5. **New store data**: Follow `sessionDetail.ts` pattern — ref + loadingRef + errorRef + requestToken guard + add to refreshAll + add to reset. Consider dedicated stores for new analytics pages.
6. **New analytics**: Follow `analytics.ts` pattern — ref + generation counter + composite cache key + hideEmptySessions watch invalidation
7. **New types**: Add to `packages/types/src/index.ts` + corresponding Rust struct. Use `field: T | null` (not `field?: T`) for Rust `Option<T>` fields.
8. **New client functions**: Add to `packages/client/src/index.ts` wrapping `invoke()`. Must also add mock data entry in `getMockData()` for non-Tauri/dev environments.

### Existing Data Available (No Backend Changes Needed)
| Data | Source | Command |
|------|--------|---------|
| Per-model token breakdown (input/output/cache_read/cache_write) | `ShutdownMetrics.model_metrics: HashMap<String, ModelMetricDetail>` | `get_shutdown_metrics(session_id)` |
| Session summary + metadata | `SessionSummary` (30+ fields) | `get_session_detail(session_id)` |
| Full conversation turns with tool calls | `ConversationTurn[]` with nested `TurnToolCall[]` | `get_session_turns(session_id)` |
| Tool call details (MCP server, subagent, model, parent_tool_call_id) | Fields on `TurnToolCall` | `get_session_turns(session_id)` |
| Checkpoints (number, title, filename, content ≤50KB) | `CheckpointEntry[]` | `get_session_checkpoints(session_id)` |
| Todos + dependencies | `TodosResponse { todos, deps }` | `get_session_todos(session_id)` |
| Cross-session analytics | `AnalyticsData` (model distribution, daily activity, etc.) | `get_analytics(from, to, repo, hide_empty)` |
| Tool analysis | `ToolAnalysisData` (per-tool counts, success rates, heatmap) | `get_tool_analysis(from, to, repo, hide_empty)` |
| Session events (raw) | Paginated event list | `get_session_events(session_id, offset, limit)` |
| Session list | `SessionListItem[]` | `list_sessions()` |

---

## Feature 1: Token Flow Sankey

### Overview
Sankey/alluvial diagram showing how tokens flow through the system: Input Sources → Models → Output Destinations. Shows cache efficiency, model routing, and where tokens are "spent."

### Feasibility: 🟢 FULLY FEASIBLE — No backend changes required

### Data Requirements vs Availability

| Required Data | Available? | Source |
|---|---|---|
| Input tokens per model | ✅ | `ShutdownMetrics.model_metrics[model].input_tokens` |
| Output tokens per model | ✅ | `ShutdownMetrics.model_metrics[model].output_tokens` |
| Cache read tokens per model | ✅ | `ShutdownMetrics.model_metrics[model].cache_read_tokens` |
| Cache write tokens per model | ✅ | `ShutdownMetrics.model_metrics[model].cache_write_tokens` |
| Model names | ✅ | Keys of `model_metrics` HashMap |
| Total session tokens | ✅ | Sum across models |
| Request count per model | ✅ | `model_metrics[model].request_count` |
| Cost per model | ✅ | `model_metrics[model].copilot_estimated_cost` OR computed via `prefs.computeWholesaleCost()` |

### Node/Link Derivation (All Frontend)
The Sankey nodes and links can be derived entirely from `ShutdownMetrics.model_metrics`:

**Nodes (3 columns):**
- **Col 0 (Input Sources):** "User Messages" (= total input - cache_read), "Cached Input" (= total cache_read), "System Context" (derived from ratio heuristic or tool results)
- **Col 1 (Models):** One node per model in `model_metrics`
- **Col 2 (Output Destinations):** "Assistant Text", "Tool Calls", "Reasoning", "Cache Writes"

**Links:**
- Input Sources → Models: Distribute `input_tokens` across models; cache_read attributed to "Cached Input" node
- Models → Output Destinations: `output_tokens` split between "Assistant Text" and "Tool Calls" (estimated from turn data if available), `cache_write_tokens` → "Cache Writes"

**Note**: To get more accurate input source breakdown (User Messages vs System Context vs Tool Results), turns data can be used. Each turn's `user_message` length gives user input; tool call `result_content` gives tool result input. This is optional enrichment.

### Implementation Plan

#### Backend Changes: NONE

#### Frontend Changes

**New file: `apps/desktop/src/views/tabs/TokenFlowTab.vue`**
- New session detail tab
- Imports `shutdownMetrics` from `useSessionDetailStore()`
- Optionally loads turns for more granular source breakdown
- Contains inline SVG Sankey renderer (no library needed — see prototype)
- Responsive layout with stat cards above, Sankey diagram below

**Modify: `apps/desktop/src/views/SessionDetailView.vue`**
- Add tab entry (line ~85):
  ```ts
  { name: "token-flow", routeName: "session-token-flow", label: "Token Flow" }
  ```

**Modify: `apps/desktop/src/router/index.ts`**
- Add child route under `/session/:id` children array (line ~34-78):
  ```ts
  {
    path: 'token-flow',
    name: 'session-token-flow',
    component: () => import('@/views/tabs/TokenFlowTab.vue'),
    meta: { title: 'Token Flow', sidebarId: 'sessions' }
  }
  ```

#### UI Discovery Point
- **Location**: New tab "Token Flow" in session detail view, after "Metrics" tab
- **Access path**: Sessions → Click session → Token Flow tab

### Effort Estimate
- Frontend only: ~1 component (~300-400 lines including SVG Sankey renderer)
- No backend, no types, no client changes
- **Low effort, high impact**

---

## Feature 2: Model Comparison Matrix

### Overview
Cross-session analytics view comparing all models used: sessions count, token efficiency, cost, success rate, cache hit rate, speed. Includes radar chart, scatter plot, usage trend, and side-by-side comparison.

### Feasibility: 🟡 MOSTLY FEASIBLE — Minor backend enhancement needed

### Data Requirements vs Availability

| Required Data | Available? | Source |
|---|---|---|
| Per-model session count | ✅ | `AnalyticsData.modelDistribution[].sessions` (via `get_analytics`) |
| Per-model total tokens (input/output/cache) | ✅ | `AnalyticsData.modelDistribution[].inputTokens/outputTokens/cacheReadTokens` |
| Per-model total cost | ✅ | Computed from tokens via `prefs.computeWholesaleCost()` |
| Per-model request count | ✅ | `AnalyticsData.modelDistribution[].requests` |
| Per-model success rate | 🟡 | NOT directly available in `modelDistribution`. Would need per-model tool call success aggregation |
| Per-model avg duration | 🟡 | NOT in `modelDistribution`. Would need per-model timing aggregation |
| Per-model cache hit rate | ✅ | Derived: `cacheReadTokens / (inputTokens + cacheReadTokens)` per model |
| Per-model I/O ratio | ✅ | Derived: `inputTokens / outputTokens` |
| Per-model daily usage (sparkline) | 🟡 | NOT available — `dailyActivity` is aggregate, not per-model |
| Per-model radar scores | ✅ (derived) | Computed from available metrics (normalize each dimension 0-100) |

### Missing Data: Per-Model Success Rate & Duration

**Option A: Index DB Enhancement (Recommended)**
Add `success_count` and `fail_count` columns to the existing `session_model_metrics` table. During indexing, iterate through session turns and count successful vs failed tool calls per model.

**Option B: Frontend Computation**
Load all sessions' turns and compute per-model success/duration in the frontend. This is expensive for large datasets (100+ sessions).

**Decision: Option A** — Add to index DB for O(1) queries.

### Missing Data: Per-Model Daily Usage

**Option A: New Index Table (Recommended)**
Create `session_model_daily` table with columns: `(date TEXT, model TEXT, sessions INTEGER, tokens INTEGER, cost REAL)`. Populated incrementally during `upsert_session`.

**Option B: Compute from session_model_metrics + sessions.created_at**
Join `session_model_metrics` with `sessions` table and group by `date(created_at)` and `model`. This is a SQL query against existing data — no new table needed!

**Decision: Option B** — The SQL join is fast enough and avoids schema changes. Query:
```sql
SELECT date(s.created_at) as day, sm.model, 
       COUNT(DISTINCT sm.session_id) as sessions,
       SUM(sm.input_tokens + sm.output_tokens) as tokens
FROM session_model_metrics sm
JOIN sessions s ON sm.session_id = s.session_id
WHERE s.created_at BETWEEN ?1 AND ?2
GROUP BY day, sm.model
ORDER BY day
```

### Implementation Plan

#### Backend Changes

**Modify: `crates/tracepilot-indexer/src/index_db.rs`**
- Add columns to `session_model_metrics` table: `success_count INTEGER DEFAULT 0`, `fail_count INTEGER DEFAULT 0`, `total_duration_ms INTEGER DEFAULT 0`
- In `upsert_session()`, when iterating model metrics, also count tool call success/fail per model from the session's turns
- **Migration**: The DB already has `CREATE TABLE IF NOT EXISTS` — adding columns requires `ALTER TABLE ... ADD COLUMN` with fallback. Add a migration check at DB open.

**Modify: `crates/tracepilot-core/src/analytics/aggregator.rs`**
- In `compute_analytics()`, enhance the `model_distribution` section to include success_count, fail_count, total_duration_ms from the new columns
- Add a new function `compute_model_daily_trend()` using the SQL join above

**Modify: `crates/tracepilot-core/src/analytics/types.rs`**
- Extend `ModelDistributionEntry`:
  ```rust
  pub struct ModelDistributionEntry {
      // existing fields...
      pub success_count: u64,
      pub fail_count: u64,
      pub avg_duration_ms: f64,
  }
  ```
- Add new type:
  ```rust
  pub struct ModelDailyTrend {
      pub model: String,
      pub data: Vec<ModelDailyPoint>,
  }
  pub struct ModelDailyPoint {
      pub date: String,
      pub sessions: u64,
      pub tokens: u64,
  }
  ```

**Modify: `crates/tracepilot-tauri-bindings/src/lib.rs`**
- Add new command:
  ```rust
  #[tauri::command]
  pub async fn get_model_comparison(
      state: tauri::State<'_, AppState>,
      from_date: Option<String>,
      to_date: Option<String>,
      repo: Option<String>,
  ) -> Result<ModelComparisonData, String>
  ```
  This calls `compute_analytics` (for model distribution) + `compute_model_daily_trend` (for sparklines)

**Modify: `apps/desktop/src-tauri/build.rs`**
- Add `"get_model_comparison"` to `.commands(&[...])` array

#### Frontend Changes

**New type in `packages/types/src/index.ts`:**
```ts
export interface ModelComparisonData {
  models: ModelComparisonEntry[];
  dailyTrends: ModelDailyTrend[];
}
export interface ModelComparisonEntry {
  name: string;
  sessions: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  successCount: number;
  failCount: number;
  avgDurationMs: number;
  totalCost: number;
}
export interface ModelDailyTrend {
  model: string;
  data: { date: string; sessions: number; tokens: number }[];
}
```

**New client function in `packages/client/src/index.ts`:**
```ts
export async function getModelComparison(
  fromDate?: string, toDate?: string, repo?: string
): Promise<ModelComparisonData> {
  return invoke("get_model_comparison", { fromDate, toDate, repo });
}
```

**New file: `apps/desktop/src/views/ModelComparisonView.vue`**
- Top-level analytics view (not a session tab — this is cross-session)
- Uses `useAnalyticsStore` pattern for caching
- Contains: model cards, performance matrix table, radar chart (SVG), scatter plot (SVG), usage trend (SVG), side-by-side selector
- All chart rendering in component (no external library)
- Reuses `StatCard`, `SectionPanel`, `DataTable` from `@tracepilot/ui`

**Modify: `apps/desktop/src/router/index.ts`**
- Add top-level route:
  ```ts
  {
    path: '/models',
    name: 'model-comparison',
    component: () => import('@/views/ModelComparisonView.vue'),
    meta: { title: 'Model Comparison', sidebarId: 'models' }
  }
  ```

**Modify: `apps/desktop/src/components/layout/AppSidebar.vue`**
- Add to `advancedNav` array:
  ```ts
  { id: 'models', label: 'Models', to: '/models', icon: 'models' }
  ```
- Add SVG icon block for 'models'

**Modify: `apps/desktop/src/stores/analytics.ts`**
- Add `modelComparison` ref + `fetchModelComparison()` function + cache key
- Or: Create dedicated `useModelComparisonStore()` store

#### UI Discovery Point
- **Location**: New sidebar item "Models" in Advanced Navigation section
- **Access path**: Sidebar → Models
- **Also**: Could add a "Compare Models" link from MetricsTab

### Effort Estimate
- Backend: ~200 lines (new columns + aggregation function + command)
- Frontend: ~500-600 lines (view with 4 SVG charts)
- Types + Client: ~50 lines
- **Medium effort, high impact**

---

## Feature 3: Session Comparison Enhanced

### Overview
Rich side-by-side comparison of any two sessions with metric deltas, token breakdown bars, model distribution donuts, tool usage comparison, activity waveforms, and turn timelines.

### Feasibility: 🟢 FULLY FEASIBLE — Replaces existing stub, no new backend needed

### Data Requirements vs Availability

| Required Data | Available? | Source |
|---|---|---|
| Session summary (all fields) | ✅ | `get_session_detail(id)` for each session |
| Shutdown metrics (tokens, cost) | ✅ | `get_shutdown_metrics(id)` for each session |
| Per-model token breakdown | ✅ | `shutdownMetrics.model_metrics` |
| Turn count, event count | ✅ | `SessionSummary` fields |
| Tool calls per tool | ✅ | `get_session_turns(id)` → count tool names |
| Per-turn message lengths | ✅ | `ConversationTurn.user_message.length` / `assistant_message.length` |
| Per-turn durations | ✅ | `ConversationTurn` timestamps (start/end) |
| Files modified + lines changed | ✅ | `SessionSummary.code_changes` |
| Duration | ✅ | `SessionSummary.duration_seconds` |

**ALL data is available from existing commands.** No backend changes needed.

### Implementation Plan

#### Backend Changes: NONE

The existing `get_session_detail`, `get_shutdown_metrics`, and `get_session_turns` commands provide all necessary data. The comparison is computed client-side.

#### Frontend Changes

**Replace: `apps/desktop/src/views/SessionComparisonView.vue`**
Complete rewrite (current file is a stub with mock data + `StubBanner`).

New implementation:
1. **Session selectors**: Two dropdowns populated from `sessionsStore.sessions`
2. **Loading**: When both selected, call `getSessionDetail(a)`, `getSessionDetail(b)`, `getShutdownMetrics(a)`, `getShutdownMetrics(b)`, `getSessionTurns(a)`, `getSessionTurns(b)` in parallel
3. **Summary cards**: Side-by-side session info (repo, branch, model, exit status)
4. **Delta table**: 9 key metrics with A/B/delta columns. Delta formatting logic (already partially implemented in current stub via `deltaInfo()` — can be preserved)
5. **Token breakdown**: Horizontal stacked bars for each session (input/output/cache)
6. **Model distribution**: Donut charts per session (SVG)
7. **Tool usage comparison**: Grouped bar chart per tool
8. **Activity waveform**: Per-turn message length visualization (above/below centerline)
9. **Turn timeline**: Proportional-width blocks per turn showing duration

**Modify: `apps/desktop/src/stores/sessionDetail.ts`** (minimal)
- No structural changes needed — the comparison view manages its own two-session state internally (not via the shared store, since the store holds ONE session)

**Alternative: Create `apps/desktop/src/composables/useSessionComparison.ts`**
- Composable that takes two session IDs, loads all data in parallel, computes deltas
- Returns reactive comparison state
- Cleaner separation than putting comparison logic in the view

**No router changes needed** — route already exists: `{ path: '/compare', name: 'compare', ... }`

**No sidebar changes needed** — "Compare" already in `advancedNav`

#### UI Discovery Point
- **Location**: Existing sidebar item "Compare" in Advanced Navigation (already exists)
- **Access path**: Sidebar → Compare → Select two sessions
- **Also**: Could add "Compare with..." action on session detail header

### Effort Estimate
- Frontend only: ~400-500 lines (rewrite of view + composable)
- No backend, types, or client changes
- **Low-medium effort, high impact** (replaces a stub with real functionality)

---

## Feature 4: Checkpoint Navigator

### Overview
Visual timeline of checkpoints with memory pressure gauge, expandable checkpoint cards showing pre/post compaction tokens, compression ratios, summary content, and activity strips between checkpoints.

### Feasibility: 🟡 PARTIALLY FEASIBLE — Some data needs new backend exposure

### Data Requirements vs Availability

| Required Data | Available? | Source |
|---|---|---|
| Checkpoint list (number, title, filename) | ✅ | `get_session_checkpoints(session_id)` |
| Checkpoint content/summary text | ✅ | `CheckpointEntry.content` (≤50KB truncation) |
| Pre-compaction token count | 🟡 | Parsed from events as `CompactionCompleteData.pre_compaction_tokens` but NOT exposed via a dedicated field on `CheckpointEntry` |
| Post-compaction token count | 🟡 | Same — `CompactionCompleteData.compaction_tokens_used` is parsed but not on `CheckpointEntry` |
| Compaction duration | 🟡 | Available in event data but not on checkpoint |
| Context window max size | 🟡 | Not stored anywhere — would need to be derived from model info or configured |
| Activity between checkpoints (tool calls, turns, tokens) | 🟡 | Derivable from turns data + checkpoint numbering but not pre-computed |

### Missing Data Solutions

**Pre/Post Compaction Tokens on Checkpoints:**

The compaction data IS parsed in `crates/tracepilot-core/src/parsing/events.rs` as `CompactionCompleteData`:
```rust
pub struct CompactionCompleteData {
    pub pre_compaction_tokens: Option<u64>,
    pub summary_content: Option<String>,
    pub compaction_tokens_used: Option<u64>,
    // ...
}
```

And checkpoints are parsed in `crates/tracepilot-core/src/parsing/checkpoints.rs`:
```rust
pub struct CheckpointEntry {
    pub number: u32,
    pub title: String,
    pub filename: String,
    pub content: String,
}
```

**Solution**: Enrich `CheckpointEntry` with compaction data by correlating checkpoint events with compaction events during parsing. This requires:

1. **Modify `crates/tracepilot-core/src/parsing/checkpoints.rs`**:
   - Add fields to `CheckpointEntry`:
     ```rust
     pub struct CheckpointEntry {
         pub number: u32,
         pub title: String,
         pub filename: String,
         pub content: String,
         // New fields:
         pub pre_compaction_tokens: Option<u64>,
         pub post_compaction_tokens: Option<u64>,
         pub compaction_duration_ms: Option<u64>,
     }
     ```
   - During parsing, match compaction events to checkpoints by sequence/timing

2. **Alternative (simpler)**: Use `get_session_events` in the frontend and filter for compaction events, then correlate with checkpoints by timestamp ordering. This avoids backend changes but requires loading all events.

**Recommended approach**: **Enrich CheckpointEntry** in the parser. Compaction events and checkpoint events occur in sequence — a compaction event is always followed by a checkpoint write. The parser already processes events linearly, so correlation is straightforward.

**Activity Between Checkpoints:**
- Derivable from turns: Filter turns by index range between checkpoints
- Each turn has tool call count, tokens, duration
- Frontend can compute this from turns + checkpoints data (both already loaded)

**Memory Pressure / Context Window Size:**
- Max context window per model is a known constant (e.g., 200K for Claude Sonnet 4)
- Can be configured or derived from model name → lookup table
- Peak usage = max `pre_compaction_tokens` across all checkpoints

### Implementation Plan

#### Backend Changes

**Modify: `crates/tracepilot-core/src/parsing/checkpoints.rs`**
- Add `pre_compaction_tokens`, `post_compaction_tokens`, `compaction_duration_ms` fields to `CheckpointEntry`
- Modify parsing to correlate with compaction events from the session's event stream
- This requires access to events during checkpoint parsing — may need to pass compaction events as input or do a second pass

**Alternative approach (Recommended for minimal disruption):**
- Add a NEW Tauri command `get_session_compactions(session_id)` that returns compaction events directly:
  ```rust
  #[tauri::command]
  pub async fn get_session_compactions(
      state: tauri::State<'_, AppState>,
      session_id: String,
  ) -> Result<Vec<CompactionEvent>, String>
  ```
  ```rust
  pub struct CompactionEvent {
      pub checkpoint_number: Option<u32>,
      pub pre_compaction_tokens: u64,
      pub post_compaction_tokens: u64,
      pub summary_content: Option<String>,
      pub duration_ms: Option<u64>,
      pub timestamp: String,
  }
  ```
- Frontend correlates compactions with checkpoints by checkpoint_number or temporal ordering
- **Pro**: No changes to existing checkpoint parsing. Clean separation.
- **Con**: Extra API call. But checkpoints are small data, so this is fine.

**Modify: `crates/tracepilot-tauri-bindings/src/lib.rs`**
- Add `get_session_compactions` command
- Implementation: Load events, filter for `CompactionComplete` type, extract data

**Modify: `apps/desktop/src-tauri/build.rs`**
- Add `"get_session_compactions"` to command list

#### Frontend Changes

**Replace checkpoint rendering in `apps/desktop/src/views/tabs/OverviewTab.vue`**
- Currently checkpoints are a simple flat list (lines 86-102)
- Two options:
  - **Option A**: Replace inline checkpoint list with a `<CheckpointNavigator>` component
  - **Option B**: Create a dedicated "Checkpoints" tab (better for complex visualization)

**Recommended: Option B — New Checkpoints Tab**

**New file: `apps/desktop/src/views/tabs/CheckpointsTab.vue`**
- Uses `useSessionTabLoader` to load checkpoints + compactions + turns
- Computes activity strips between checkpoints from turns data
- Computes memory pressure gauge from max pre_compaction_tokens vs model context limit
- Contains:
  1. Memory pressure SVG gauge
  2. Vertical timeline with checkpoint cards (expandable)
  3. Activity strips between cards showing tool calls, turns, tokens, duration
  4. Checkpoint content viewer (markdown rendered)

**New type in `packages/types/src/index.ts`:**
```ts
export interface CompactionEvent {
  checkpointNumber?: number;
  preCompactionTokens: number;
  postCompactionTokens: number;
  summaryContent?: string;
  durationMs?: number;
  timestamp: string;
}
```

**New client function in `packages/client/src/index.ts`:**
```ts
export async function getSessionCompactions(sessionId: string): Promise<CompactionEvent[]> {
  return invoke("get_session_compactions", { sessionId });
}
```

**Modify: `apps/desktop/src/stores/sessionDetail.ts`**
- Add `compactions` ref + `loadCompactions()` loader following existing pattern

**Modify: `apps/desktop/src/views/SessionDetailView.vue`**
- Add tab:
  ```ts
  { name: "checkpoints", routeName: "session-checkpoints", label: "Checkpoints", count: store.detail?.checkpointCount }
  ```

**Modify: `apps/desktop/src/router/index.ts`**
- Add child route:
  ```ts
  {
    path: 'checkpoints',
    name: 'session-checkpoints',
    component: () => import('@/views/tabs/CheckpointsTab.vue'),
    meta: { title: 'Checkpoints', sidebarId: 'sessions' }
  }
  ```

**Modify: `apps/desktop/src/views/tabs/OverviewTab.vue`**
- Simplify checkpoint section to just show count + link to Checkpoints tab
- Or keep existing simple list as a "preview" and link to full navigator

#### UI Discovery Point
- **Location**: New "Checkpoints" tab in session detail view
- **Access path**: Sessions → Click session → Checkpoints tab
- **Also**: Overview tab checkpoint section could link to full navigator

### Effort Estimate
- Backend: ~100-150 lines (new command + compaction event extraction)
- Frontend: ~400-500 lines (new tab with timeline visualization)
- Types + Client: ~30 lines
- **Medium effort, high impact** (transforms boring checkpoint list into insightful timeline)

---

## Feature 5: Todo Dependency Graph

### Overview
Interactive DAG visualization of todo items and their dependencies. Nodes colored by status, edges showing dependency relationships. Click for detail panel with description and connected items.

### Feasibility: 🟢 FULLY FEASIBLE — All data already available, pure frontend

### Data Requirements vs Availability

| Required Data | Available? | Source |
|---|---|---|
| Todo list (id, title, description, status) | ✅ | `get_session_todos(session_id)` → `todos: TodoItem[]` |
| Todo dependencies (todoId, dependsOn) | ✅ | `get_session_todos(session_id)` → `deps: TodoDep[]` |

**ALL data is already loaded by the existing TodosTab.** The `deps` array IS already used to show inline dependency badges. This feature just adds a visual graph view.

### Implementation Plan

#### Backend Changes: NONE

#### Frontend Changes

**Modify: `apps/desktop/src/views/tabs/TodosTab.vue`**
- Add a view toggle: "List" / "Graph" (default: List to preserve current UX)
- When "Graph" is selected, render `<TodoDependencyGraph>` component
- Toggle button placed near the progress section header

**New file: `packages/ui/src/components/TodoDependencyGraph.vue`** (or `apps/desktop/src/components/TodoDependencyGraph.vue`)
- Props: `todos: TodoItem[]`, `deps: TodoDep[]`
- Emits: `select-todo(id: string)`
- Contains:
  1. **Topological sort** (Kahn's algorithm) to compute levels — exact algorithm from prototype
  2. **SVG DAG layout**: Nodes positioned by level (left-to-right or top-to-bottom), edges as cubic beziers
  3. **Node rendering**: Rounded rect with title, colored border by status (done=green, in_progress=blue, pending=gray, blocked=red)
  4. **Edge rendering**: Cubic bezier paths from source bottom to target top, colored by source status
  5. **Hover highlighting**: Connected nodes and edges highlight on hover
  6. **Click selection**: Detail panel slides in from right showing description, dependencies, dependents
  7. **Pan/zoom**: Transform-based pan and zoom for large graphs
  8. **Stats bar**: Progress bar + status counts (reuse existing from TodosTab)

**Placement decision**: Put in `@tracepilot/ui` package if it should be reusable, or in `apps/desktop/src/components/` if desktop-specific. Recommend: `apps/desktop/src/components/` since it's specific to TracePilot session visualization.

**No router changes** — this is a view toggle within the existing Todos tab, not a new route.

#### UI Discovery Point
- **Location**: View toggle in existing Todos tab ("List" | "Graph")
- **Access path**: Sessions → Click session → Todos tab → Toggle to Graph view
- **Also**: Could auto-switch to Graph when ≥5 todos have dependencies

### Effort Estimate
- Frontend only: ~250-350 lines (graph component with SVG layout)
- No backend, types, or client changes
- **Low effort, high visual impact** — user explicitly said "I love this one"

---

## Feature 6: Tool Ecosystem Map

### Overview
Network graph showing which tools are frequently used together (co-occurrence). Thick edges = strong co-occurrence. Also shows common tool chains (ordered sequences). Reveals workflow patterns like `grep → view → edit`.

### Feasibility: 🔴 REQUIRES NEW BACKEND — Co-occurrence/chain computation doesn't exist

### Data Requirements vs Availability

| Required Data | Available? | Source |
|---|---|---|
| Per-tool call counts | ✅ | `get_tool_analysis()` → `tools[].callCount` |
| Tool co-occurrence pairs + frequency | ❌ | Must be computed from turns across sessions |
| Tool chains (ordered sequences + count) | ❌ | Must be extracted from turns |
| Chain avg duration | ❌ | Must be computed from turn timestamps |
| Chain success rate | ❌ | Must be computed from tool call statuses |
| Tool categories | ✅ | `toolCategory()` utility in `@tracepilot/ui` already categorizes tools |

### Data Derivation Strategy

**Co-occurrence**: Two tools "co-occur" when they appear in the same turn. For each turn with N tool calls, every pair (A, B) gets +1 co-occurrence count.

**Chains**: An ordered sequence of tool calls within a turn. For a turn with calls [grep, view, edit], the chains are: [grep, view], [view, edit], [grep, view, edit].

**Computation approaches:**

**Option A: Pre-aggregate per-session in Index DB (Recommended — REVISED per review)**
Add per-session tables (matching existing `session_tool_calls` pattern):
```sql
CREATE TABLE IF NOT EXISTS session_tool_cooccurrence (
    session_id TEXT NOT NULL,
    tool_a TEXT NOT NULL,
    tool_b TEXT NOT NULL,  -- INVARIANT: tool_a < tool_b (canonical alphabetical order)
    cooccurrence_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, tool_a, tool_b),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
```

And `session_tool_chains`:
```sql
CREATE TABLE IF NOT EXISTS session_tool_chains (
    session_id TEXT NOT NULL,
    chain_key TEXT NOT NULL, -- e.g. "grep|view|edit"
    chain_tools TEXT NOT NULL,   -- JSON: ["grep", "view", "edit"]
    occurrence_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, chain_key),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
```

Cross-session aggregates computed at query time:
```sql
SELECT tool_a, tool_b, SUM(cooccurrence_count) as total
FROM session_tool_cooccurrence
GROUP BY tool_a, tool_b
ORDER BY total DESC
LIMIT 50;
```

Populated during `upsert_session()` — old rows DELETEd first (idempotent reindex).

**Pro**: Fast queries, correct on reindex, matches existing per-session table pattern
**Con**: Slightly more rows than global table; query aggregation has minor overhead (negligible for <1000 sessions)

**Option B: On-demand computation from turns**
When the user visits the Tool Ecosystem page, load all sessions' turns and compute co-occurrence/chains in the frontend or a dedicated backend function.

**Pro**: No schema changes
**Con**: Slow for large datasets (100+ sessions × 50+ turns each = thousands of tool calls to process). Not viable for responsive UX.

**Option C: Backend function without new tables (Compromise)**
Add a Tauri command that scans all indexed sessions' turns and computes co-occurrence/chains on demand, using the existing `session_tool_calls` table + turn data from disk.

**Pro**: No schema changes
**Con**: Still slow, but cached after first computation

**Decision: Option A** — Per-session tables with query-time aggregation. This matches the existing architecture (all other tables are per-session) and is safe for incremental reindex. The user noted this feature is "worth it if minimal cost." The per-session approach has moderate schema effort but correct semantics.

### Implementation Plan

#### Backend Changes

**Modify: `crates/tracepilot-indexer/src/index_db.rs`**
- Add two new per-session tables in `ensure_schema()` (see revised schema above)
- Add indexes:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_tool_cooccurrence_tools ON session_tool_cooccurrence(tool_a, tool_b);
  CREATE INDEX IF NOT EXISTS idx_tool_chains_key ON session_tool_chains(chain_key);
  ```
- In `upsert_session()`, after processing tool calls:
  1. `DELETE FROM session_tool_cooccurrence WHERE session_id = ?` (idempotent cleanup)
  2. `DELETE FROM session_tool_chains WHERE session_id = ?`
  3. For each turn's tool calls, compute unique pairs with canonical ordering (`tool_a < tool_b`) → INSERT into `session_tool_cooccurrence`
  4. For each turn's ordered tool call sequence, extract chains of length 2-5 → INSERT into `session_tool_chains`
  
- **IMPORTANT**: Increment `CURRENT_ANALYTICS_VERSION` to trigger backfill reindex on first launch after deployment

**New function in `crates/tracepilot-core/src/analytics/aggregator.rs`:**
```rust
pub fn compute_tool_ecosystem(db: &Connection) -> Result<ToolEcosystemData> {
    // Cross-session aggregation from per-session tables:
    // SELECT tool_a, tool_b, SUM(cooccurrence_count) as total
    //   FROM session_tool_cooccurrence GROUP BY tool_a, tool_b ORDER BY total DESC LIMIT 50;
    // SELECT chain_key, chain_tools, SUM(occurrence_count), 
    //        SUM(total_duration_ms) * 1.0 / NULLIF(SUM(occurrence_count), 0), ...
    //   FROM session_tool_chains GROUP BY chain_key ORDER BY SUM(occurrence_count) DESC LIMIT 100;
}
```

**New types in `crates/tracepilot-core/src/analytics/types.rs`:**
```rust
pub struct ToolEcosystemData {
    pub tools: Vec<ToolNode>,
    pub cooccurrences: Vec<ToolCooccurrence>,
    pub chains: Vec<ToolChain>,
    pub total_sequences: u64,
    pub avg_chain_length: f64,
}
pub struct ToolNode {
    pub name: String,
    pub category: String,
    pub total_calls: u64,
}
pub struct ToolCooccurrence {
    pub tool_a: String,
    pub tool_b: String,
    pub count: u64,
}
pub struct ToolChain {
    pub tools: Vec<String>,
    pub count: u64,
    pub avg_duration_ms: f64,
    pub success_rate: f64,
}
```

**New Tauri command in `crates/tracepilot-tauri-bindings/src/lib.rs`:**
```rust
#[tauri::command]
pub async fn get_tool_ecosystem(
    state: tauri::State<'_, AppState>,
) -> Result<ToolEcosystemData, String>
```

**Modify: `apps/desktop/src-tauri/build.rs`**
- Add `"get_tool_ecosystem"` to command list

#### Frontend Changes

**New file: `apps/desktop/src/views/ToolEcosystemView.vue`**
- Top-level view (linked from Tool Analysis or separate sidebar item)
- Contains:
  1. Stat cards (unique tools, most common chain, avg chain length, total sequences)
  2. Force-directed network graph (SVG/Canvas)
  3. Tool chain table (with pill-style chain display)
  4. Filter by category
  5. Detail panel on tool click (connections, top chains involving this tool)

**New types in `packages/types/src/index.ts`:**
```ts
export interface ToolEcosystemData {
  tools: ToolNode[];
  cooccurrences: ToolCooccurrence[];
  chains: ToolChain[];
  totalSequences: number;
  avgChainLength: number;
}
// ... sub-types
```

**New client function in `packages/client/src/index.ts`:**
```ts
export async function getToolEcosystem(): Promise<ToolEcosystemData> {
  return invoke("get_tool_ecosystem");
}
```

**Modify: `apps/desktop/src/router/index.ts`**
- Add route:
  ```ts
  {
    path: '/tool-ecosystem',
    name: 'tool-ecosystem',
    component: () => import('@/views/ToolEcosystemView.vue'),
    meta: { title: 'Tool Ecosystem', sidebarId: 'tools' }
  }
  ```

**Modify: `apps/desktop/src/views/ToolAnalysisView.vue`**
- Add a link/button: "View Ecosystem Map →" that navigates to `/tool-ecosystem`

#### UI Discovery Point
- **Location**: Accessed from Tool Analysis view via link, and/or separate sidebar item under Tools
- **Access path**: Sidebar → Tools → Ecosystem Map link (or Sidebar → Tool Ecosystem)

### Effort Estimate
- Backend: ~300-400 lines (2 new tables, indexing logic, aggregation function, command)
- Frontend: ~400-500 lines (force-directed graph + chain table)
- Types + Client: ~50 lines
- **High effort, medium impact** — Complex backend changes for a "cool but not critical" feature

### Cost/Benefit Assessment
- **Indexing overhead**: Computing co-occurrence for each session adds ~O(T²) per turn where T is tool calls per turn. Typically T < 20, so O(400) comparisons per turn × ~30 turns = ~12K operations per session. Very fast (< 1ms additional per session).
- **Storage**: Per-session co-occurrence: ~10-50 rows per session. Per-session chains: ~5-30 rows per session. For 1000 sessions: ~50K rows max. Negligible.
- **Query overhead**: Cross-session aggregation via `GROUP BY` on ~50K rows completes in <10ms on SQLite.
- **Reindex safety**: Per-session tables with DELETE+INSERT are fully idempotent — no double-counting risk.
- **Verdict**: The indexing cost is truly minimal. Worth implementing.

---

## Feature 7: MCP Server Analytics

### Overview
Dashboard for Model Context Protocol (MCP) server usage: which servers are active, which tools they provide, call counts, success rates, latency, error logs, and health heatmaps.

### Feasibility: 🟡 REQUIRES NEW BACKEND — MCP data exists on tool calls but isn't indexed

### Data Requirements vs Availability

| Required Data | Available? | Source |
|---|---|---|
| MCP server names | ✅ (on turns) | `TurnToolCall.mcp_server_name` — populated during parsing |
| MCP tool names | ✅ (on turns) | `TurnToolCall.mcp_tool_name` — populated during parsing |
| Per-server call count | ❌ (not indexed) | Must be aggregated from turns across sessions |
| Per-server success rate | ❌ (not indexed) | Must be aggregated from tool call success/failure |
| Per-server avg latency | ❌ (not indexed) | Must be computed from tool call durations |
| Per-server tool list | ❌ (not indexed) | Must be extracted from unique mcp_tool_name per server |
| Per-server sparkline (daily calls) | ❌ (not indexed) | Needs aggregation |
| Error log entries | 🟡 | Tool call errors exist on turns but not filtered by MCP server |
| Server health/status | ❌ | Not tracked — MCP servers are transient per session |

### Key Architectural Decision

MCP server data is available on every `TurnToolCall` (fields: `mcp_server_name`, `mcp_tool_name`), but these fields are NOT indexed in any table. The `session_tool_calls` table only stores `tool_name` and `call_count` — not MCP server association.

**Option A: New Index Table (Recommended)**
Add `session_mcp_calls` table:
```sql
CREATE TABLE IF NOT EXISTS session_mcp_calls (
    session_id TEXT NOT NULL,
    mcp_server TEXT NOT NULL,
    mcp_tool TEXT NOT NULL,
    call_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, mcp_server, mcp_tool),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
```

Populated during `upsert_session()` by iterating turns and filtering for tool calls where `mcp_server_name.is_some()`.

**Option B: On-demand scan**
Load all sessions' turns, filter for MCP tool calls, aggregate in frontend.

**Decision: Option A** — Index table. MCP analytics should be fast, and the table is straightforward to populate from existing turn data during indexing.

### Implementation Plan

#### Backend Changes

**Modify: `crates/tracepilot-indexer/src/index_db.rs`**
- Add table in `ensure_schema()`:
  ```sql
  CREATE TABLE IF NOT EXISTS session_mcp_calls (
      session_id TEXT NOT NULL,
      mcp_server TEXT NOT NULL,
      mcp_tool TEXT NOT NULL,
      call_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, mcp_server, mcp_tool)
  );
  ```
- In `upsert_session()`, iterate session turns, filter for MCP tool calls, aggregate per (server, tool) and insert

**New function in `crates/tracepilot-core/src/analytics/aggregator.rs`:**
```rust
pub fn compute_mcp_analytics(
    db: &Connection,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<McpAnalyticsData>
```
Query:
```sql
SELECT mcp_server, mcp_tool,
       SUM(call_count) as total_calls,
       SUM(success_count) as total_success,
       SUM(fail_count) as total_fail,
       SUM(total_duration_ms) * 1.0 / NULLIF(SUM(call_count), 0) as avg_latency_ms
FROM session_mcp_calls mc
JOIN sessions s ON mc.session_id = s.session_id
WHERE (?1 IS NULL OR s.created_at >= ?1)
  AND (?2 IS NULL OR s.created_at <= ?2)
GROUP BY mcp_server, mcp_tool
```

**New types in `crates/tracepilot-core/src/analytics/types.rs`:**
```rust
pub struct McpAnalyticsData {
    pub servers: Vec<McpServerSummary>,
    pub total_calls: u64,
    pub avg_latency_ms: f64,
    pub overall_success_rate: f64,
}
pub struct McpServerSummary {
    pub name: String,
    pub tools: Vec<McpToolSummary>,
    pub total_calls: u64,
    pub success_rate: f64,
    pub avg_latency_ms: f64,
}
pub struct McpToolSummary {
    pub name: String,
    pub call_count: u64,
    pub success_rate: f64,
    pub avg_latency_ms: f64,
}
```

**New Tauri command in `crates/tracepilot-tauri-bindings/src/lib.rs`:**
```rust
#[tauri::command]
pub async fn get_mcp_analytics(
    state: tauri::State<'_, AppState>,
    from_date: Option<String>,
    to_date: Option<String>,
) -> Result<McpAnalyticsData, String>
```

**Modify: `apps/desktop/src-tauri/build.rs`**
- Add `"get_mcp_analytics"` to command list

#### Frontend Changes

**New file: `apps/desktop/src/views/McpAnalyticsView.vue`**
- Top-level analytics view
- Contains:
  1. Stat cards (active servers, total MCP calls, avg latency, overall success rate)
  2. Server cards with sparkline, success ring, tool count, call count
  3. Tool distribution bar chart (per selected server)
  4. Error entries (filtered from tool call errors — loaded on demand per server)
  
- **Simplified from prototype**: Skip latency timeline and health heatmap for v1 (would need daily granularity which requires more indexing). Add in v2 if demand exists.

**New types in `packages/types/src/index.ts`:**
```ts
export interface McpAnalyticsData {
  servers: McpServerSummary[];
  totalCalls: number;
  avgLatencyMs: number;
  overallSuccessRate: number;
}
export interface McpServerSummary {
  name: string;
  tools: McpToolSummary[];
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
}
export interface McpToolSummary {
  name: string;
  callCount: number;
  successRate: number;
  avgLatencyMs: number;
}
```

**New client function in `packages/client/src/index.ts`:**
```ts
export async function getMcpAnalytics(
  fromDate?: string, toDate?: string
): Promise<McpAnalyticsData> {
  return invoke("get_mcp_analytics", { fromDate, toDate });
}
```

**Modify: `apps/desktop/src/router/index.ts`**
```ts
{
  path: '/mcp',
  name: 'mcp-analytics',
  component: () => import('@/views/McpAnalyticsView.vue'),
  meta: { title: 'MCP Servers', sidebarId: 'mcp' }
}
```

**Modify: `apps/desktop/src/components/layout/AppSidebar.vue`**
- Add to `advancedNav`:
  ```ts
  { id: 'mcp', label: 'MCP Servers', to: '/mcp', icon: 'mcp' }
  ```
- Add MCP icon SVG (server/plug icon)

#### UI Discovery Point
- **Location**: New sidebar item "MCP Servers" in Advanced Navigation
- **Access path**: Sidebar → MCP Servers
- **Conditional visibility**: Only show if any MCP data exists (check via quick query or on first load)

### Effort Estimate
- Backend: ~200-250 lines (new table, aggregation function, command)
- Frontend: ~350-400 lines (view with server cards and charts)
- Types + Client: ~40 lines
- **Medium effort, medium impact** — Useful for users with MCP servers; niche but valuable

### Note on Incremental Updates
When a new session is indexed, `session_mcp_calls` gets new rows. Queries against the aggregate are always fresh. Re-indexing a session: `DELETE FROM session_mcp_calls WHERE session_id = ?` + re-insert. This is the same pattern as `session_tool_calls`.

---

## Feature 8: Agent Effectiveness Scorecard

### Overview
Dashboard comparing subagent types (explore, task, general-purpose, code-review) on: invocation count, success rate, avg duration, token usage, cost, tool calls per run. Includes comparison table, stacked usage trend, and delegation log.

### Feasibility: 🟡 REQUIRES NEW BACKEND — Subagent data exists on turns but isn't indexed

### Data Requirements vs Availability

| Required Data | Available? | Source |
|---|---|---|
| Agent type (explore/task/general-purpose/code-review) | ✅ (on turns) | `TurnToolCall.agent_display_name` — populated during parsing |
| Is subagent flag | ✅ (on turns) | `TurnToolCall.is_subagent` — populated during parsing |
| Per-agent invocation count | ❌ (not indexed) | Must aggregate from turns |
| Per-agent success/fail count | ❌ (not indexed) | Must aggregate from tool call success |
| Per-agent avg duration | ❌ (not indexed) | Must aggregate from tool call durations |
| Per-agent avg tokens | ❌ (not indexed) | Tricky — subagent token usage not directly attributed |
| Per-agent model used | ✅ (on turns) | `TurnToolCall.model` — model used for the subagent |
| Delegation log (task description, agent, outcome) | ✅ (on turns) | `TurnToolCall.intention_summary` + `agent_display_name` + success/fail |

### Key Architectural Decision

Like MCP, subagent data is on `TurnToolCall` but not indexed. Same two options:

**Option A: New Index Table (Recommended)**
Add `session_agent_calls` table:
```sql
CREATE TABLE IF NOT EXISTS session_agent_calls (
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    call_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    total_tool_calls INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, agent_type),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);
```

**Decision: Option A** — Same rationale as MCP analytics. Index for fast queries.

### Mapping agent_display_name to agent_type

The `agent_display_name` field contains values like "explore", "task", "general-purpose", "code-review" (matching the `agent_type` parameter in the Task tool). During indexing, filter for tool calls where `is_subagent = true` and group by `agent_display_name`.

**Token attribution challenge**: Subagent tool calls don't directly contain token counts. The tokens are part of the subagent's own model API calls, which are not tracked in the parent session's turn data. We can:
1. Use `result_content` length as a proxy for output tokens
2. Use the parent `Task` tool call's duration as a proxy for complexity
3. Accept that per-agent token data is approximate

**Decision**: For v1, omit per-agent token counts. Focus on: invocation count, success/fail, duration, tool calls per run. Token data can be added later if we find a way to attribute it.

### Implementation Plan

#### Backend Changes

**Modify: `crates/tracepilot-indexer/src/index_db.rs`**
- Add table in `ensure_schema()`:
  ```sql
  CREATE TABLE IF NOT EXISTS session_agent_calls (
      session_id TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      call_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      fail_count INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      total_tool_calls INTEGER DEFAULT 0,
      PRIMARY KEY (session_id, agent_type)
  );
  ```
- In `upsert_session()`, iterate turns, find tool calls where `is_subagent = true`, group by `agent_display_name`, count success/fail/duration/nested tool calls

**New function in `crates/tracepilot-core/src/analytics/aggregator.rs`:**
```rust
pub fn compute_agent_effectiveness(
    db: &Connection,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<AgentEffectivenessData>
```

**New types in `crates/tracepilot-core/src/analytics/types.rs`:**
```rust
pub struct AgentEffectivenessData {
    pub agents: Vec<AgentTypeSummary>,
    pub total_invocations: u64,
    pub overall_success_rate: f64,
}
pub struct AgentTypeSummary {
    pub agent_type: String,
    pub invocations: u64,
    pub success_rate: f64,
    pub avg_duration_ms: f64,
    pub total_cost: Option<f64>, // if attributable
    pub fail_count: u64,
    pub avg_tool_calls: f64,
    pub score: u8, // computed health score 0-100
}
```

**Score computation**: `score = weighted_avg(success_rate * 0.4 + normalized_speed * 0.3 + normalized_efficiency * 0.3)` where speed and efficiency are relative to other agent types.

**New Tauri command in `crates/tracepilot-tauri-bindings/src/lib.rs`:**
```rust
#[tauri::command]
pub async fn get_agent_effectiveness(
    state: tauri::State<'_, AppState>,
    from_date: Option<String>,
    to_date: Option<String>,
) -> Result<AgentEffectivenessData, String>
```

**Modify: `apps/desktop/src-tauri/build.rs`**
- Add `"get_agent_effectiveness"` to command list

#### Frontend Changes

**New file: `apps/desktop/src/views/AgentEffectivenessView.vue`**
- Top-level analytics view
- Contains:
  1. Agent type cards (4 cards: explore, task, general-purpose, code-review) with health ring, invocation count, success/fail bar
  2. Comparison table (7 metrics × 4 agents) with best/worst highlighting
  3. Delegation patterns section (loads recent subagent calls from turns for a detailed log — this uses existing `get_session_turns` for the most recent sessions)
  
- **Simplified from prototype**: Skip stacked area chart and scatter plot for v1 (would need daily time-series data). The comparison table and agent cards provide the core value.

**New types in `packages/types/src/index.ts`:**
```ts
export interface AgentEffectivenessData {
  agents: AgentTypeSummary[];
  totalInvocations: number;
  overallSuccessRate: number;
}
export interface AgentTypeSummary {
  agentType: string;
  invocations: number;
  successRate: number;
  avgDurationMs: number;
  totalCost?: number;
  failCount: number;
  avgToolCalls: number;
  score: number;
}
```

**New client function in `packages/client/src/index.ts`:**
```ts
export async function getAgentEffectiveness(
  fromDate?: string, toDate?: string
): Promise<AgentEffectivenessData> {
  return invoke("get_agent_effectiveness", { fromDate, toDate });
}
```

**Modify: `apps/desktop/src/router/index.ts`**
```ts
{
  path: '/agents',
  name: 'agent-effectiveness',
  component: () => import('@/views/AgentEffectivenessView.vue'),
  meta: { title: 'Agent Effectiveness', sidebarId: 'agents' }
}
```

**Modify: `apps/desktop/src/components/layout/AppSidebar.vue`**
- Add to `advancedNav`:
  ```ts
  { id: 'agents', label: 'Agents', to: '/agents', icon: 'agents' }
  ```
- Add agents icon SVG (users/bot icon)

#### UI Discovery Point
- **Location**: New sidebar item "Agents" in Advanced Navigation
- **Access path**: Sidebar → Agents
- **Conditional visibility**: Only show if any subagent data exists

### Effort Estimate
- Backend: ~200-250 lines (new table, aggregation function, score computation, command)
- Frontend: ~350-400 lines (view with cards, table, delegation log)
- Types + Client: ~40 lines
- **Medium effort, high impact** — Very useful for understanding subagent performance

---

## Shared Infrastructure

### New Index DB Tables (Summary)

All new tables are per-session (matching existing patterns) — no global aggregate tables. Plus minor column additions to one existing table.

| Table | Feature(s) | Rows (estimate) | Notes |
|-------|-----------|-----------------|-------|
| `session_tool_cooccurrence` | Tool Ecosystem Map | ~10-50 per session | Canonical order: tool_a < tool_b |
| `session_tool_chains` | Tool Ecosystem Map | ~5-30 per session | Chains of length 2-5 |
| `session_mcp_calls` | MCP Server Analytics | ~5-20 per session | Per MCP server+tool |
| `session_agent_calls` | Agent Effectiveness | ~1-4 per session | Per agent type |

**Modified table:**
| Table | Changes | Feature |
|-------|---------|---------|
| `session_model_metrics` | +3 columns: `success_count`, `fail_count`, `total_duration_ms` | Model Comparison |

**New indexes:**
| Index | Table | Purpose |
|-------|-------|---------|
| `idx_sessions_created_at` | `sessions` | Date-filtered analytics queries |
| `idx_sessions_repo_created_at` | `sessions` | Repo+date filtered analytics |
| `idx_tool_cooccurrence_tools` | `session_tool_cooccurrence` | Cross-session aggregation |
| `idx_tool_chains_key` | `session_tool_chains` | Cross-session aggregation |

**IMPORTANT**: Increment `CURRENT_ANALYTICS_VERSION` in `index_db.rs` to trigger reindex/backfill on first launch.

### Schema Migration Strategy

The existing codebase uses `CREATE TABLE IF NOT EXISTS` — new tables are automatically created on first DB open. For the `session_model_metrics` column additions:

```rust
// In ensure_schema() or a migration function:
// Try ALTER TABLE; ignore error if column already exists
let _ = conn.execute("ALTER TABLE session_model_metrics ADD COLUMN success_count INTEGER DEFAULT 0", []);
let _ = conn.execute("ALTER TABLE session_model_metrics ADD COLUMN fail_count INTEGER DEFAULT 0", []);
let _ = conn.execute("ALTER TABLE session_model_metrics ADD COLUMN total_duration_ms INTEGER DEFAULT 0", []);
```

This is safe because `ALTER TABLE ADD COLUMN` fails silently if the column exists (when caught).

### New Tauri Commands (Summary)

| Command | Feature | Parameters |
|---------|---------|------------|
| `get_model_comparison` | Model Comparison Matrix | `from_date?, to_date?, repo?` |
| `get_session_compactions` | Checkpoint Navigator | `session_id` |
| `get_tool_ecosystem` | Tool Ecosystem Map | (none — cross-session) |
| `get_mcp_analytics` | MCP Server Analytics | `from_date?, to_date?` |
| `get_agent_effectiveness` | Agent Effectiveness | `from_date?, to_date?` |

All 5 commands must be registered in:
1. `crates/tracepilot-tauri-bindings/src/lib.rs` — `#[tauri::command]` + `generate_handler![]`
2. `apps/desktop/src-tauri/build.rs` — `.commands(&[...])`

### Shared Component Opportunities

Several features share visualization patterns. Consider creating shared components:

| Component | Used By | Description |
|-----------|---------|-------------|
| `<SparklineChart>` | Model Comparison, MCP Analytics | Mini line chart for trends |
| `<RadarChart>` | Model Comparison | Spider/radar chart SVG |
| `<ForceGraph>` | Tool Ecosystem, Todo Dependencies | Force-directed graph renderer |
| `<DeltaValue>` | Session Comparison, Model Comparison | Value with delta indicator (↑↓) |

**Recommendation**: Create `<SparklineChart>` and `<DeltaValue>` in `@tracepilot/ui` as they're needed by multiple features. `<RadarChart>` and `<ForceGraph>` are too specialized — keep inline.

---

## Implementation Order

Based on dependencies, effort, and impact:

### Phase 1: No Backend Changes (Quick Wins)
These can be implemented immediately with zero backend work:

1. **Todo Dependency Graph** — Pure frontend, all data available, user's favorite ⭐
2. **Token Flow Sankey** — Pure frontend, all data from existing `shutdownMetrics`
3. **Session Comparison Enhanced** — Pure frontend, replaces existing stub

### Phase 2: Minor Backend Changes
These need small, focused backend additions:

4. **Checkpoint Navigator** — One new Tauri command (`get_session_compactions`), no index changes
5. **Model Comparison Matrix** — 3 new columns on existing table + SQL query enhancement + 1 new command

### Phase 3: New Index Tables
These require new tables in the indexer + reindex:

6. **Agent Effectiveness Scorecard** — New `session_agent_calls` table + command
7. **MCP Server Analytics** — New `session_mcp_calls` table + command
8. **Tool Ecosystem Map** — Two new tables (`tool_cooccurrence`, `tool_chains`) + command

**Rationale**: Phase 3 items all require reindexing, so they should be implemented together to minimize reindex cycles. The indexer changes for features 6, 7, and 8 can all be added in a single `upsert_session()` modification.

### Dependency Graph

```
[Phase 1 - No deps]
  ├── Todo Dependency Graph
  ├── Token Flow Sankey
  └── Session Comparison Enhanced

[Phase 2 - Minor backend]
  ├── Checkpoint Navigator (depends on: new command)
  └── Model Comparison Matrix (depends on: column migration + new command)

[Phase 3 - Index changes, batch together]
  ├── Agent Effectiveness (depends on: session_agent_calls table)
  ├── MCP Server Analytics (depends on: session_mcp_calls table)
  └── Tool Ecosystem Map (depends on: tool_cooccurrence + tool_chains tables)
```

---

## File Changes Summary

### New Files (13)

| File | Feature | Type |
|------|---------|------|
| `apps/desktop/src/views/tabs/TokenFlowTab.vue` | Token Flow Sankey | Vue component |
| `apps/desktop/src/views/tabs/CheckpointsTab.vue` | Checkpoint Navigator | Vue component |
| `apps/desktop/src/views/ModelComparisonView.vue` | Model Comparison | Vue component |
| `apps/desktop/src/views/ToolEcosystemView.vue` | Tool Ecosystem Map | Vue component |
| `apps/desktop/src/views/McpAnalyticsView.vue` | MCP Analytics | Vue component |
| `apps/desktop/src/views/AgentEffectivenessView.vue` | Agent Effectiveness | Vue component |
| `apps/desktop/src/components/TodoDependencyGraph.vue` | Todo Dep Graph | Vue component |
| `apps/desktop/src/composables/useSessionComparison.ts` | Session Comparison | Composable |
| `packages/ui/src/components/SparklineChart.vue` | Shared | UI component |
| `packages/ui/src/components/DeltaValue.vue` | Shared | UI component |
| (no new Rust files — all changes are modifications) | | |

### Modified Files (15)

| File | Changes | Features Affected |
|------|---------|-------------------|
| `crates/tracepilot-indexer/src/index_db.rs` | +4 tables, +3 columns, migration logic, upsert additions | MCP, Agents, Tool Ecosystem, Model Comparison |
| `crates/tracepilot-core/src/analytics/aggregator.rs` | +4 new compute functions | Model Comparison, Tool Ecosystem, MCP, Agents |
| `crates/tracepilot-core/src/analytics/types.rs` | +12 new structs | All Phase 2+3 features |
| `crates/tracepilot-tauri-bindings/src/lib.rs` | +5 new commands + handler registration | All Phase 2+3 features |
| `apps/desktop/src-tauri/build.rs` | +5 command registrations | All Phase 2+3 features |
| `packages/types/src/index.ts` | +10 new interfaces | All Phase 2+3 features |
| `packages/client/src/index.ts` | +5 new client functions | All Phase 2+3 features |
| `apps/desktop/src/router/index.ts` | +5 new routes (2 session tabs, 3 top-level) | All features |
| `apps/desktop/src/components/layout/AppSidebar.vue` | +3 nav items + icons | Model Comparison, MCP, Agents |
| `apps/desktop/src/views/SessionDetailView.vue` | +2 tab entries | Token Flow, Checkpoints |
| `apps/desktop/src/views/SessionComparisonView.vue` | Full rewrite | Session Comparison |
| `apps/desktop/src/views/tabs/TodosTab.vue` | +view toggle | Todo Dep Graph |
| `apps/desktop/src/views/tabs/OverviewTab.vue` | Simplify checkpoints section | Checkpoint Navigator |
| `apps/desktop/src/stores/sessionDetail.ts` | +compactions ref/loader | Checkpoint Navigator |
| `apps/desktop/src/stores/analytics.ts` | +model comparison + MCP + agents data | Multiple |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Index DB migration breaks existing data | Low | High | Use `ALTER TABLE ADD COLUMN` with error catching; `CREATE TABLE IF NOT EXISTS` for new tables. Bump `CURRENT_ANALYTICS_VERSION` to trigger backfill. Test with existing DB files. |
| Reindexing performance regression | Low | Medium | New indexing additions are O(turns × tool_calls) per session — typically < 1ms additional. Profile with large session sets. |
| SVG chart performance with large datasets | Medium | Medium | Limit nodes in force-directed graphs (cap at 50 nodes). Use Canvas fallback for >80 nodes. Use virtual scrolling for large tables. |
| MCP/Agent data sparsity | Medium | Low | Many users may not use MCP servers or subagents extensively. Conditionally hide sidebar items when no data exists. Show `<EmptyState>` gracefully. |
| Session comparison memory usage | Low | Medium | Loading two full sessions (turns + events) simultaneously. Turns are lazy-loaded; only load what's needed for comparison view. |
| Force-directed graph layout instability | Medium | Low | Cap iterations, use velocity damping, add convergence check. Precompute layout in composable, throttle drag/zoom. |
| Breaking existing tests | Low | Medium | Run existing test suite (`pnpm --filter @tracepilot/ui test` + `pnpm --filter @tracepilot/desktop test`) after each phase. New components should have their own tests. |
| Co-occurrence double-counting on reindex | ~~High~~ **Eliminated** | ~~High~~ | Resolved by using per-session tables with DELETE+INSERT pattern (see Review Consolidation C1). |
| Missing backfill for existing sessions | ~~High~~ **Eliminated** | ~~High~~ | Resolved by bumping `CURRENT_ANALYTICS_VERSION` (see Review Consolidation C2). |
| Average-of-averages SQL bug | ~~Medium~~ **Eliminated** | ~~Medium~~ | All aggregate queries use `SUM(total) / SUM(count)` pattern (see Review Consolidation I3). |
| Sidebar overcrowding with 3 new items | Medium | Low | Group under collapsible "Intelligence" section (see Review Consolidation I8). |
| Accessibility gaps in SVG charts | Medium | Medium | Include `<DataTable>` fallback for every visualization, ARIA labels, pattern/shape encodings alongside color. |
| Todo dependency cycles | Low | Medium | Kahn's algorithm detects cycles; show warning section for circular dependencies instead of crashing. |

---

## Review Consolidation (GPT-5.4, Codex 5.3, Gemini 3 Pro)

> Three AI models reviewed this plan. Below is a consolidated summary of findings with resolutions.

### 🔴 CRITICAL Issues (3) — ALL RESOLVED

#### C1: Tool Ecosystem global tables break on reindex (ALL 3 REVIEWERS)
**Problem**: `tool_cooccurrence` and `tool_chains` tables have no `session_id`. During `upsert_session()`, reindexing a session adds new counts without subtracting old ones, causing double-counting. Only a full rebuild would be correct.

**Resolution**: Switch to per-session tables (matching existing patterns):
```sql
CREATE TABLE IF NOT EXISTS session_tool_cooccurrence (
    session_id TEXT NOT NULL,
    tool_a TEXT NOT NULL,
    tool_b TEXT NOT NULL,  -- always tool_a < tool_b (canonical order)
    cooccurrence_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, tool_a, tool_b)
);
CREATE TABLE IF NOT EXISTS session_tool_chains (
    session_id TEXT NOT NULL,
    chain_key TEXT PRIMARY KEY,  -- "session_id|grep|view|edit"
    chain_tools TEXT NOT NULL,
    occurrence_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0
);
```
Cross-session aggregates computed at query time via `SUM(cooccurrence_count) ... GROUP BY tool_a, tool_b`. This makes `upsert_session()` idempotent (delete old rows → insert new).

**Impact**: Feature 6 schema completely redesigned. Queries slightly more complex but architecturally correct.

#### C2: Must bump CURRENT_ANALYTICS_VERSION for backfill (GPT-5.4)
**Problem**: The indexer uses `CURRENT_ANALYTICS_VERSION` (`index_db.rs:25,638`) to decide whether to reindex a session. Without bumping this, existing sessions won't get the new columns/tables populated.

**Resolution**: Increment `CURRENT_ANALYTICS_VERSION` when deploying Phase 2/3 changes. This triggers a full reindex on first launch, populating all new tables. Document this as a one-time migration cost.

#### C3: Co-occurrence key normalization (GPT-5.4)
**Problem**: Undirected pairs like `(grep, view)` vs `(view, grep)` must normalize to canonical order or counts split across two PKs.

**Resolution**: Always store with `tool_a < tool_b` (alphabetical). During computation: `let (a, b) = if tool1 < tool2 { (tool1, tool2) } else { (tool2, tool1) };`. Also, deduplicate repeated tools in a single turn — count unique pairs only.

### 🟡 IMPORTANT Issues (10) — ALL RESOLVED

#### I1: Tauri command signatures use wrong pattern (GPT-5.4)
**Problem**: Plan shows `state: tauri::State<'_, AppState>` but codebase uses `tauri::State<'_, SharedConfig>` + `read_config(&state)` + `tokio::task::spawn_blocking(...)`.

**Resolution**: All new commands must follow existing pattern:
```rust
#[tauri::command]
pub async fn get_model_comparison(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
) -> Result<ModelComparisonData, String> {
    let config = read_config(&state);
    tokio::task::spawn_blocking(move || { ... }).await.unwrap()
}
```
All Rust structs must use `#[serde(rename_all = "camelCase")]`.

#### I2: Missing database indexes for date-filtered queries (GPT-5.4)
**Resolution**: Add indexes during schema migration:
```sql
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_repo_created_at ON sessions(repository, created_at);
```

#### I3: Weighted-average SQL bug (GPT-5.4)
**Problem**: `AVG(total_duration_ms / call_count)` computes average-of-averages, not true weighted average.
**Resolution**: Use `SUM(total_duration_ms) * 1.0 / NULLIF(SUM(call_count), 0)` for all latency/duration aggregates.

#### I4: New per-session tables need DELETE in upsert_session (GPT-5.4)
**Resolution**: In `upsert_session()`, add cleanup for all new per-session tables before insert:
```rust
DELETE FROM session_mcp_calls WHERE session_id = ?;
DELETE FROM session_agent_calls WHERE session_id = ?;
DELETE FROM session_tool_cooccurrence WHERE session_id = ?;
DELETE FROM session_tool_chains WHERE session_id = ?;
```

#### I5: Frontend store additions incomplete (GPT-5.4)
**Resolution**: Each new analytics dataset must have: ref, loadingRef, errorRef, generation counter, cache key inclusion, `refreshAll()` coverage, `$reset()` coverage, `hideEmptySessions` watch invalidation. Consider dedicated stores per page (Models, MCP, Agents) instead of bloating `analytics.ts`.

#### I6: New client functions need mock data paths (GPT-5.4)
**Resolution**: Each new function in `packages/client/src/index.ts` must also have a `getMockData()` entry returning sample data for non-Tauri/dev environments.

#### I7: Type nullability — Rust Option<T> serializes as null (GPT-5.4)
**Resolution**: TS interfaces must use `field: number | null` (not `field?: number`) for Rust `Option<T>` fields. Specifically: `CompactionEvent.checkpointNumber`, `CompactionEvent.summaryContent`, `CompactionEvent.durationMs`, `AgentTypeSummary.totalCost`.

#### I8: Sidebar crowding with 3 new items (Gemini)
**Resolution**: Group "Models", "MCP Servers", and "Agents" under a collapsible **"Intelligence"** section in the sidebar, or make them sub-routes of a single `/intelligence` page with tabs. This keeps the sidebar at a manageable size.

#### I9: Todo dependency graph needs cycle handling (Codex)
**Resolution**: Kahn's algorithm naturally detects cycles (remaining nodes with in-degree > 0 after BFS). Display cyclic nodes in a separate "Circular Dependencies" warning section. Don't crash — degrade gracefully.

#### I10: Checkpoint Navigator — choose one approach (Codex)
**Resolution**: Confirmed: use the new `get_session_compactions` command approach (not parser enrichment). This is the cleaner, backward-compatible choice.

### 🟢 SUGGESTIONS (Incorporated)

| # | Suggestion | Source | Action |
|---|-----------|--------|--------|
| S1 | Use Canvas for force-directed graphs with >80 nodes | Codex | Add threshold check — SVG for small graphs, Canvas for large |
| S2 | Add text table alternatives for all SVG charts (accessibility) | Codex | Include `<DataTable>` fallback for every visualization |
| S3 | Add pattern/shape encodings, not just color | Codex | Use dashed/dotted strokes + shape markers alongside color |
| S4 | Add ARIA labels for SVG regions | Codex | Apply `role="img"` + `aria-label` to all chart SVG roots |
| S5 | Handle edge cases: 0 checkpoints, 1 model, 0 deps | Codex | Each component gets explicit `<EmptyState>` for no-data |
| S6 | Add top-N limits for tool ecosystem queries | GPT-5.4 | Limit to top 50 tools, top 100 chains in queries |
| S7 | Clarify "model success rate" semantics | GPT-5.4 | Label as "Tool Call Success Rate (by model)" not "Model Success Rate" |
| S8 | Consider dedicated stores per analytics page | GPT-5.4/Gemini | Create `useModelComparisonStore`, `useMcpAnalyticsStore`, `useAgentEffectivenessStore` |
| S9 | Token Flow: specify how "System Context" vs "Tool Results" are derived | Codex | Use turns data: sum `user_message` lengths for User Input, sum `result_content` lengths for Tool Results; remainder is System Context |
| S10 | Agent score formula needs specification | Codex | Score = `successRate * 0.4 + (1 - normalizedDuration) * 0.3 + (1 - normalizedCost) * 0.3`, normalized relative to max across agent types |

---

## Appendix: Complete Route Map (After Implementation)

### Session Detail Tabs (children of `/session/:id`)
| Tab | Route Name | Status |
|-----|-----------|--------|
| Overview | session-overview | Existing |
| Conversation | session-conversation | Existing |
| Events | session-events | Existing |
| Todos | session-todos | Existing (+ graph toggle) |
| Metrics | session-metrics | Existing |
| Timeline | session-timeline | Existing |
| **Token Flow** | **session-token-flow** | **NEW** |
| **Checkpoints** | **session-checkpoints** | **NEW** |

### Top-Level Pages
| Page | Route | Sidebar Section | Status |
|------|-------|----------------|--------|
| Sessions | / | Primary | Existing |
| Analytics | /analytics | Primary | Existing |
| Health | /health | Primary | Existing |
| Tools | /tools | Primary | Existing |
| Code | /code | Primary | Existing |
| Compare | /compare | Advanced | Existing (rewritten) |
| Replay | /replay/:id? | Advanced | Existing |
| Export | /export | Advanced | Existing |
| Settings | /settings | Advanced | Existing |
| **Models** | **/models** | **Advanced** | **NEW** |
| **MCP Servers** | **/mcp** | **Advanced** | **NEW** |
| **Agents** | **/agents** | **Advanced** | **NEW** |
| **Tool Ecosystem** | **/tool-ecosystem** | **Via Tools page** | **NEW** |
