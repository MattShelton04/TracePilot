# ADR 0004 — Database migration policy

Status: Accepted
Date: 2026-04
Authors: TracePilot maintainers (wave 15, Phase 3-safety.1)

> **Note:** The experimental AI Tasks feature and its `tasks.db` database were removed after v0.6.4. The `TaskDb` material below is retained as historical context; current runtime state uses `index.db`.

## Context

TracePilot persists runtime state in two on-disk SQLite databases:

| Database      | Owner                                   | Purpose                                         |
|---------------|-----------------------------------------|-------------------------------------------------|
| `index.db`    | `tracepilot-indexer` (`IndexDb`)        | Session catalogue, analytics, full-text search  |
| `tasks.db`    | `tracepilot-orchestrator` (`TaskDb`)    | AI agent task / job state machine               |

Until wave 15 each database carried its own hand-rolled migration runner:

- `IndexDb::run_migrations` used a `schema_version(version INTEGER NOT NULL)`
  table, 11 ordered migrations, and an idempotent "add column if missing" tail
  fixup for two columns.
- `TaskDb::run_migrations` tracked the schema version as a **key–value row** in
  a separate `task_meta` table (`key='schema_version'`) and applied two
  migrations with bespoke bootstrap logic.
- Neither runner took a **backup** before mutating the file. A mid-migration
  crash (power loss, `KILL -9`, disk full after partial DDL) could leave the
  user with a half-upgraded database and no supported recovery path.
- Neither runner used a **transaction wrapper** consistently across steps.

The tech-debt plan (`docs/archive/2026-04/tech-debt-plan-revised-2026-04.md` §3-safety.1)
called for unifying both runners behind a shared `Migrator`, standardising on
one `schema_version` convention, adding pre-migration backups, and documenting
the policy in an ADR.

## Decision

1. **Single `Migrator` implementation** in `tracepilot_core::utils::migrator`.
   Both databases supply a static `&'static [Migration]` plan and delegate to
   `run_migrations(&mut Connection, Option<&Path>, &MigrationPlan, &MigratorOptions)`.

2. **Canonical `schema_version` table.** Every TracePilot SQLite database
   tracks its migration state in

   ```sql
   CREATE TABLE schema_version (
       version    INTEGER NOT NULL,
       applied_at TEXT DEFAULT (datetime('now'))
   );
   ```

   `current_version` is `COALESCE(MAX(version), 0)`. Each applied migration
   inserts exactly one row.

3. **Dual-read for legacy `TaskDb` installs.** Existing `tasks.db` files in
   the wild use `task_meta.schema_version`. On open, the orchestrator
   back-fills the canonical table with rows `1..=N` from the legacy value
   **without re-running any migration**. `task_meta` is left intact so
   read-only tooling targeting the old schema keeps working.

4. **Forward-only migrations.** Migrations are append-only; versions are
   monotonic. Down-migrations are **not** supported — recovery on a bad
   migration is restoration from backup.

5. **Backup-before-migrate.** For every on-disk migration `N`, before running
   the migration body the migrator writes

   ```
   {db_filename}.pre-v{N}.bak
   ```

   adjacent to the database (or to `MigratorOptions::backup_dir` when set)
   using the SQLite online backup API (`rusqlite::backup::Backup`), not
   `std::fs::copy`, so WAL-mode databases capture all committed pages.
   In-memory databases skip backups automatically.

6. **Rollback on failure.** Each migration runs inside an
   `unchecked_transaction`. If the migration body or the
   `INSERT INTO schema_version` fails, the transaction is rolled back
   automatically and `run_migrations` returns `MigrationError::Migration` with
   the backup path recorded for operator-driven recovery. Successful
   migrations commit; their row in `schema_version` is the source of truth.

7. **Retention.** The migrator keeps the five most recent
   `{db}.pre-v*.bak` files per database (by mtime) and prunes older ones.

8. **Schema-change rules.**
   - Additive schema changes (new tables, new nullable columns, new indexes)
     are free-form within a new migration.
   - Column removals require a two-phase rollout: deprecate-read migration
     first (readers stop depending on the column), drop migration in a later
     release after telemetry shows the reader rollout is complete.
   - **Breaking semantic changes** (e.g. changing an existing column's
     meaning, renaming a primary key) are not a migrator responsibility —
     they must be gated behind a UI export/import migration prompt. Adding
     that surface is out of scope for wave 15 and tracked as a follow-up.

## Policy summary

| Rule                     | Value                                            |
|--------------------------|--------------------------------------------------|
| Direction                | Forward-only                                     |
| Version table            | `schema_version(version INTEGER, applied_at TEXT)` |
| Backup filename          | `{db}.pre-v{N}.bak`                              |
| Backup mechanism         | `rusqlite::backup::Backup` (WAL-safe)            |
| Backup retention         | Last 5 per database                              |
| Rollback mechanism       | Per-migration `unchecked_transaction`            |
| Recovery path            | Operator restores `cp {db}.pre-vN.bak {db}`      |
| Schema additions         | Allowed within a new migration                   |
| Column removals          | Two-phase (deprecate-read, then drop)            |
| Breaking semantic change | Requires UI-level export step (not auto)         |

## Consequences

**Positive.**

- One place to reason about migration correctness.
- User data is protected from mid-migration corruption: the operator can
  always restore `{db}.pre-vN.bak`.
- `schema_version` is a single, queryable source of truth across databases.
- WAL-mode databases are backed up consistently (via online backup API).

**Negative.**

- First launch after an upgrade is slightly slower because the backup is
  written before any migration runs.
- Disk usage grows by roughly the size of the database × `backup_retention`
  (default 5). Pruning caps this; for typical databases (~10 MB) the
  overhead is negligible; for very large `index.db` files (~1 GB) a product
  decision may want to lower retention further.
- Legacy `TaskDb` installs continue to carry a stale `task_meta.schema_version`
  row indefinitely. We accept this cost in exchange for rollback safety of the
  bootstrap itself.

## Alternatives considered

1. **External migration tool (e.g. `refinery`, `sqlx migrate`).** Rejected —
   TracePilot has no build-time SQL pipeline, no CLI for operators, and
   shipping another binary is at odds with the single-binary Tauri app
   distribution. The runtime footprint of the hand-rolled migrator is
   measured in hundreds of lines.

2. **Linear revision files à la `sqlx migrate`.** Rejected — migrations are
   defined once per version in Rust so that they can be compiled, tested, and
   shipped inside the binary. Out-of-band `.sql` files would force a separate
   asset-embedding story.

3. **Keep the per-module runners.** Rejected as the ongoing maintenance tax:
   no backup story, two divergent bootstrap conventions, and every new
   database target would fork yet another runner.

## Implementation

- `crates/tracepilot-core/src/utils/migrator.rs` — shared framework.
- `crates/tracepilot-indexer/src/index_db/migrations.rs` — `INDEX_DB_PLAN`
  (11 migrations, preserves the v9 pre-hook and the always-run post-hook).
- `crates/tracepilot-orchestrator/src/task_db/mod.rs` — `TASK_DB_PLAN`
  (2 migrations) plus `bootstrap_legacy_schema_version` for dual-read.
- Unit tests cover: fresh install, partial install, backup contents,
  retention pruning, transaction rollback, WAL-mode backup correctness, and
  the legacy `task_meta` dual-read path.

## Follow-ups

- Expose a UI "export → wipe → import" flow for breaking schema changes
  (Phase 3-safety follow-up).
- Optionally lower the default backup retention for very large indexes once
  we have telemetry on real-world `index.db` sizes.
- Add a `cargo xtask db-migrate --dry-run` operator affordance for support
  triage.
