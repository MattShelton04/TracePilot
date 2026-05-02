# TracePilot Optimization Plan — Incremental Loading & Performance

**Date**: 2026-03-15  
**Status**: ✅ Core implementation complete

---

## Implementation Status

The following changes have been implemented and merged. See [`docs/architecture/incremental-analytics.md`](../architecture/incremental-analytics.md) for the resulting architecture.

| # | Change | Status |
|---|--------|--------|
| 1 | Migration 3 — analytics columns + child tables | ✅ Done — 10 columns on `sessions`, 4 child tables (`session_model_metrics`, `session_tool_calls`, `session_modified_files`, `session_activity`), 3 indexes |
| 2 | `session_tool_calls` table | ✅ Done (part of Migration 3) |
| 3 | Compute analytics during indexing | ✅ Done — `upsert_session` with SAVEPOINT, per-session metrics |
| 4 | SQL-based analytics aggregation | ✅ Done — `query_analytics()`, `query_tool_analysis()`, `query_code_impact()` |
| 5 | Eliminate triple `events.jsonl` parsing | ✅ Done — `SessionLoadResult` struct, single parse per session |
| 6 | Detect resumed sessions via dual-mtime + events_size + analytics_version | ✅ Done — `needs_reindex()` checks workspace_mtime, events_mtime, events_size, analytics_version |
| 7 | Transaction batching for bulk operations | ✅ Done — `reindex_all` wraps in transaction, batch prune with `IN` clause |
| 8 | WAL mode on SQLite | ✅ Done — `PRAGMA journal_mode=WAL; synchronous=NORMAL; foreign_keys=ON; busy_timeout=5000` |
| 9 | Reduce `serde_json::Value` cloning | ✅ Done — take by ownership, clone only on fallback path |
| 10 | Fix O(n²) model dedup in `turn_stats` | ✅ Done — `HashSet` instead of linear `contains` check |
| 11 | Batch pruning with SQL `IN` clause | ✅ Done (part of Change 7) |
| 12 | Wire Tauri analytics commands to SQL | ✅ Done — SQL fast path with disk-scan fallback |
| 13 | Session path cache (`search_sessions` uses `get_session_path()`) | ✅ Done — reads path from index DB instead of `resolve_session_path` |
| 14 | Heatmap data persistence (`session_activity`) | ✅ Done (part of Migration 3) |
| 15 | Deduplicate `formatDuration` | ✅ Done — shared import from `@tracepilot/ui` across 6 Vue components |
| 16 | `get_analytics` summary-only loading | ✅ Done — uses summary-only loading instead of full sessions with turns |
| 17 | Incremental reindex with pruning | ✅ Done — `reindex_incremental()` includes prune step |
| 18 | Frontend analytics store repo dedup | ✅ Done — sourced from sessions store computed instead of redundant `listSessions` call |

**Additional work completed:**
- 15 new comprehensive tests covering analytics queries, date filtering, cascade deletes, resumed session detection, and duration stats

---

## Executive Summary

This document identifies 18 optimization opportunities across the Rust backend and TypeScript frontend, prioritized by impact. The **primary goal** is replacing the current "scan-everything-from-disk" analytics pipeline with an **incremental, persistence-backed** approach that computes per-session metrics during indexing and aggregates via SQL. Secondary goals include eliminating redundant file I/O, reducing memory allocations, and improving frontend data flow.

---

## Problem Statement

### Current Pain Points
1. **Analytics recompute from scratch on every page load** — all `workspace.yaml` and `events.jsonl` files are re-read from disk
2. **`events.jsonl` is parsed 2–3 times per session** during indexing (once for count, once for summary, once for FTS)
3. **No parallelism** — session processing is fully sequential
4. **Resumed sessions aren't detected** — only `workspace.yaml` mtime is checked; `events.jsonl` changes (from session resumption) are missed
5. **Frontend makes redundant backend calls** — `get_analytics` and `get_tool_analysis` both load all sessions independently
6. **No Tauri managed state** — every frontend request triggers fresh disk I/O

### Impact
With 100+ sessions, the analytics dashboard takes several seconds to load. With 500+ sessions, it becomes unusably slow. Tool analysis (which reconstructs all turns) is the worst offender.

---

## Architecture: Incremental Analytics Pipeline

### Before (Current)
```
Frontend request → discover_sessions() → read ALL workspace.yaml from disk
                                        → read ALL events.jsonl from disk
                                        → reconstruct ALL turns
                                        → compute_analytics() in memory
                                        → return JSON
```

