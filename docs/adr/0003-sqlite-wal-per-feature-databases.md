# ADR-0003: SQLite persistence with WAL + per-feature databases

Date: 2026-04-22
Status: Accepted

## Context

TracePilot stores structured data for several independent features:

- Session index + search metadata (`IndexDb`).
- Task orchestrator state + job history (`TaskDb`).
- Parsed session summaries + analytics (`SessionDb`).
- Skill + MCP catalogue.

Originally these lived in a single SQLite file. Waves 79–83 split them
into per-feature databases after we hit three concrete problems:

1. **Writer contention**: the indexer's bulk-insert pass blocked the
   UI's read-modify-write on orchestrator state.
2. **Migration blast radius**: any schema change forced every consumer
   to hold the same schema version.
3. **Backup granularity**: users wanted to wipe search index without
   losing orchestrator history.

We also need concurrent read access from multiple components (bridge,
UI, indexer) without them stepping on each other.

## Decision

1. **Per-feature SQLite files.** Each feature (index, tasks, sessions,
   skills) owns its own `.sqlite` file under the TracePilot data
   directory. Cross-feature joins happen in Rust, not SQL.
2. **WAL journal mode** is mandatory on every connection.
   `tracepilot_core::utils::sqlite::configure_connection` applies:
   - `journal_mode=WAL` — concurrent reads while a writer is active.
   - companion pragmas (synchronous, temp_store, etc.) in the same
     helper to ensure every opener gets identical durability/perf
     characteristics.
3. **Read-only openers** (`open_readonly`, `open_readonly_if_exists`
   in the same module) must be used for consumers that only read. WAL
   creation is suppressed on read-only file systems.
4. **Schema introspection** goes through the same helpers
   (`table_exists`, `column_exists`, `row_count`,
   `build_in_placeholders`, `build_placeholder_sql`) rather than
   ad-hoc `PRAGMA` strings sprinkled across the codebase. This keeps
   one audit point for SQL injection and placeholder building.
5. **Migrations** are per-database and live under
   `crates/tracepilot-core/src/utils/migrator/`. Each DB tracks its
   own `user_version`. Forward-only; downgrade requires a wipe. See
   ADR-0013 for the migration policy.
6. **Backups** use `rusqlite`'s online backup API (Wave 89), wrapped
   in `crates/tracepilot-core/src/utils/backup.rs` so that the UI can
   snapshot a DB while writers continue.

## Consequences

- **Positive**: Indexer rebuilds no longer stall the UI. Per-feature
  DBs can be rebuilt or deleted independently.
- **Positive**: A single `configure_connection` seam means we can tune
  pragmas (cache_size, mmap_size, temp_store) repo-wide in one PR.
- **Positive**: WAL files live next to each DB file; visible in the
  data dir for diagnostics.
- **Negative**: No foreign keys across features — referential
  integrity is enforced in Rust. Accepted, because feature boundaries
  are strict and rare cross-references are explicit string IDs (see
  `crates/tracepilot-core/src/ids.rs`).
- **Negative**: WAL file retention on abnormal shutdown can leave
  `-wal` / `-shm` files that confuse naive backup tools. Mitigated by
  the `backup.rs` helper which takes a checkpointed snapshot.

## Alternatives considered

- **Single DB with schemas / attached databases**. Rejected — attached
  DBs share the same writer lock and do not solve the contention
  problem. Per-feature files do.
- **Embedded KV store (sled, redb)**. Rejected — we lean heavily on
  ad-hoc SQL (joins, aggregates, FTS-adjacent queries) in the
  analytics pipeline. SQLite is a known quantity; the team ships
  faster on it.
- **Server-backed SQL (Postgres)**. Rejected — TracePilot ships as a
  single desktop binary. A server is a non-starter.

## References

- `crates/tracepilot-core/src/utils/sqlite.rs` —
  `configure_connection`, `open_readonly`, `open_readonly_if_exists`,
  `table_exists`, `column_exists`, `row_count`,
  `build_in_placeholders`, `build_placeholder_sql`.
- `crates/tracepilot-core/src/utils/backup.rs` — online backup.
- `crates/tracepilot-core/src/utils/migrator/` — per-DB migrations.
- `crates/tracepilot-core/src/ids.rs` — cross-feature ID types.
- ADR-0013 — DB migration policy (IndexDb / TaskDb / SessionDb).
- `docs/tech-debt-master-plan-2026-04.md` — Waves 79–83 (DB split),
  Wave 89 (online backup).
