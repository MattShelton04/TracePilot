# Data Integration Guide

> How to wire stub pages to real backend data in TracePilot.

---

## 1. Architecture Overview

TracePilot follows a layered data architecture:

```
┌─────────────────────────────────────────────────────┐
│  Vue Views / Components                             │
│  (apps/desktop/src/views/*.vue)                     │
├─────────────────────────────────────────────────────┤
│  Pinia Stores                                       │
│  (apps/desktop/src/stores/*.ts)                     │
├─────────────────────────────────────────────────────┤
│  Client Package (@tracepilot/client)                │
│  (packages/client/src/index.ts)                     │
│  ┌───────────────────┬─────────────────────────┐    │
│  │  isTauri() = true │  isTauri() = false      │    │
│  │  → Tauri IPC      │  → Mock data fallback   │    │
│  └───────────────────┴─────────────────────────┘    │
├─────────────────────────────────────────────────────┤
│  Tauri Plugin (tracepilot-tauri-bindings)            │
│  (crates/tracepilot-tauri-bindings/src/lib.rs)      │
├─────────────────────────────────────────────────────┤
│  Rust Core / Indexer / Export                        │
│  (crates/tracepilot-core, tracepilot-indexer, etc.) │
└─────────────────────────────────────────────────────┘
```

### Key Packages

| Package | Path | Role |
|---------|------|------|
| `@tracepilot/client` | `packages/client/src/index.ts` | Data access layer — all IPC calls to Tauri + mock fallback |
| `@tracepilot/types` | `packages/types/src/index.ts` | Shared TypeScript interfaces for all data shapes |
| Pinia Stores | `apps/desktop/src/stores/` | Reactive state management consumed by Vue views |
| Tauri Bindings | `crates/tracepilot-tauri-bindings/` | Rust `#[tauri::command]` handlers registered as a Tauri plugin |

### The `isTauri()` Pattern

The client package uses a runtime check to decide between real IPC and mock data:

```typescript
// packages/client/src/index.ts
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
  }
  return getMockData<T>(cmd, args); // Dev fallback
}
```

When a page is **fully wired**, calling the client function inside Tauri invokes the real Rust command. When running `vite dev` outside Tauri, it falls back to mock data automatically.

---

## 2. Current Data Flow

### ✅ Real Data (Wired End-to-End)

These client functions have corresponding Rust commands registered in the Tauri plugin:

| Client Function | Tauri Command | Rust Crate | Used By |
|----------------|---------------|------------|---------|
| `listSessions()` | `list_sessions` | `tracepilot-tauri-bindings` | `useSessionsStore` → `SessionListView` |
| `getSessionDetail(id)` | `get_session_detail` | `tracepilot-tauri-bindings` | `useSessionDetailStore` → `SessionDetailView` |
| `getSessionTurns(id)` | `get_session_turns` | `tracepilot-tauri-bindings` | `useSessionDetailStore` → `ConversationTab` |
| `getSessionEvents(id)` | `get_session_events` | `tracepilot-tauri-bindings` | `useSessionDetailStore` → `EventsTab` |
| `getSessionTodos(id)` | `get_session_todos` | `tracepilot-tauri-bindings` | `useSessionDetailStore` → `TodosTab` |
| `getSessionCheckpoints(id)` | `get_session_checkpoints` | `tracepilot-tauri-bindings` | `useSessionDetailStore` → `OverviewTab` |
| `getShutdownMetrics(id)` | `get_shutdown_metrics` | `tracepilot-tauri-bindings` | `useSessionDetailStore` → `MetricsTab` |
| `searchSessions(query)` | `search_sessions` | `tracepilot-indexer` | `useSessionsStore` → `SessionListView` |
| `reindexSessions()` | `reindex_sessions` | `tracepilot-indexer` | `SettingsView` |

### 🔶 Stub Data (Mock Only — No Backend Yet)

These functions bypass `invoke()` entirely and return hardcoded mock data:

| Client Function | Mock Source | TypeScript Interface | Needed By |
|----------------|-------------|---------------------|-----------|
| `getAnalytics()` | `MOCK_ANALYTICS` | `AnalyticsData` | `AnalyticsDashboardView` |
| `getToolAnalysis()` | `MOCK_TOOL_ANALYSIS` | `ToolAnalysisData` | `ToolAnalysisView` |
| `getCodeImpact()` | `MOCK_CODE_IMPACT` | `CodeImpactData` | `CodeImpactView` |
| `getHealthScores()` | `MOCK_HEALTH_SCORING` | `HealthScoringData` | `HealthScoringView` |
| `exportSessions(config)` | `MOCK_EXPORT_RESULT` | `ExportConfig → ExportResult` | `ExportView` |

