# Incremental Analytics Pipeline

## Overview

Before this work, every analytics request loaded ALL sessions from disk — parsing `workspace.yaml` and `events.jsonl` for every session, reconstructing turns, and computing aggregates in memory. This was O(n) in total session count on every page load.

Now, per-session metrics are computed **once during indexing** and stored in SQLite. Analytics queries aggregate pre-computed data via SQL — instant regardless of session count.

## Schema (Migration 3)

### Sessions table additions

```sql
ALTER TABLE sessions ADD COLUMN total_tokens INTEGER;
ALTER TABLE sessions ADD COLUMN total_cost REAL;
ALTER TABLE sessions ADD COLUMN tool_call_count INTEGER;
ALTER TABLE sessions ADD COLUMN lines_added INTEGER;
ALTER TABLE sessions ADD COLUMN lines_removed INTEGER;
ALTER TABLE sessions ADD COLUMN duration_ms INTEGER;
ALTER TABLE sessions ADD COLUMN events_mtime TEXT;
ALTER TABLE sessions ADD COLUMN events_size INTEGER;
ALTER TABLE sessions ADD COLUMN analytics_version INTEGER DEFAULT 1;
```

### Child tables

**session_model_metrics** — per-model token/cost breakdown:
```sql
CREATE TABLE session_model_metrics (
    session_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0.0,
    request_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, model_name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

**session_tool_calls** — per-tool call statistics:
```sql
CREATE TABLE session_tool_calls (
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

**session_modified_files** — files touched per session:
```sql
CREATE TABLE session_modified_files (
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    extension TEXT,
    PRIMARY KEY (session_id, file_path),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

**session_activity** — heatmap buckets (day × hour):
```sql
CREATE TABLE session_activity (
    session_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,  -- 0=Mon, 6=Sun
    hour INTEGER NOT NULL,         -- 0-23
    tool_call_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, day_of_week, hour),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

### Indexes

```sql
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX idx_sessions_repository ON sessions(repository);
CREATE INDEX idx_sessions_repo_updated ON sessions(repository, updated_at);
```

All child tables use `ON DELETE CASCADE` — deleting a session row automatically cleans up all related data.

## Data Flow

```
1. Discovery     → discover_sessions() finds session dirs on disk
2. Change check  → needs_reindex() compares workspace_mtime, events_mtime+size, analytics_version
3. Indexing      → upsert_session() loads summary+events ONCE, computes analytics, writes all in SAVEPOINT
4. Query         → query_analytics / query_tool_analysis / query_code_impact → SQL aggregation → typed structs
5. Tauri layer   → Commands try SQL fast path, fall back to disk scan if index empty/missing
```

### Indexing detail (step 3)

Within a single `SAVEPOINT`:
1. Parse `workspace.yaml` → session metadata
2. Parse `events.jsonl` → typed events (single parse via `SessionLoadResult`)
3. Extract token/cost totals from shutdown metrics
4. Compute duration, health score, lines changed
5. Extract tool call stats, model metrics, modified files, activity buckets
6. `INSERT OR REPLACE` into `sessions` with all analytics columns
7. `DELETE` + batch `INSERT` into child tables
8. Update `conversation_fts` for full-text search

## Resumed Session Detection

A session can be resumed at any time. Three signals trigger re-indexing:

- **workspace.yaml mtime changed** → metadata updated (summary fields, updated_at)
- **events.jsonl mtime + file size changed** → new events appended (session resumed)
- **analytics_version < CURRENT_ANALYTICS_VERSION** → extraction logic changed, force re-extract

```rust
pub fn needs_reindex(&self, session_id: &str, session_path: &Path) -> bool {
    // Compare stored vs current: workspace_mtime, events_mtime, events_size, analytics_version
    stored_ws_mtime != current_ws_mtime
        || stored_ev_mtime != current_ev_mtime
        || stored_ev_size != current_ev_size
        || stored_version < CURRENT_ANALYTICS_VERSION
}
```

Checking both mtime **and** file size for events.jsonl guards against filesystem mtime granularity issues — a quick append within the same second still changes the file size.

## Performance Characteristics

| Metric | Before | After |
|--------|--------|-------|
| Analytics request cost | O(n) disk reads (n = total sessions) | O(1) SQL query against pre-computed aggregates |
| Indexing cost | — | One-time per session (or per session change) |
| Dashboard load (100 sessions) | ~2-3s | ~10-50ms |
| Tool analysis (100 sessions) | ~5-8s | ~10-50ms |
| Expected speedup | — | **50-500×** for analytics dashboard |

## Extensibility

- **New metrics**: Bump `CURRENT_ANALYTICS_VERSION` to trigger re-extraction across all sessions
- **New child tables**: Add via a new migration (Migration 4+)
- **Filtering**: All query methods accept optional `from_date`, `to_date`, and `repo` parameters
- **Date semantics**: Uses `COALESCE(updated_at, created_at)` for date filtering to match existing frontend behavior
