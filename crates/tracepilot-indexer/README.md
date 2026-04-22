# tracepilot-indexer

Incremental session indexing, FTS5 synchronisation, and file watching. Builds
and maintains `~/.copilot/tracepilot/index.db` so the frontend search palette
returns results quickly without re-parsing sessions on every query.

Persistent state and the per-feature-database convention are covered by ADR
[0003 — SQLite WAL + per-feature databases](../../docs/adr/0003-sqlite-wal-per-feature-databases.md).

## Public API

Re-exported from `src/lib.rs`:

| Name                                      | Purpose                                      |
| ----------------------------------------- | -------------------------------------------- |
| `IndexerError`, `Result`                  | Crate error type (per ADR 0005)              |
| `SessionIndexInfo`                        | Row shape for a single indexed session       |
| `SearchFilters`, `SearchFacets`           | Query inputs / facet response                |
| `SearchResult`, `SearchStats`             | Query outputs                                |
| `sanitize_fts_query`                      | Escape user input for FTS5                   |
| `default_index_db_path`                   | Canonical path for the index DB              |
| `reindex_all`, `reindex_incremental`      | One-shot and incremental indexing entries    |
| `reindex_*_with_progress`                 | Variants emitting `IndexingProgress` events  |
| `reindex_*_with_rich_progress`            | Variants emitting `SearchIndexingProgress`   |
| `rebuild_search_content`                  | Drops and rebuilds the FTS content rows      |
| `reindex_search_content`                  | Incremental FTS content refresh              |

## Usage

```rust
use tracepilot_indexer::{default_index_db_path, reindex_incremental};

let db = default_index_db_path()?;
let stats = reindex_incremental(&db)?;
println!("Indexed {} new sessions", stats.added);
```

## Workspace dependencies

- `tracepilot-core` — session discovery + parsing.

## Layout

- `src/lib.rs` — re-export surface.
- `src/error.rs` — `IndexerError` + `Result` alias.
- `src/index_db/` — schema, migrations, readers/writers, FTS5 helpers.
- `src/indexing/` — full + incremental pipelines, progress reporters.

## Related ADRs

- [0003 — SQLite WAL, per-feature databases](../../docs/adr/0003-sqlite-wal-per-feature-databases.md)
- [0004 — Background process discipline](../../docs/adr/0004-background-process-discipline.md)
- [0005 — Error model](../../docs/adr/0005-error-model-thiserror-per-crate.md)
- [0013 — DB migration policy](../../docs/adr/0013-db-migration-policy.md)