---

## 3. Per-Page Integration Guide

### 3.1 Analytics Dashboard

**Route:** `/analytics` · **View:** `apps/desktop/src/views/AnalyticsDashboardView.vue`

**What it needs:**
- Aggregate analytics across all sessions: total sessions, total tokens, total cost, average health score
- Time-series data: token usage by day, sessions per day, cost by day
- Model distribution breakdown

**Current state:** Calls `getAnalytics()` from `@tracepilot/client`, which returns `MOCK_ANALYTICS` directly (never hits Tauri).

**How to wire it:**

1. **Create Rust command** in `crates/tracepilot-tauri-bindings/src/lib.rs`:
   ```rust
   #[tauri::command]
   async fn get_analytics(state: State<'_, AppState>) -> Result<AnalyticsData, String> {
       // Aggregate from all sessions:
       // - Sum tokens/cost from shutdown_metrics across sessions
       // - Compute daily rollups from session timestamps
       // - Build model distribution from model_metrics
   }
   ```

2. **Register the command** in the plugin's `invoke_handler`:
   ```rust
   .invoke_handler(tauri::generate_handler![
       // ... existing commands ...
       commands::get_analytics,
   ])
   ```

3. **Define Rust struct** matching `AnalyticsData` from `packages/types/src/index.ts` (lines 153–170).

4. **Update the client** in `packages/client/src/index.ts`:
   ```typescript
   // Replace:
   export async function getAnalytics(): Promise<AnalyticsData> {
     return MOCK_ANALYTICS;
   }
   // With:
   export async function getAnalytics(): Promise<AnalyticsData> {
     return invoke<AnalyticsData>("get_analytics");
   }
   ```

5. **Add mock entry** to `getMockData()` so dev mode still works:
   ```typescript
   const mocks: Record<string, unknown> = {
     // ... existing entries ...
     get_analytics: MOCK_ANALYTICS,
   };
   ```

**STUB markers:** Search `STUB:` in `AnalyticsDashboardView.vue` and `packages/client/src/index.ts` (lines 118–127).

---

### 3.2 Tool Analysis

**Route:** `/tools` · **View:** `apps/desktop/src/views/ToolAnalysisView.vue`

**What it needs:**
- Aggregate tool usage across all sessions: total calls, success rate, avg duration
- Per-tool breakdown (call count, success rate, duration)
- Activity heatmap (hour × day of week)

**Current state:** Calls `getToolAnalysis()` → returns `MOCK_TOOL_ANALYSIS`.

**How to wire it:**

1. **Create Rust command** `get_tool_analysis`:
   - Iterate all sessions, parse tool calls from turns
   - Aggregate per-tool stats (count, success, duration)
   - Build heatmap from tool call timestamps

2. **Register** in `invoke_handler`.

3. **Rust struct** matching `ToolAnalysisData` (types lines 175–188) and `ToolUsageEntry` (lines 191–202).

4. **Update client** — replace direct `MOCK_TOOL_ANALYSIS` return with `invoke<ToolAnalysisData>("get_tool_analysis")` and add `get_tool_analysis: MOCK_TOOL_ANALYSIS` to the `getMockData()` map.

**STUB markers:** `ToolAnalysisView.vue` (2 markers), `packages/client/src/index.ts` (lines 129–138).

---

### 3.3 Code Impact

**Route:** `/code` · **View:** `apps/desktop/src/views/CodeImpactView.vue`

**What it needs:**
- Aggregate file change stats: files modified, lines added/removed, net change
- File type breakdown by extension
- Most-modified files list
- Daily change trends

**Current state:** Calls `getCodeImpact()` → returns `MOCK_CODE_IMPACT`.

**How to wire it:**

1. **Create Rust command** `get_code_impact`:
   - Source: `shutdown_metrics.code_changes` from each session
   - Aggregate lines added/removed, unique files
   - Build file-type breakdown from extensions
   - Build daily rollup from session dates

2. **Register** in `invoke_handler`.

3. **Rust struct** matching `CodeImpactData` (types lines 207–222).

4. **Update client** — replace `MOCK_CODE_IMPACT` return with `invoke<CodeImpactData>("get_code_impact")` and add to `getMockData()`.

**STUB markers:** `CodeImpactView.vue` (3 markers), `packages/client/src/index.ts` (lines 140–149).

---

### 3.4 Session Timeline

**Route:** `/session/:id/timeline` · **View:** `apps/desktop/src/views/SessionTimelineView.vue`