### After (Proposed)
```
Background reindex (incremental):
  discover_sessions() → for each changed session:
    → parse workspace.yaml + events.jsonl ONCE
    → compute per-session metrics
    → upsert into SQLite (sessions table + session_tool_calls table)

Frontend request → SQL aggregation query on index.db
                 → return JSON (instant, no disk I/O)
```

---

## Changes

### Change 1: Migration 3 — Per-Session Analytics Columns

**Files**: `crates/tracepilot-indexer/src/index_db.rs`

Add columns to the `sessions` table computed during `upsert_session`:

```sql
ALTER TABLE sessions ADD COLUMN total_tokens INTEGER;
ALTER TABLE sessions ADD COLUMN total_cost REAL;
ALTER TABLE sessions ADD COLUMN tool_call_count INTEGER;
ALTER TABLE sessions ADD COLUMN lines_added INTEGER;
ALTER TABLE sessions ADD COLUMN lines_removed INTEGER;
ALTER TABLE sessions ADD COLUMN duration_ms INTEGER;
ALTER TABLE sessions ADD COLUMN model_metrics_json TEXT;
ALTER TABLE sessions ADD COLUMN events_mtime TEXT;
ALTER TABLE sessions ADD COLUMN analytics_version INTEGER DEFAULT 1;
```

The `events_mtime` column is critical for detecting resumed sessions (Change 6).

### Change 2: `session_tool_calls` Table

**Files**: `crates/tracepilot-indexer/src/index_db.rs`

Create a normalized table for per-session tool call statistics:

```sql
CREATE TABLE IF NOT EXISTS session_tool_calls (
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    call_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, tool_name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

This enables SQL-based tool analysis aggregation without re-parsing `events.jsonl`.

### Change 3: Compute Analytics During Indexing

**Files**: `crates/tracepilot-indexer/src/index_db.rs`

During `upsert_session`, after loading the session summary:
1. Extract token/cost totals from `ShutdownMetrics.model_metrics`
2. Compute `duration_ms` from `session_start_time` → `updated_at`
3. Count lines added/removed from `code_changes`
4. Serialize `model_metrics` as JSON for the `model_metrics_json` column
5. If events exist, parse them ONCE and:
   - Extract tool call stats → upsert into `session_tool_calls`
   - Extract conversation content → upsert into `conversation_fts`
   - Derive `event_count` from the parsed events length (eliminating `count_events`)

### Change 4: SQL-Based Analytics Aggregation

**Files**: `crates/tracepilot-core/src/analytics/aggregator.rs`, `crates/tracepilot-indexer/src/index_db.rs`

Add new query methods to `IndexDb`:

```rust
/// Aggregate analytics from pre-computed per-session data.
pub fn query_analytics(&self, from_date: Option<&str>, to_date: Option<&str>, repo: Option<&str>) -> Result<AnalyticsData>

/// Aggregate tool analysis from session_tool_calls table.
pub fn query_tool_analysis(&self, from_date: Option<&str>, to_date: Option<&str>, repo: Option<&str>) -> Result<ToolAnalysisData>

/// Aggregate code impact from pre-computed per-session data.
pub fn query_code_impact(&self, from_date: Option<&str>, to_date: Option<&str>, repo: Option<&str>) -> Result<CodeImpactData>
```

These replace the disk-scanning `compute_*` functions. Key SQL patterns:

```sql
-- Total tokens/cost/sessions by day
SELECT 
    date(updated_at) as day,
    COUNT(*) as session_count,
    SUM(total_tokens) as tokens,
    SUM(total_cost) as cost
FROM sessions
WHERE updated_at BETWEEN ?1 AND ?2
  AND (?3 IS NULL OR repository = ?3)
GROUP BY date(updated_at)
ORDER BY day;

-- Tool analysis aggregation
SELECT 
    tool_name,
    SUM(call_count) as total_calls,
    SUM(success_count) as total_success,
    SUM(failure_count) as total_failure,
    SUM(total_duration_ms) as total_duration
FROM session_tool_calls stc
JOIN sessions s ON stc.session_id = s.id
WHERE s.updated_at BETWEEN ?1 AND ?2
  AND (?3 IS NULL OR s.repository = ?3)
