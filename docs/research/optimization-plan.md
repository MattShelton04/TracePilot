# Incremental Analytics — Delivery Record

**Original plan:** 2026-03-15. **Reviewed against current code:** 2026-09-25.

The original optimization proposal is complete for its main goal: index
per-session metrics and serve analytics from SQL, with a disk-scan fallback.
The current design is documented in [Incremental Analytics](../architecture/incremental-analytics.md).
This page retains the original plan-item accounting. Several rows tracked
parts of the same change; they are not 18 independent optimizations.

| Original item | Outcome | Current state |
|---|---|---|
| 1, 2, 14 | Migration 3 added analytics fields and normalized model, tool, file, and activity tables. | Delivered |
| 3 | Compute per-session analytics while indexing. | Delivered |
| 4, 12 | SQL aggregation for dashboard, tool analysis, and code impact, wired into Tauri commands with a disk-scan fallback. | Delivered |
| 5 | Use `SessionLoadResult` to avoid repeated event parsing during indexing. | Delivered |
| 6 | Detect resumed sessions using workspace and events mtimes, events size, and analytics version. | Delivered |
| 7, 11, 17 | Batch write/prune operations and incremental pruning. | Delivered |
| 8 | Enable SQLite WAL mode. | Delivered |
| 9 | Reduce event-parser `serde_json::Value` cloning. | Delivered |
| 10 | Use a set for model deduplication in turn stats. | Delivered |
| 13 | Look up indexed session paths from the index database. | Delivered |
| 15 | Share frontend duration formatting through `@tracepilot/ui`. | Delivered |
| 16 | Make `get_analytics` disk fallback load summaries only. | **Open:** the fallback still calls `load_full_sessions_filtered`; the SQL path remains the normal path. |
| 18 | Source analytics repository choices from the sessions store. | Delivered |

The [Migration 3 source](../../crates/tracepilot-indexer/src/index_db/migrations/sql.rs),
[indexing code](../../crates/tracepilot-indexer/src/index_db/session_writer.rs),
[analytics commands](../../crates/tracepilot-tauri-bindings/src/commands/analytics.rs),
and [analytics store](../../apps/desktop/src/stores/analytics.ts) are the
current implementation. Relevant regression tests include
[index database analytics](../../crates/tracepilot-indexer/src/index_db/tests/analytics.rs),
[session invalidation](../../crates/tracepilot-indexer/src/index_db/tests/sessions.rs),
and [dashboard aggregation](../../crates/tracepilot-core/src/analytics/dashboard/tests.rs).

The original plan's latency and speedup figures were estimates without a
reproducible recorded workload. Use [measured native performance evidence](../reports/performance-mission.md)
when evaluating performance today. The detailed proposal and implementation
sequence remain recoverable from Git history.