**What it needs:**
- Real event timestamps from `getSessionEvents()`
- Turn timestamps from `getSessionTurns()`
- Tool call durations with `startedAt`/`completedAt` fields

**Current state:** Already partially wired via `useSessionDetailStore`. Uses real turn and event data, but some timeline positioning uses turn indices as a proxy for timestamps.

**How to finish wiring:**

1. **No new Rust command needed** — existing `get_session_turns` and `get_session_events` provide the data.

2. **Ensure real timestamps** are populated:
   - `ConversationTurn.timestamp` and `ConversationTurn.endTimestamp`
   - `TurnToolCall.startedAt` and `TurnToolCall.completedAt`
   - `SessionEvent.timestamp`

3. **Update the view** to use actual timestamps for positioning instead of turn indices.

**STUB markers:** `SessionTimelineView.vue` (2 markers — turn index vs. real timestamp positioning, swimlane rendering).

---

### 3.5 Health Scoring

**Route:** `/health` · **View:** `apps/desktop/src/views/HealthScoringView.vue`

**What it needs:**
- Overall health score across all sessions
- Counts by category (healthy/attention/critical)
- Per-session health details with flags
- Aggregate health flag statistics

**Current state:** Calls `getHealthScores()` → returns `MOCK_HEALTH_SCORING`.

**How to wire it:**

1. **Create Rust command** `get_health_scores`:
   - Implement a scoring engine that evaluates each session
   - Score based on: retry rate, duration, error count, token usage, tool call count
   - Classify into healthy (≥0.8), attention (0.5–0.8), critical (<0.5)
   - Aggregate flag counts

2. **Register** in `invoke_handler`.

3. **Rust struct** matching `HealthScoringData` (types lines 229–252).

4. **Update client** — replace `MOCK_HEALTH_SCORING` return with `invoke<HealthScoringData>("get_health_scores")` and add to `getMockData()`.

**STUB markers:** `HealthScoringView.vue` (3 markers), `packages/client/src/index.ts` (lines 151–160).

---

### 3.6 Export

**Route:** `/export` · **View:** `apps/desktop/src/views/ExportView.vue`

**What it needs:**
- Accept `ExportConfig` (session IDs, format, include flags, destination)
- Return `ExportResult` (success, file path, count)
- Tauri file dialog for choosing destination

**Current state:** Calls `exportSessions(config)` → returns `MOCK_EXPORT_RESULT`. The `tracepilot-export` crate already exists but isn't wired to the Tauri plugin.

**How to wire it:**

1. **Create Rust command** `export_session` in tauri-bindings:
   ```rust
   #[tauri::command]
   async fn export_session(
       config: ExportConfig,
       state: State<'_, AppState>,
   ) -> Result<ExportResult, String> {
       // Delegate to tracepilot_export crate
   }
   ```

2. **Register** in `invoke_handler`.

3. **Rust structs** matching `ExportConfig` (types lines 257–272) and `ExportResult` (lines 275–284).

4. **Update client** — replace `MOCK_EXPORT_RESULT` return:
   ```typescript
   export async function exportSessions(config: ExportConfig): Promise<ExportResult> {
     return invoke<ExportResult>("export_session", { config });
   }
   ```

5. **Add to `getMockData()`** for dev fallback.

6. **Wire file dialog** in `ExportView.vue` using `@tauri-apps/plugin-dialog`:
   ```typescript
   import { save } from "@tauri-apps/plugin-dialog";
   const filePath = await save({ filters: [{ name: "JSON", extensions: ["json"] }] });
   ```

**STUB markers:** `ExportView.vue` (3 markers — mock preview, export API, file dialog), `packages/client/src/index.ts` (lines 162–171).

---

### 3.7 Session Comparison

**Route:** `/compare` · **View:** `apps/desktop/src/views/SessionComparisonView.vue`

**What it needs:**
- Two session details side by side with metrics diff
- Per-model usage comparison
- TypeScript interface: `ComparisonResult` (types lines 288–325)

**Current state:** Uses inline mock data. Does not call any client function.

**How to wire it — Option A (client-side):**

1. Use existing `getSessionDetail()` + `getShutdownMetrics()` for both sessions.
2. Compute diffs in a composable or directly in the view.
3. No new Rust command needed.

**How to wire it — Option B (dedicated command):**

1. **Create Rust command** `compare_sessions(session_a: String, session_b: String)`:
   - Load both sessions, compute metrics diff server-side
   - Return `ComparisonResult`

2. **Add client function:**
   ```typescript
   export async function compareSessions(
     sessionA: string, sessionB: string
   ): Promise<ComparisonResult> {
     return invoke<ComparisonResult>("compare_sessions", { sessionA, sessionB });
   }
   ```