GROUP BY tool_name
ORDER BY total_calls DESC;
```

### Change 5: Eliminate Double/Triple `events.jsonl` Parsing

**Files**: `crates/tracepilot-core/src/summary/mod.rs`, `crates/tracepilot-indexer/src/index_db.rs`

**Problem**: During indexing, `events.jsonl` is parsed up to 3 times:
1. `count_events()` — reads file to count lines (summary/mod.rs:59)
2. `parse_typed_events()` — full JSON parse (summary/mod.rs:64)
3. `index_conversation_content()` → `parse_typed_events()` — parses again for FTS (index_db.rs:288-297)

**Fix**:
- Remove the `count_events()` call; derive count from `typed_events.len()`
- Make `load_session_summary` return parsed events alongside the summary (new `SessionLoadResult` struct)
- Pass the already-parsed events to `index_conversation_content()` instead of re-reading from disk
- Pass them to the tool call extraction logic as well

```rust
/// Result of loading a session — includes parsed events for reuse.
pub struct SessionLoadResult {
    pub summary: SessionSummary,
    pub typed_events: Option<Vec<TypedEvent>>,
}
```

### Change 6: Detect Resumed Sessions via `events_mtime`

**Files**: `crates/tracepilot-indexer/src/index_db.rs`, `crates/tracepilot-indexer/src/lib.rs`

**Problem**: `needs_reindex` only checks `workspace.yaml` mtime. A resumed session appends to `events.jsonl` without necessarily updating `workspace.yaml` immediately, causing stale analytics.

**Fix**: 
1. Track `events_mtime` alongside `workspace_mtime` in the sessions table
2. Update `needs_reindex` to check both:
   ```rust
   pub fn needs_reindex(&self, session_id: &str, session_path: &Path) -> bool {
       let current_ws_mtime = get_workspace_mtime(session_path);
       let current_ev_mtime = get_events_mtime(session_path);
       let (stored_ws, stored_ev) = self.get_stored_mtimes(session_id);
       stored_ws.as_deref() != current_ws_mtime.as_deref()
           || stored_ev.as_deref() != current_ev_mtime.as_deref()
   }
   ```
3. When a session is re-indexed, its `session_tool_calls` are automatically replaced (DELETE + INSERT in a transaction)
4. Add `prune_deleted` to `reindex_incremental` so stale entries are cleaned up during incremental reindex too

### Change 7: Transaction Batching for Bulk Operations

**Files**: `crates/tracepilot-indexer/src/lib.rs`, `crates/tracepilot-indexer/src/index_db.rs`

**Problem**: Each `upsert_session()` runs as individual auto-committed statements. Bulk reindexing of 500 sessions means 500+ individual transactions.

**Fix**: Wrap the entire reindex loop in a single transaction:

```rust
pub fn reindex_all(session_state_dir: &Path, index_db_path: &Path) -> Result<usize> {
    let sessions = discover_sessions(session_state_dir)?;
    let db = IndexDb::open_or_create(index_db_path)?;
    
    db.begin_transaction()?;
    // ... upsert loop ...
    db.commit_transaction()?;
    
    Ok(indexed)
}
```

This provides 10-50× speedup for bulk SQLite writes.

### Change 8: Enable WAL Mode on SQLite

**Files**: `crates/tracepilot-indexer/src/index_db.rs`

Add to `open_or_create`:
```rust
conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
```

WAL mode allows concurrent readers during writes and improves crash recovery.

### Change 9: Reduce `serde_json::Value` Cloning in Event Parsing

**Files**: `crates/tracepilot-core/src/parsing/events.rs`

**Problem**: `typed_data_from_raw()` clones `data: &Value` for every event (up to 2× per event on failure). `TypedEvent` stores both `raw: RawEvent` (containing `data: Value`) AND `typed_data: TypedEventData` — doubling memory.

**Fix**: 
- Change `typed_data_from_raw` to take `data: Value` by value (consuming ownership)
- On success: the original `Value` is consumed by `serde_json::from_value(data)`
- On failure: the cloned fallback is only needed once
- Remove `raw.data` from `TypedEvent` since the typed variant holds the same information
- This halves memory usage for parsed events

```rust
fn typed_data_from_raw(event_type: &SessionEventType, data: Value) -> TypedEventData {
    match event_type {
        SessionEventType::SessionStart => serde_json::from_value(data)
            .map(TypedEventData::SessionStart)
            .unwrap_or_else(|e| TypedEventData::Other(e.into_value())),
        // ... etc
    }
}
```

Note: `serde_json::Error` does not currently expose `into_value()`. We'll need to restructure to clone only on the fallback path — clone data before the `from_value` call and use the clone only if deserialization fails.

### Change 10: Fix O(n²) Model Dedup in `turn_stats`

**Files**: `crates/tracepilot-core/src/turns/mod.rs`

**Problem**: Uses linear scan for dedup:
```rust
if !models_used.iter().any(|existing| existing == model) {
    models_used.push(model.clone());
}
```

**Fix**: Use a `HashSet` for dedup, then convert to `Vec`:
```rust
let mut models_set = HashSet::new();
// ... in loop:
models_set.insert(model.clone());
// ... after loop:
let models_used: Vec<String> = models_set.into_iter().collect();
```

### Change 11: Batch Pruning with SQL `IN` Clause

**Files**: `crates/tracepilot-indexer/src/index_db.rs`

**Problem**: `prune_deleted()` issues individual `DELETE` per stale session.

**Fix**: Use a single batch delete:
```rust
let placeholders: String = stale.iter().map(|_| "?").collect::<Vec<_>>().join(",");
let sql = format!("DELETE FROM sessions WHERE id IN ({})", placeholders);
conn.execute(&sql, params_from_iter(stale.iter()))?;
```

### Change 12: Wire Analytics Commands to SQL Aggregation

**Files**: `crates/tracepilot-tauri-bindings/src/lib.rs`

Replace disk-scanning calls with indexed queries:

```rust
// Before:
let inputs = load_full_sessions_filtered(&sessions_dir, from_date, to_date, repo);
Ok(compute_analytics(&inputs))

