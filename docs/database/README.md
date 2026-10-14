# Session index database (`index.db`)

TracePilot keeps one SQLite database, `{tracepilotHome}/index.db` (see
[on-disk paths](../on-disk-paths.md)). It is a **derived, rebuildable read
model** of the session files that Copilot CLI and Claude Code write. Those files
stay authoritative. Deleting `index.db` (with its `-wal`/`-shm` sidecars) loses
nothing that a reindex can't rebuild.

[schema.md](schema.md) describes every table, column and index. This page explains
how the database is organised and why.

## Code map

All of it lives in [`tracepilot-indexer`](../../crates/tracepilot-indexer/src/index_db/):

| Module | Role |
| --- | --- |
| `open.rs` | Open/create, connection pragmas, incremental auto-vacuum, `with_transaction` |
| `migrations/` | Forward-only migration plan (`plan.rs`) and SQL bodies (`sql.rs`) |
| `session_writer/` | Metadata and analytics pass: one session row plus its child tables |
| `search_writer/` | Search pass: `search_content` chunks and the `search_fts` index |
| `session_reader.rs` | Session list, detail lookups, quick search (`sessions_fts`) |
| `search_reader/` | Full-text and browse queries, facets, result context |
| `analytics_queries/` | Dashboard, models, tools, code impact, agents, skills, prompt cache |
| `maintenance.rs` | Throttled FTS merge, incremental vacuum, WAL checkpoint, `ANALYZE` |

Reindex orchestration (inventory, batching, pruning) lives in
[`indexing/`](../../crates/tracepilot-indexer/src/indexing/).

## Design decisions

**A rebuildable cache, so migrations stay simple.** Migrations are forward-only
and append to [`plan.rs`](../../crates/tracepilot-indexer/src/index_db/migrations/plan.rs)
([ADR 0013](../adr/0013-db-migration-policy.md)). When derived data changes
meaning, we don't write a data migration. We bump a per-source version
(`CURRENT_ANALYTICS_VERSION`/`CLAUDE_CODE_ANALYTICS_VERSION` in `types.rs`,
`CURRENT_EXTRACTOR_VERSION`/`CLAUDE_CODE_EXTRACTOR_VERSION` in
`search_writer/mod.rs`), and stale rows are re-extracted from source on the next
refresh. Schema migrations and extraction versions are separate counters.

**Each session's child rows are replaced as a whole.** A metadata write runs inside
one `SAVEPOINT`: it deletes every child row for the session, upserts the
`sessions` row and re-inserts the children. Nothing is diffed in place, so a
rewrite is idempotent and the session's previous rows survive any failure. Every
child table cascades from `sessions(id)`, so pruning a session removes all of its
rows.

**Metadata and search are independent passes.** Search content takes about 95% of
the file and most of the indexing time. Metadata and analytics are written first,
in batches of up to 32 sessions per transaction, so lists and dashboards fill
quickly. Search follows separately. Each pass records its own success marker,
fingerprint and version:

| Pass | Marker | Source identity | Version |
| --- | --- | --- | --- |
| Metadata/analytics | `indexed_at` | `source_fingerprint` | `analytics_version` |
| Search | `search_indexed_at` | `search_source_fingerprint` | `search_extractor_version` |

The two can describe different moments during a refresh. Copilot's two
fingerprints are deliberately different strings: metadata covers the workspace
and events files, while search covers only the events. Don't compare them.

**Analytics are pre-aggregated per session.** Instead of storing events, the
indexer stores per-session rollups: per model, per tool, per weekday-and-hour,
per accounting run, per agent run and per skill use. Dashboard queries then
aggregate a few thousand small rows rather than parsing session files.
`session_segments` exists so that per-day charts can attribute usage to the day
each run ended, not to the session's last activity.

**FTS5 indexes external content.** `search_fts` and `sessions_fts` index text
held in `search_content` and `sessions`, so the text is stored once. Triggers
keep each index in sync. Per-session search writes temporarily drop the
`search_content` insert trigger, index the new id range with a single
statement, and restore the trigger in the same transaction. Bulk rebuilds drop
all three triggers and run an FTS `rebuild`. FTS rowids are
`search_content.id` (AUTOINCREMENT, never reused) and `sessions.rowid`; neither
is a stable external identifier. `fts_integrity_check` runs FTS5
`integrity-check` with `rank = 1`, which also compares `search_fts` against
`search_content` and reads every row. `fts_health.in_sync` only compares row
counts and pending sessions, so it can't see an index that holds stale text.

