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
   in a savepoint. The batch shares a surrounding transaction, and a session
   whose write fails keeps its previous rows. Some failures can make SQLite roll
   back the whole transaction (a full disk or an I/O error may; a
   `RAISE(ROLLBACK)` trigger does). Then none of the batch is committed and the
   run stops with that error: later batches and sources aren't indexed, and
   pruning is skipped.
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

Date filters on the dashboard select the sessions with activity in the range:
those last active in it, and those with a segment (run) that ended in it, such
as a session resumed after the range. The session counts (`totalSessions`,
each source's `sessions`, and the observed and priced session counts) count
those sessions. Usage counts only inside the range. Segment-based daily charts
use the day each segment ended and include every segment that ended within the
range, whatever its session's last-active date, which keeps activity, token and
cost charts on the same day for sessions spanning midnight. Headline usage
(tokens, the legacy `total_cost`, premium requests and AI Credits), each
source's tokens and USD in `costBySource`, and per-model usage in
`modelDistribution` and `cacheStats` add up to the daily charts. For a session
last active in the range, they take its lifetime total minus its segments that
ended on a day outside the range. For a session last active outside the range,
they take only its segments that ended in it. The AI Credit estimate, token
composition and model shares are built from those model rows. A model left
with no usage in the range has no row. Usage the segments don't account for
belongs to the session's last-active day: a session with no segments, an
undated shutdown, or usage recorded after the last segment. It counts when that
day is inside the range and is left out otherwise. The daily model series places a session without
segments on its last-active day too, and puts the AI Credits the session total
holds beyond its in-range runs (a running run's latest usage checkpoint, an
undated shutdown) on that day under the session's current model with no tokens,
so its AI Credits add up to the headline's. Without a date filter nothing is
subtracted, so All Time shows the lifetime totals exactly. A USD figure is
unknown (the source reads as partly priced) when a run it counts is unpriced;
for a session last active in the range, also when the session is unpriced or a
run outside the range is, since that run's share can't be removed. Segments
carry no per-model USD, so a model's USD in `modelDistribution` is unknown for
a session where that model also ran outside the range, and for every model of a
session last active outside it. Errors and rate limits
each have a timestamped `session_incidents` row, so the daily incidents series
counts them on the day they happened, selected like the runs (an untimestamped
one takes its session's last-active day), and `totalRateLimits` is that
series' sum. Compaction and truncation rows are capped per session, so those
counts stay whole-session, on the last-active day, and count only for sessions
last active in the range. Prompt-cache replies after an idle gap count the
selected sessions' windows that resumed in the range. Turns, tool calls,
observed cache lifetimes, API duration statistics and the per-turn and
per-second averages remain whole-session values of the selected sessions. The legacy daily
cost series counts premium requests; the headline `total_cost` retains model-reported cost.
The rule is in `index_db/helpers/range_usage.rs`, and
`compute_analytics_in_range` applies it to the disk fallback, over the sessions
`load_full_sessions_active_in_range` loads. Differential fixtures in the
indexer's `analytics_parity`, `range_totals`, `range_models` and
`range_resumed` tests cover these semantics against the disk fallback, and
`segment_totals` checks that Copilot and Claude Code segments add up to their
session totals. `range_resumed` and `analytics_day_series` cover sessions
resumed after the range, `range_resumed_filters` the same through the
repository, source and hide-empty filters, and `analytics_day_accuracy` the daily AI Credits,
incidents and cache replies above. The disk fallback (used when the index
can't be opened or its query fails) reports no incidents, and its daily model
series leaves out AI Credits no run accounts for. The Tools and Code Impact
views still select sessions by their last-active date.

### Claude Code runs and USD cost

Claude Code writes a cumulative `cost-state` snapshot at each exit, so a
resumed session holds one snapshot per run. Each run becomes its own segment:
its usage, requests, API time and USD cost are its snapshot minus the previous
one, and it is dated by the main-file records between them. Calls after the
last snapshot form a final, partial segment priced by TracePilot. A run with no
timestamped record folds into the next run (or the previous one when it is
last). A call whose model a snapshot leaves out still counts as a request in
its run. While the snapshot counters only grow, the segments add up to the
session totals, so a session resumed on later days shows its usage on each of
those days. A Claude session with no recorded usage costs $0 rather than
counting as unpriced.

[Migration 24](../../crates/tracepilot-indexer/src/index_db/migrations/plan.rs)
adds a nullable `cost_usd` to `sessions`, `session_segments` and
`session_model_metrics`. It holds the estimate in US dollars: Claude Code's own
figure for snapshot runs, TracePilot's for calls after the last snapshot, and
`NULL` when any part is unpriced. Copilot rows leave it `NULL`; their cost stays
in AI Credits. The backend never adds the two units: `costBySource` reports each
source's sessions, tokens and cost in its own unit, `costUsdByDay` holds the
USD estimates alone, and model rows are grouped by model and source so AI Credit
estimates apply only to Copilot rows. The dashboard combines them in USD,
counting AI Credits at $0.01 each (`apps/desktop/src/utils/analyticsCostSeries.ts`). Claude Code analytics version 23 rebuilds
indexed Claude sessions with these rows; Copilot's version is unchanged.

### Format drift

Indexing also records what each parser could not map:
[migration 25](../../crates/tracepilot-indexer/src/index_db/migrations/plan.rs)
adds `session_format_observations`, one row per session for each unmapped
record type, unmapped attachment type and Claude Code version, with its record
count. Names are checked before they are counted, so a value that is not shaped
like a type name or a version is stored as `(unrecognized name)` or
`(unrecognized version)`, never as a path, an id or content. Copilot sessions
record their unknown event types (as record types) and Copilot CLI versions
from `session.start` and `session.resume`. A known event type whose payload
fails to decode is indexed as a raw event and counted as the record type
`<type>:undecodable` (for both sources), so the drift stays visible even
though analytics lose what that payload carried. A fix that decodes such
payloads must bump the analytics version, or sessions already indexed with
the raw event are never read again.
Settings → Logs & Diagnostics lists the totals per source (Claude Code only
when its sessions are enabled), and `node scripts/claude-census.mjs` prints
the Claude Code tallies for a config folder without indexing it. Claude Code
analytics version 24 refreshes indexed Claude sessions to fill the table, and
Copilot analytics version 18 refreshes indexed Copilot sessions.

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

A snapshot keeps every record that parses. Unknown event types preserve their
raw payloads for forward compatibility, and a known payload that fails typed
deserialization is kept the same way. Lines that cannot be read (malformed JSON,
a line cut off by a killed CLI, invalid UTF-8, or a Claude Code line over the
reader's bound, in the main transcript or a subagent file) are skipped and
counted in the parse diagnostics; they do not reject the update. A crashed CLI
leaves such a line in place for good, and after `--resume` it sits mid-file,
so rejecting it would keep a new session out of the index, or freeze an
indexed one at its pre-crash rows, while every pass parsed it again. The cut
line has no newline, so the resumed CLI's first record lands on the same
line. When a newline-terminated line fails to parse, the parsers keep the
first suffix that starts at a later `{"`, parses through the end of the line,
and has a top-level record's shape (a Copilot envelope with an `id` or
`timestamp`; a Claude Code record with a `type` and a record id). The line
still counts as malformed.

Because the stored fingerprint is sampled before the read and verified after
it, it describes exactly the bytes that were parsed, including a partial last
line that a live CLI is still writing. Finishing that line changes the file's
size, so the next freshness check requests another pass. An unchanged file is
never parsed again, whatever it skipped. A parser fix that would read more of
an unchanged file needs an analytics or extractor version bump, as any other
change to derived data does.

I/O errors, malformed workspace metadata, files changing during reads, and an
event log with skipped lines but no readable event at all reject the update.
The last case has nothing to recover, and the existing rows are better than an
empty session. Existing analytics, child rows, and search content remain
available. Failed snapshots remain stale and are retried on a later indexing
pass. Best-effort UI summary loading remains separate from this persistence
contract.

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
