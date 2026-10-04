# Incremental Analytics Pipeline

## Overview

Before this work, every analytics request loaded ALL sessions from disk — parsing `workspace.yaml` and `events.jsonl` for every session, reconstructing turns, and computing aggregates in memory. This was O(n) in total session count on every page load.

Now, per-session metrics are computed during indexing and stored in SQLite.
Changed sessions are recomputed during reindexing. The normal analytics path
aggregates persisted rows with SQL instead of parsing session files on each
request; the Tauri commands retain a disk-scan fallback.

## Schema (Migration 3)

This section records Migration 3. Later migrations extend these tables; see
the [migration source](../../crates/tracepilot-indexer/src/index_db/migrations/sql.rs)
for the current schema.

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
ALTER TABLE sessions ADD COLUMN health_score REAL;
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

1. Discovery finds the session directories on disk.
2. `needs_reindex()` compares the stored successful source fingerprint and
   analytics version with the current source metadata.
3. Indexing prepares a bounded batch outside SQLite: parse workspace metadata
   and events, reconstruct turns once, and compute per-session analytics.
4. Each successful snapshot replaces its session row and child rows together
   in a savepoint. The batch shares a surrounding transaction.
5. Analytics queries aggregate the stored rows. Tauri commands retain the
   disk-scan fallback when the index is unavailable.
6. Background search indexing independently parses source snapshots and replaces
   search content and its freshness marker together.

### Tool and daily-chart semantics

Tool statistics use reconstructed conversation invocations in both indexing and
the disk fallback. Pending calls count as invocations, repeated lifecycle records
do not create extra calls, and subagent terminal events determine the final tool
name, outcome and duration. Success rate uses known successes and failures;
unknown outcomes do not enter its denominator. Average duration uses only calls
with a reconstructed duration. The dashboard's tool-call productivity numerator
uses the same invocation count.
Equal tool counts are ordered by name so the most-used-tool result is stable.

Analytics extraction version 17 refreshes previously indexed sessions with these
rules. It changes derived rows, not the database schema or source event files.
The normal path continues to aggregate those rows with SQL.

Date filters select sessions by their last-active date. For selected sessions,
headline totals remain lifetime values; segment-based daily charts use the day
each segment ended and include only segments within the requested date range.
This keeps activity, token and cost charts on the same day for sessions spanning
midnight. The legacy daily cost series counts premium requests; the headline
`total_cost` retains model-reported cost. Undated shutdowns contribute to lifetime
totals without producing daily chart points. Differential fixtures in the
indexer's `analytics_parity` tests cover these semantics against the disk fallback.

### Successful source snapshots

[Migration 21](../../crates/tracepilot-indexer/src/index_db/migrations/plan.rs)
adds two separate freshness fields:

| Column | Source represented |
| --- | --- |
| `source_fingerprint` | `workspace.yaml` and `events.jsonl` used to compute analytics |
| `search_source_fingerprint` | `events.jsonl` used to extract search content |

A fingerprint stores each file's modification time at the precision returned
by the filesystem and its byte length. Missing optional files are represented
explicitly. These are metadata fingerprints, not content hashes: rewriting the
same number of bytes while preserving the modification time is outside this
change-detection contract. Existing mtime/size columns remain available for
queries and diagnostics, but search no longer borrows analytics' source identity.

The strict [snapshot loader](../../crates/tracepilot-core/src/summary/snapshot.rs)
samples metadata before reading and verifies it after parsing and enrichment.
The analytics writer checks stability again before writing. Writers persist the
identity carried by the parsed snapshot, never a newly sampled identity that
could belong to a later append. If an append occurs after the final check, the
stored identity still describes the older snapshot and the next freshness check
requests another pass.

A complete snapshot may contain unknown event types, which preserve their raw
payloads for forward compatibility. I/O errors, malformed JSONL, failed known
payload deserialization, malformed workspace metadata, and files changing during
reads reject the update. Existing analytics, child rows, and search content remain
available. Failed snapshots remain stale and are retried on a later indexing pass.
Best-effort UI summary loading remains separate from this persistence contract.

A search rebuild invalidates its own freshness markers first, then replaces each
successful session atomically. Cancellation or a failed source read does not
first erase the last-good search results. A later analytics update cannot make
an older search snapshot appear current.

### Bounded preparation and cancellation

Both index paths alternate preparation and writes using batches of at most
32 sessions and an estimated 16 MiB of event-log source bytes. A source larger
than that budget runs alone. This bounds the amount prepared across sessions;
it is not a hard heap cap for an individual session or for files that grow after
the size estimate. Metadata discovery still retains the lightweight session list.

Analytics and search preparation use Rayon. Search polls its existing cancellation
callback on the calling thread every 5 ms while workers run, forwarding an atomic
signal to workers. Cancellation is checked between discovered directories, during each 8 KiB buffered event read,
between extracted events, and between 256-row search insertion chunks. All workers
join before the operation returns, and interrupted writes roll back content and
freshness together. Nested calls from Rayon workers prepare synchronously to avoid
waiting for work queued to the same pool.

An individual JSON deserialization or SQLite statement cannot be interrupted by
these checkpoints. Use the [resource probes](../performance-playbook.md#indexing-resource-and-cancellation-budgets)
to measure the resulting memory peak and cancellation latency on the target corpus.

## Resumed Session Detection

Reindexing is required when either source's mtime or byte length changes, when
an optional source appears or disappears, when metadata cannot be read, or when
`analytics_version` is older than the current extraction version. An absent
successful fingerprint also requests indexing, including after migration from
an older database. Search applies the same rules to its own event fingerprint
and extractor version. A null search completion timestamp also requests indexing.

Checking both mtime and byte length detects an append even when the filesystem's
mtime granularity does not distinguish two writes.

## Performance Characteristics

The SQL path avoids reparsing session files for each analytics request. Query
cost still depends on the selected rows, indexes, and workload; it is not
constant time. Indexing pays the per-session extraction cost when a session
is first seen or changes. The disk-scan fallback has different performance
characteristics. The original proposal's latency and speedup estimates were
not recorded with a reproducible workload, so they are not used as current
performance targets. For measured native results and limitations, see the
[performance mission](../reports/performance-mission.md).

## Extensibility

- **New metrics**: Bump `CURRENT_ANALYTICS_VERSION` to trigger re-extraction across all sessions
- **New child tables**: Add via a new migration (Migration 4+)
- **Filtering**: All query methods accept optional `from_date`, `to_date`, and `repo` parameters
- **Date semantics**: Uses `COALESCE(updated_at, created_at)` for date filtering to match existing frontend behavior