**Session IDs are native, not composite.** `sessions.id` is the provider's own
session UUID, and `sessions.source` records which provider owns it. Writers
refuse to overwrite a row owned by another source (`ensure_same_source`).
Making the key `(source, id)` would ripple through every foreign key, IPC type,
deep link and export, and no ID collision has been observed.

**NULL means unknown, and costs are never summed across units.** Usage figures
come in three units: Copilot premium requests (`total_premium_requests`,
`total_cost`, `cost`), observed Copilot AI Credits in integer nano-AIU
(`total_nano_aiu`, 10⁹ per credit), and provider USD (`cost_usd`). They are
never added together. For optional telemetry (reasoning tokens, billing, USD,
timing), NULL means "not recorded" and 0 means a recorded zero. Queries
preserve that difference: for example, they report how many sessions had
observed credits.

**One writer, many readers.** Every connection runs `journal_mode=WAL`,
`synchronous=NORMAL`, `foreign_keys=ON` and `busy_timeout=5000`
([ADR 0003](../adr/0003-sqlite-wal-per-feature-databases.md)). The single writer
also sets a 64 MiB page cache and `temp_store=MEMORY`. Read-only paths use
`IndexDb::open_readonly`.

**Maintenance is throttled and chunked.** The file uses
`auto_vacuum=INCREMENTAL`, and an existing file is converted once on open.
`maintenance()` runs at most every four hours, with the time of the last run
kept in `maintenance_state`. It merges FTS segments in 500-page steps with a
30 s budget, reclaims up to 50,000 free pages, truncates the WAL, and runs
`PRAGMA optimize`. Each step is short, so the indexer's 5 s busy timeout isn't
exceeded. After a bulk rebuild, `maintenance_force()` runs a full `ANALYZE`.

## Where the bytes go

Measured on one real installation (729 sessions, 579 MB, October 2026) with
`dbstat`. Your proportions will differ, but the shape is typical:

| Owner | Share | Notes |
| --- | --- | --- |
| `search_content` rows | 58% | 679k chunks; the text itself |
| `search_content` secondary indexes | 21% | Five indexes; the two led by `session_id` are 84 MB |
| `search_fts` shadow tables | 16% | Postings only; the text is not duplicated |
| `session_incidents` | 2% | Mostly `detail_json` overflow pages |
| Everything else | under 2% | `sessions`, every analytics table, `sessions_fts` |

Storage work belongs in the search tables. Dropping unused analytics columns
saves almost nothing.

## Changing the schema

1. Append a migration to `plan.rs` and never edit one that has shipped. Keep
   `index_db_plan_is_strictly_monotonic` passing.
2. If existing rows need recomputing, bump the matching per-source version
   instead of migrating the data.
3. Write children in `session_writer/` and add new child tables to
   `child_rows::delete_child_rows`, so rewrites replace them.
4. Update [schema.md](schema.md). `schema_doc_matches_migrations` fails when a
   table or column is missing from the reference or no longer exists.
5. For range queries, check the plan in a test. `end_timestamp_range_query_uses_new_index`
   is an example. Note that an index on a raw column doesn't serve a predicate
   that wraps that column in `date(...)`.

## Known issues

These issues were reproduced against `main` with throwaway tests through the
public `IndexDb` and `reindex_all` APIs, in October 2026. Remove each entry when
it is fixed.

1. **Per-day charts drop runs from sessions resumed after the selected range.**
   `build_date_repo_filter` keeps a session only if its *last activity* falls in
   the range. The segment filter is added afterwards. Take a session with a run
   that ended on March 2 and a last update on March 8: for March 1–3, the token,
   activity, model and USD per-day series are all empty. Fix: give the per-day
   series their own filter on `m.end_timestamp`, and keep the lifetime-KPI
   filter as it is. This is a query-only change and needs no reindex.

`idx_session_incidents_type` has no reader: incidents are only read by
`session_id`.