// After:
let db = IndexDb::open_or_create(&index_db_path)?;
Ok(db.query_analytics(from_date, to_date, repo)?)
```

All three analytics commands (`get_analytics`, `get_tool_analysis`, `get_code_impact`) are updated to query the index database instead of scanning disk.

### Change 13: Session Path Cache in Tauri Managed State

**Files**: `crates/tracepilot-tauri-bindings/src/lib.rs`

**Problem**: Every per-session command calls `resolve_session_path()` which calls `discover_sessions()` — a full directory scan. Viewing a session detail page triggers 5+ separate scans.

**Fix**: Add a Tauri managed state cache mapping session IDs to paths:
```rust
struct SessionPathCache {
    paths: Mutex<HashMap<String, PathBuf>>,
    last_refresh: Mutex<Instant>,
}
```

Populate on first use and after reindex. Invalidate after 60s or on explicit refresh.

### Change 14: Heatmap Data Persistence

**Files**: `crates/tracepilot-indexer/src/index_db.rs`

Store per-session heatmap contributions (day-of-week × hour buckets from tool call timestamps) during indexing, enabling SQL aggregation for the activity heatmap without re-parsing events.

Add a lightweight table:
```sql
CREATE TABLE IF NOT EXISTS session_activity (
    session_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,  -- 0=Mon, 6=Sun
    hour INTEGER NOT NULL,         -- 0-23
    tool_call_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, day_of_week, hour),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

### Change 15: Deduplicate `formatDuration` Functions

**Files**: Multiple frontend files

**Problem**: 7+ files define local `fmtDuration`/`formatDuration` helpers.

**Fix**: Import the canonical `formatDuration` from `@tracepilot/ui` everywhere:
```ts
import { formatDuration } from '@tracepilot/ui';
```

### Change 16: `get_analytics` Should Use Summary-Only Loading (Fallback)

**Files**: `crates/tracepilot-tauri-bindings/src/lib.rs`

**Problem**: `get_analytics` calls `load_full_sessions_filtered` (which reconstructs turns for ALL sessions) but `compute_analytics` only uses turns for a minor tool-call count metric.

**Fix**: With persistence (Change 4), this is moot — SQL handles it. But as a fallback/safety measure, ensure the disk-scanning path uses `load_session_summaries_filtered` instead.

### Change 17: Add `reindex_incremental` Pruning

**Files**: `crates/tracepilot-indexer/src/lib.rs`

**Problem**: `reindex_incremental` doesn't call `prune_deleted()`, so sessions deleted from disk aren't cleaned from the index until a full reindex.

**Fix**: Add pruning after the incremental loop:
```rust
pub fn reindex_incremental(...) -> Result<(usize, usize)> {
    // ... existing incremental logic ...
    
    let live_ids: HashSet<String> = sessions.iter().map(|s| s.id.clone()).collect();
    db.prune_deleted(&live_ids)?;
    
    Ok((indexed, skipped))
}
```

### Change 18: Frontend — Prevent Redundant `availableRepos` Fetch

**Files**: `apps/desktop/src/stores/analytics.ts`

**Problem**: `fetchAvailableRepos()` calls `listSessions()` to extract unique repos, duplicating data already in the sessions store.

**Fix**: Source repos from the sessions store instead:
```ts
const sessionsStore = useSessionsStore();
const availableRepos = computed(() => sessionsStore.repositories);
```

---

## Resumed Session Detection — Detailed Design