**Recommendation:** Start with Option A (less backend work). Move to Option B if comparison logic becomes complex.

**STUB markers:** `SessionComparisonView.vue` (6 markers).

---

### 3.8 Session Replay

**Route:** `/replay/:id?` · **View:** `apps/desktop/src/views/SessionReplayView.vue`

**What it needs:**
- Turn data with accurate timestamps for real playback timing
- Step-by-step replay with tool calls, file changes, todos
- TypeScript interfaces: `ReplayState` (types lines 330–343), `ReplayStep` (lines 346–371)

**Current state:** Uses turn data from `getSessionTurns()` (already wired), but playback timing is mock. Replay steps are derived from turns inline.

**How to wire it:**

1. **No new Rust command needed** for basic replay — existing turn data suffices.

2. **For accurate timing**, ensure `ConversationTurn.timestamp` and `TurnToolCall.startedAt`/`completedAt` are real ISO timestamps from the event log.

3. **Optional: Create `get_replay_steps(sessionId)`** for pre-processed replay data if client-side derivation becomes too complex.

**STUB markers:** `SessionReplayView.vue` (3 markers — mock turn data, real timing).

---

### 3.9 Settings

**Route:** `/settings` · **View:** `apps/desktop/src/views/SettingsView.vue`

**What it needs:**
- Preference persistence (theme, last viewed session — already in `usePreferencesStore`)
- Tauri APIs: file dialogs, app version, data directory path
- DB stats: session count, index size
- Cache clearing / reindex trigger

**Current state:** Uses `usePreferencesStore` for theme/lastViewedSession (localStorage). Many settings actions are stubbed.

**How to wire it:**

1. **App version** — use `@tauri-apps/api/app`:
   ```typescript
   import { getVersion } from "@tauri-apps/api/app";
   const version = await getVersion();
   ```

2. **Data directory** — use Tauri path API:
   ```typescript
   import { appDataDir } from "@tauri-apps/api/path";
   const dataDir = await appDataDir();
   ```

3. **DB stats** — create a lightweight `get_db_stats` command:
   ```rust
   #[tauri::command]
   async fn get_db_stats(state: State<'_, AppState>) -> Result<DbStats, String> {
       // Return: session count, total events, index size on disk
   }
   ```

4. **Cache clearing** — create `clear_cache` command or reuse `reindex_sessions`.

5. **File dialog** — use `@tauri-apps/plugin-dialog` for selecting data directories.

6. **Preferences persistence** — optionally migrate from `localStorage` to Tauri's `store` plugin for persistence across app resets.

**STUB markers:** `SettingsView.vue` (14 markers — the most of any view).

---

## 4. Finding All Stubs

Run these commands from the project root to locate every stub point:

```bash
# All STUB markers in frontend views and client package
grep -rn "STUB:" apps/desktop/src/ packages/client/src/

# Just the stub client functions (the 5 that need backend commands)
grep -rn "STUB:" packages/client/src/index.ts

# Stubs in a specific view
grep -rn "STUB:" apps/desktop/src/views/AnalyticsDashboardView.vue

# Count stubs per file
grep -rl "STUB:" apps/desktop/src/ packages/client/src/ | xargs -I{} sh -c 'echo "$(grep -c "STUB:" "$1") $1"' _ {}
```

### Stub Summary

| File | STUB Count | Category |
|------|-----------|----------|
| `packages/client/src/index.ts` | 20 | Client functions returning mock data |
| `apps/desktop/src/views/SettingsView.vue` | 19 | Tauri APIs, dialogs, DB stats |
| `apps/desktop/src/views/SessionComparisonView.vue` | 9 | Comparison logic, dedicated API |
| `apps/desktop/src/views/ToolAnalysisView.vue` | 4 | Tool usage aggregation API |
| `apps/desktop/src/views/ExportView.vue` | 4 | Export engine, file dialog |
| `apps/desktop/src/views/AnalyticsDashboardView.vue` | 3 | Aggregate analytics API |
| `apps/desktop/src/views/CodeImpactView.vue` | 3 | File change tracking API |
| `apps/desktop/src/views/HealthScoringView.vue` | 3 | Health scoring engine |
| `apps/desktop/src/views/SessionReplayView.vue` | 3 | Real timing data |
| `apps/desktop/src/views/SessionTimelineView.vue` | 3 | Real timestamp positioning |
| `apps/desktop/src/views/StubView.vue` | 2 | Placeholder stub view |

---

## 5. Adding a New Backend Command

Step-by-step checklist for wiring a new data endpoint:

### Step 1: Define the Rust Struct

In the appropriate crate (usually `tracepilot-core` or `tracepilot-tauri-bindings`), define the response struct with `serde::Serialize`:

```rust
// crates/tracepilot-core/src/analytics.rs (or similar)
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsData {
    pub total_sessions: u32,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub average_health_score: f64,
    pub token_usage_by_day: Vec<DayTokens>,
    // ... etc
}
```

> **Important:** Use `#[serde(rename_all = "camelCase")]` so Rust snake_case fields serialize to the camelCase expected by TypeScript.

### Step 2: Implement the Tauri Command

In `crates/tracepilot-tauri-bindings/src/lib.rs` (or a dedicated `commands.rs`):

```rust
#[tauri::command]
async fn get_analytics(
    state: tauri::State<'_, AppState>,
) -> Result<AnalyticsData, String> {
    let sessions_dir = &state.sessions_dir;
    // ... implementation ...
    Ok(analytics_data)
}
```

### Step 3: Register the Command

Add it to the plugin's `invoke_handler` in `crates/tracepilot-tauri-bindings/src/lib.rs`:

```rust
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("tracepilot")
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::get_session_detail,
            // ... existing commands ...
            commands::get_analytics,  // ← Add here
        ])
        .build()
}
```

### Step 4: Add/Verify TypeScript Types

Ensure the interface in `packages/types/src/index.ts` matches the Rust struct:

```typescript
// packages/types/src/index.ts
export interface AnalyticsData {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  averageHealthScore: number;
  tokenUsageByDay: Array<{ date: string; tokens: number }>;
  // ... etc
}
```

> The types for the 5 stub features already exist in `packages/types/src/index.ts`.

### Step 5: Update the Client Function

In `packages/client/src/index.ts`, replace the mock return with an `invoke()` call:

```typescript
// Before (stub):
export async function getAnalytics(): Promise<AnalyticsData> {
  return MOCK_ANALYTICS;
}

// After (wired):
export async function getAnalytics(): Promise<AnalyticsData> {
  return invoke<AnalyticsData>("get_analytics");
}
```

### Step 6: Add Mock Fallback

Add the mock entry to the `getMockData()` map so `vite dev` still works:

```typescript
function getMockData<T>(cmd: string, args?: Record<string, unknown>): T {
  const mocks: Record<string, unknown> = {
    // ... existing entries ...
    get_analytics: MOCK_ANALYTICS,  // ← Add here
  };
  return (mocks[cmd] ?? null) as T;
}
```

### Step 7: Create or Update a Pinia Store (Optional)

If the feature needs reactive state management, create a dedicated store:

```typescript
// apps/desktop/src/stores/analytics.ts
import { defineStore } from "pinia";
import { ref } from "vue";
import type { AnalyticsData } from "@tracepilot/types";
import { getAnalytics } from "@tracepilot/client";

export const useAnalyticsStore = defineStore("analytics", () => {
  const data = ref<AnalyticsData | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetch() {
    loading.value = true;
    error.value = null;
    try {
      data.value = await getAnalytics();
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, fetch };
});
```

### Step 8: Update the View

Replace the inline mock call in the view with the store or direct client call:

```vue
<script setup lang="ts">
import { onMounted } from "vue";
import { useAnalyticsStore } from "@/stores/analytics";

const store = useAnalyticsStore();
onMounted(() => store.fetch());
</script>
```

### Step 9: Test

1. **Dev mode** (`pnpm dev`): Verify mock data renders correctly
2. **Tauri mode** (`pnpm tauri dev`): Verify real data flows through
3. **Search for leftover stubs**: `grep -rn "STUB:" <your-view-file>`

---

## Quick Reference: Wiring Priority

Recommended order for implementing backends (by user impact and complexity):

| Priority | Feature | Complexity | Notes |
|----------|---------|-----------|-------|
| 1 | **Export** | Medium | `tracepilot-export` crate already exists |
| 2 | **Analytics Dashboard** | Medium | Aggregate from existing session data |
| 3 | **Tool Analysis** | Medium | Parse tool calls from turn data |
| 4 | **Code Impact** | Low | Extract from `shutdown_metrics.code_changes` |
| 5 | **Health Scoring** | High | Needs scoring algorithm design |
| 6 | **Settings** | Low | Mostly Tauri API calls, minimal backend |
| 7 | **Session Comparison** | Low | Can start client-side with existing data |
| 8 | **Session Timeline** | Low | Already wired, needs timestamp accuracy |
| 9 | **Session Replay** | Low | Already wired, needs timestamp accuracy |
