# Analytics Persistence & Incremental Computation Research

**Date**: 2026-03-15  
**Status**: Research complete, implementation pending

## Problem

Analytics are recomputed from scratch on every page load — all `workspace.yaml` (and sometimes `events.jsonl`) files are re-read from disk. This is slow and wasteful, especially as session count grows.

## Current Architecture

### Computation Flow
1. `get_analytics` → `load_session_summaries_filtered()` → `compute_analytics()` — reads all `workspace.yaml`
2. `get_tool_analysis` → `load_full_sessions_filtered()` → `compute_tool_analysis()` — reads all `events.jsonl` + reconstructs turns (**most expensive**)
3. `get_code_impact` → `load_session_summaries_filtered()` → `compute_code_impact()` — reads all `workspace.yaml`

### Frontend Caching
The Pinia store caches results in-memory per app session (keyed by date range). Lost on restart.

### Existing Invalidation Infrastructure
- `IndexDb.needs_reindex(session_id, session_path)` compares `workspace.yaml` filesystem mtime against stored `workspace_mtime`
- `reindex_incremental()` only re-parses sessions with changed mtimes

## Recommended Approach

### Phase 1: Per-Session Analytics Columns (Migration 3)

Add columns to the `sessions` table computed during `upsert_session`:

```sql
ALTER TABLE sessions ADD COLUMN total_tokens INTEGER;
ALTER TABLE sessions ADD COLUMN total_cost REAL;
ALTER TABLE sessions ADD COLUMN tool_call_count INTEGER;
ALTER TABLE sessions ADD COLUMN lines_added INTEGER;
ALTER TABLE sessions ADD COLUMN lines_removed INTEGER;
ALTER TABLE sessions ADD COLUMN duration_ms INTEGER;
ALTER TABLE sessions ADD COLUMN model_metrics_json TEXT;  -- per-model breakdown as JSON
ALTER TABLE sessions ADD COLUMN analytics_version INTEGER DEFAULT 1;
```

**Benefits:**
- Computed once per session during indexing
- SQL aggregation is instant (`SELECT SUM(total_tokens) FROM sessions WHERE repository = ?`)
- Invalidation is automatic — re-computed when `workspace_mtime` changes
- Enables repository filtering via `WHERE repository = ?`

### Phase 2: Tool Analysis Caching

Tool analysis requires parsing `events.jsonl`, which is expensive. Options:

**Option A: Per-session tool stats table**
```sql
CREATE TABLE session_tool_calls (
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    call_count INTEGER,
    success_count INTEGER,
    total_duration_ms INTEGER,
    PRIMARY KEY (session_id, tool_name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

**Option B: JSON blob on sessions table**
```sql
ALTER TABLE sessions ADD COLUMN tool_stats_json TEXT;
```

Option A is better for SQL aggregation. Option B is simpler but requires JSON parsing.

### Phase 3: Aggregated Result Cache (Optional)

```sql
CREATE TABLE analytics_cache (
    cache_key TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    session_count INTEGER,
    input_hash TEXT  -- hash of relevant session IDs + mtimes
);
```

This is optional if SQL aggregation from per-session data is fast enough.

### Invalidation Strategy

1. During `upsert_session`, re-compute per-session analytics alongside metadata
2. The `workspace_mtime` check already handles "has this session changed?"
3. For aggregated caches: compare `max(indexed_at)` against `computed_at`
4. On schema changes: bump `analytics_version` to force recomputation

## Repository Filtering

Currently, analytics commands only accept `from_date`/`to_date`. Adding `repo: Option<String>` is straightforward:

1. Add parameter to Tauri commands
2. With persistence: `WHERE repository = ? AND updated_at BETWEEN ? AND ?`
3. Without persistence: filter in `load_session_summaries_filtered()`
4. Frontend: add repository dropdown to analytics views

## Complexity Estimate

| Task | Effort | Impact |
|------|--------|--------|
| Migration 3 (per-session columns) | Medium | High — eliminates disk I/O for basic analytics |
| Update `upsert_session` to compute metrics | Medium | Required for persistence |
| SQL-based aggregation queries | Medium | Replaces `compute_analytics()` disk scan |
| Tool analysis caching | High | Eliminates `events.jsonl` re-parsing |
| Repository filter parameter | Low | Quick win with persistence |
| Frontend repo dropdown | Low | Simple UI addition |
| Cache invalidation | Low | Already have `workspace_mtime` infrastructure |

## Decision

Recommend implementing Phase 1 (per-session columns) + repository filtering as immediate next steps. Phase 2 (tool analysis caching) can follow. Phase 3 (aggregated cache) is likely unnecessary if SQL aggregation is performant.