### The Problem
Copilot CLI sessions can be resumed at any time. When resumed:
1. New events are appended to `events.jsonl` (mtime changes)
2. `workspace.yaml` may or may not be updated (summary_count, updated_at may change)

Currently, only `workspace.yaml` mtime is checked, so resumed sessions with only `events.jsonl` changes are missed.

### The Solution

**Dual-mtime tracking**:
```
needs_reindex = (workspace_mtime changed) OR (events_mtime changed)
```

**On reindex of a changed session**:
1. Parse workspace.yaml + events.jsonl ONCE → produce `SessionLoadResult`
2. Compute all per-session metrics (tokens, cost, health, duration, tool calls)
3. In a single transaction:
   a. `DELETE FROM session_tool_calls WHERE session_id = ?` 
   b. `DELETE FROM session_activity WHERE session_id = ?`
   c. `DELETE FROM conversation_fts WHERE session_id = ?`
   d. `INSERT ... ON CONFLICT(id) DO UPDATE` into sessions (with new analytics columns)
   e. Batch `INSERT` into `session_tool_calls`
   f. Batch `INSERT` into `session_activity`
   g. `INSERT` into `conversation_fts`

This ensures atomicity — a resumed session's old data is fully replaced with fresh data in one transaction.

### Edge Cases
- **Session with no events.jsonl**: Only workspace.yaml metrics are used; `events_mtime` is NULL
- **Session with events but no shutdown**: Partial metrics computed from what's available (turn count, tool calls); token/cost totals may be 0
- **Concurrent access**: WAL mode (Change 8) allows readers during the write transaction
- **Schema migration**: `analytics_version` column allows forcing re-computation when the metrics formula changes

---

## Implementation Order

1. **Change 8**: WAL mode (trivial, instant benefit)
2. **Change 5**: Eliminate triple parsing (refactor `SessionLoadResult`)
3. **Change 9**: Reduce Value cloning in event parsing
4. **Change 10**: Fix O(n²) model dedup
5. **Change 1 + 2**: Migration 3 (new columns + tool_calls table)
6. **Change 6**: Dual mtime tracking (events_mtime)
7. **Change 3**: Compute analytics during indexing
8. **Change 14**: Heatmap persistence
9. **Change 7**: Transaction batching
10. **Change 11**: Batch pruning
11. **Change 17**: Incremental pruning
12. **Change 4**: SQL-based aggregation queries
13. **Change 12**: Wire Tauri commands to SQL
14. **Change 13**: Session path cache
15. **Change 16**: Fallback loading fix
16. **Change 15**: Deduplicate formatDuration
17. **Change 18**: Frontend repo dedup
18. **Tests + Documentation updates**

---

## Expected Performance Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Analytics dashboard load (100 sessions) | ~2-3s (disk scan) | ~10-50ms (SQL) | **50-100×** |
| Tool analysis load (100 sessions) | ~5-8s (full parse + turns) | ~10-50ms (SQL) | **100-500×** |
| Code impact load (100 sessions) | ~1-2s (disk scan) | ~10-50ms (SQL) | **20-100×** |
| Incremental reindex (1 changed session) | ~100-200ms per session | ~80-150ms per session | ~1.3× (marginally faster, no triple parse) |
| Full reindex (100 sessions) | ~15-20s (sequential, no txn) | ~3-5s (txn batched) | **3-5×** |
| Memory per parsed event | ~2× (raw + typed) | ~1× (typed only) | **2×** |
| Resumed session detection | ❌ Missed | ✅ Detected | **Bug fix** |

---

## Files Modified

### Rust
- `crates/tracepilot-core/src/summary/mod.rs` — `SessionLoadResult`, remove `count_events`
- `crates/tracepilot-core/src/parsing/events.rs` — ownership-based typing, reduced cloning
- `crates/tracepilot-core/src/turns/mod.rs` — HashSet model dedup
- `crates/tracepilot-core/src/analytics/aggregator.rs` — keep as fallback, add note
- `crates/tracepilot-core/src/analytics/types.rs` — any new types needed for SQL responses
- `crates/tracepilot-indexer/src/index_db.rs` — Migration 3, analytics computation, SQL queries, WAL, batch ops
- `crates/tracepilot-indexer/src/lib.rs` — transaction wrapping, incremental pruning
- `crates/tracepilot-tauri-bindings/src/lib.rs` — session path cache, SQL-based analytics

### Frontend
- `apps/desktop/src/stores/analytics.ts` — repo dedup
- Multiple views — formatDuration dedup

### Documentation
- `docs/research/optimization-plan.md` (this file)
- `docs/architecture/` — updated architecture docs for new analytics pipeline
