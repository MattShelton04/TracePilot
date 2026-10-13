# Tantivy Search Index (Reference — Not Merged)

> **Status:** Shelved. This document describes the Tantivy integration as implemented on branch `feat/fst-search-index`. The implementation was not merged due to CPU regressions in aggregation paths. See [search-index-migration/](search-index-migration/) for the full retrospective and implementation guide for the next attempt.

TracePilot evaluated [Tantivy](https://github.com/quickwit-oss/tantivy) as a replacement for its SQLite FTS5 full-text search. The implementation replaced `search_content` and `search_fts` tables entirely, routing all deep content search through Tantivy. Search performance was excellent (6–72× faster) but aggregation (facets, stats, health) caused critical CPU regressions.

## Architecture

```
Text query  → Tantivy search → SQLite metadata hydration → results
Browse mode → Tantivy AllQuery + filters + timestamp sort → SQLite hydration → results
Facets      → Tantivy facet aggregation → response
Context     → Tantivy range query by session_id + event_index → response
Stats       → Tantivy num_docs + content_type facets + SQLite session counts
```

During indexing, `extract_search_content` produces rows from session files, which are written directly to Tantivy via `upsert_session`. On success, `search_indexed_at` is set in SQLite so the session is skipped on subsequent incremental runs.

### Key components

| File | Purpose |
|------|---------|
| `tantivy_index/mod.rs` | `TantivySearchIndex` — open/create, search, count, facets, upsert, context, stats, health |
| `tantivy_index/schema.rs` | Index schema + custom `tracepilot_unicode` tokenizer |
| `tantivy_index/writer.rs` | Document mapping (`row_to_document`) + session upsert |
| `tantivy_index/reader.rs` | Query translation, snippet generation, facet aggregation, context expansion, stats |

### Schema fields

| Field | Type | Notes |
|-------|------|-------|
| `content` | TEXT (indexed + stored) | Custom tokenizer with ASCII folding |
| `session_id` | STRING (fast + stored) | Session UUID |
| `content_type` | STRING (fast + stored) | e.g. `user_message`, `tool_call` |
| `repository` | STRING (fast + stored) | e.g. `owner/repo` |
| `tool_name` | STRING (fast + stored) | e.g. `Read`, `Write` |
| `turn_number` | i64 (fast + stored) | Conversation turn |
| `event_index` | i64 (fast + stored) | Position within session |
| `timestamp_unix` | i64 (fast + stored) | Unix timestamp (sort key) |
| `metadata_json` | STORED only | Raw metadata blob |

### Tauri integration

`TantivyState(Arc<TantivySearchIndex>)` is registered as Tauri managed state during plugin setup. The index directory lives alongside the SQLite index at `<data_dir>/search_index/`.

## Performance

Benchmarked on production data: **314,403 rows across 174 sessions** (release build).

### Indexing

| Operation | Time | Throughput |
|-----------|------|------------|
| Full index (314K rows) | 10.9s | 29K rows/sec |
| Incremental (12.5K row session) | 563ms | upsert 45ms + commit 515ms + reload 3ms |
| Index size on disk | 99 MB | vs 243 MB SQLite (59% smaller) |

### Search latency

| Query | Tantivy | FTS5 | Speedup |
|-------|---------|------|---------|
| "error" (12K hits) | 1.8ms | 133ms | **72×** |
| "async await" (2.9K hits) | 1.2ms | 45ms | **36×** |
| "database migration" (619 hits) | 2.0ms | 15ms | **8×** |
| "fn main" (566 hits) | 1.0ms | 6ms | **6×** |
| Facets "error" | 61ms | 201ms | **3.3×** |

### Aggregation (fast fields)

Facets, stats, tool names, and health queries use columnar fast field iteration (`StrColumn.term_ords()` + `ord_to_str()`), avoiding stored-document decompression entirely. This keeps aggregation CPU-efficient even at 300K+ documents.

### Memory

Tantivy uses mmap — index pages are demand-paged from disk into OS page cache. Typical resident set is 10–30 MB. The writer holds a 15 MB heap buffer. The `IndexReader` clone is O(1); concurrent searches share mmap pages.

## Development

```bash
# Run indexer tests (103 tests including Tantivy)
cargo test -p tracepilot-indexer

# Run benchmark against production data
cargo run --release -p tracepilot-indexer --example bench_tantivy

# Full workspace tests
cargo test --workspace
```

### Schema versioning

`TANTIVY_SCHEMA_VERSION` (in `schema.rs`) is tracked in a `tracepilot_meta.json` sidecar file. On version mismatch, the index is deleted and rebuilt by re-parsing all session `events.jsonl` files from disk. The Tauri plugin detects the rebuild via `was_rebuilt()` and resets `search_indexed_at` for all sessions in SQLite, ensuring the indexing pipeline re-indexes everything into the new schema.

### Result identity

Tantivy results use `(session_id, event_index)` as their composite key. The frontend uses `getResultContextByKey(sessionId, eventIndex)` for context expansion.

## Full SQLite → Tantivy Migration Analysis

This section evaluates the feasibility of replacing additional SQLite tables with Tantivy. The `search_content` migration is **complete** — see below for the remaining tables.

### 1. What has been migrated ✅

**`search_content` (314K rows, bulk of the ~243 MB database) → DONE**

The `search_content` table has been fully dropped (Migration 11). All queries — text search, browse mode, facets, context expansion, stats, tool names, health — now route through Tantivy. SQLite DB size drops from ~243 MB to ~100 MB. Tantivy index is 99 MB on disk (59% smaller than the SQLite table it replaced).

### 2. What stays in SQLite

**`sessions_fts` (FTS5 virtual table)**

This is a thin FTS5 table over `sessions` columns (`id`, `summary`, `repository`, `branch`) used only for toolbar quick-filter (`session_reader.rs:107–120`): `SELECT id FROM sessions_fts WHERE sessions_fts MATCH ?1`. Tantivy could replace this by adding three indexed text fields (`summary`, `repository`, `branch`) with prefix tokenization. However, this table is tiny (one row per session, ~270 rows) and the FTS5 MATCH query is sub-millisecond. The cost of maintaining `sessions_fts` is negligible, and migrating it would require either a separate Tantivy index (the current one is document-per-search-content-row, not document-per-session) or a dual-schema index. **Not worth the complexity.**

### 2. What Tantivy CANNOT replace

Tantivy is a full-text search engine, not a relational database. It fundamentally lacks:

| Capability | SQLite | Tantivy |
|------------|--------|---------|
| Relational JOINs | `JOIN sessions s ON s.id = m.session_id` used in every analytics query | No join primitive; would require application-level multi-query joins |
| Multi-column GROUP BY | `GROUP BY day_of_week, hour` (heatmaps), `GROUP BY model_name` | Only single-field term aggregation via fast fields; no multi-field grouping |
| Aggregate functions | `SUM()`, `AVG()`, `COUNT(DISTINCT ...)`, `COALESCE()`, `CASE WHEN` | No built-in aggregate functions; would need custom `Collector` implementations |
| Atomic multi-table transactions | `BEGIN; DELETE + INSERT` across child tables in one savepoint (`session_writer.rs:78–276`) | Single-index commit only; no cross-index atomicity |
| Foreign key cascades | `ON DELETE CASCADE` cleans up all child rows automatically | Manual deletion across correlated documents |
| Composite primary keys | `PRIMARY KEY (session_id, model_name)`, `PRIMARY KEY (session_id, day_of_week, hour)` | No uniqueness constraints; upsert requires delete-then-insert |
| `CHECK` constraints | `CHECK(content_type IN (...))`, `CHECK(length(trim(content)) > 0)` | No schema-level validation |
| Filtered aggregate expressions | `COUNT(CASE WHEN rate_limit_count > 0 THEN 1 END)` | Would require custom Rust collector per expression |
| Date functions | `date(m.end_timestamp)`, `COALESCE(s.updated_at, s.created_at)` | No date parsing; would need pre-computed day fields |

### 3. `sessions_fts` — should Tantivy replace it?

**No.** The table is:
- **Tiny**: one row per session (~270 rows, a few KB)
- **Simple**: prefix search on `summary`, `repository`, `branch` via FTS5 MATCH
- **Fast**: sub-millisecond, no warmup needed
- **Structurally incompatible**: the current Tantivy index is one-document-per-content-row (314K docs). `sessions_fts` is one-row-per-session. Merging these into a single index would require either a polymorphic schema with sentinel fields or a second Tantivy index, both adding complexity for zero performance gain.

The existing FTS5 integrity-check (`search_reader.rs:396–403`) provides self-repair. Keep it.

### 4. Analytics tables — can Tantivy handle them?

The analytics tables are `session_model_metrics`, `session_tool_calls`, `session_modified_files`, `session_activity`, `session_segments`, and `session_incidents`. Every analytics query follows the same pattern:

```sql
SELECT aggregate_expr(child_column), ...
FROM child_table t
JOIN sessions s ON s.id = t.session_id
{shared_filter_on_sessions}
GROUP BY grouping_column
ORDER BY aggregate DESC
```

**Representative queries that Tantivy cannot express natively:**

| Query | Source | Why Tantivy fails |
|-------|--------|-------------------|
| `SUM(input_tokens + output_tokens) ... GROUP BY model_name` | `analytics_queries.rs:124–139` | No arithmetic on stored fields, no SUM |
| `SUM(tool_call_count) GROUP BY day_of_week, hour` | `analytics_queries.rs:347–352` | No multi-dimensional GROUP BY |
| `COUNT(DISTINCT session_id) GROUP BY file_path LIMIT 20` | `analytics_queries.rs:448–455` | No COUNT DISTINCT |
| `AVG(duration_ms)`, `SUM(CASE WHEN ...)` | Analytics queries | No AVG, no conditional aggregation |
| `date(m.end_timestamp) ... GROUP BY d` | `analytics_queries.rs:91–122` | No date extraction functions |

Tantivy _could_ express some of these through custom `Collector` implementations that walk fast-field values per document and accumulate results in Rust. But this would mean reimplementing an ad-hoc query engine in application code — the exact problem SQLite already solves, with decades of optimization behind it.

**Verdict: Keep all analytics tables in SQLite.** The data is small (a few hundred to a few thousand rows), write patterns are simple (delete-all-for-session then re-insert), and the queries are complex aggregations that are SQLite's bread and butter.

### 5. Data recovery (Tantivy as sole store)

With `search_content` dropped, Tantivy is the sole search store. If the index corrupts or the schema version bumps, the index is deleted and rebuilt by re-parsing all session `events.jsonl` files from disk (same as `rebuild_search_content`). This takes ~11s for 314K rows (174 sessions). The `search_indexed_at` column in `sessions` tracks which sessions have been indexed, so incremental recovery is possible.

**Mitigations in place:**
- `search_indexed_at` tracking in `sessions` table — only unindexed sessions are re-parsed
- Schema version in `tracepilot_meta.json` — detects incompatible changes and triggers rebuild
- Tantivy's segment merge and crash recovery handle unclean shutdowns
- Full rebuild from `events.jsonl` is always available as last resort

### 6. RAM footprint analysis

Tantivy's memory model:

| Component | Memory usage | Notes |
|-----------|-------------|-------|
| Segment metadata | ~1 KB per segment | Typically 5–15 segments after merges |
| Term dictionary | Loaded on demand via mmap | Not resident until queried; OS manages page cache |
| Fast fields | mmap'd, demand-paged | `session_id`, `content_type`, `tool_name`, `repository`, `event_index`, `timestamp_unix`, `turn_number` |
| Stored fields | mmap'd, read on doc retrieval | `content`, `metadata_json` |
| Writer buffer | 15 MB fixed heap (`WRITER_HEAP_SIZE`) | Only during indexing |
| Reader (searcher) | O(1) clone, shares mmap pages | Multiple concurrent readers are free |

**Current dataset (314K docs, 99 MB on disk):**

- Cold start: ~2 MB resident (segment metadata + initial page faults)
- After a broad query like `"error"` (12K hits): ~15–30 MB resident (term dict pages + posting lists + fast fields for faceting)
- During indexing: +15 MB for writer buffer
- Steady state with typical usage: ~10–30 MB (as documented in the Memory section above)

**Projected growth to 1000 sessions (~1.2M docs, ~370 MB on disk):**

- Segment metadata: still negligible (<50 KB)
- Term dictionary: grows sublinearly (many terms repeat across sessions). Estimate ~20–40 MB resident under load.
- Fast fields: linear growth. 1.2M docs × 7 fast fields × ~8 bytes ≈ 67 MB if fully paged in. In practice, OS pages in only queried ranges.
- Writer buffer: still 15 MB (configurable, independent of index size)
- Worst-case resident: ~80–120 MB under heavy query load
- Typical resident: ~30–60 MB

**If `search_content` is dropped from SQLite**, the SQLite DB shrinks from ~243 MB to ~30–50 MB (sessions + analytics tables). The Tantivy index stays at 99 MB (current) vs the 243 MB it replaces. Net disk savings: ~115 MB. RAM tradeoff: SQLite pages `search_content` into cache on demand too, so the in-memory difference is minimal — it's mainly which engine's page cache you're warming.

### 7. Startup cost

| Engine | Cold start | Warm start |
|--------|-----------|------------|
| SQLite | ~1 ms to open; zero page-in until first query. WAL mode means readonly openers don't block writers. | OS page cache serves subsequent reads instantly. |
| Tantivy | ~5–15 ms to open (`MmapDirectory::open` + load segment metadata + register tokenizer). Reader reload is 3 ms (`OnCommitWithDelay`). | Once segment metadata is loaded, search is ready. Mmap pages fault in on first access. |

Both are fast. SQLite has a slight edge on true cold start because it does literally nothing until the first query — the file is opened but no pages are read. Tantivy must read segment metadata and the `tracepilot_meta.json` sidecar. In practice, the 5–15 ms difference is invisible in a desktop app's startup sequence.

**However:** if the Tantivy schema version changes, startup includes deleting and rebuilding the entire index from source files. Current full-index time is 10.9s for 314K rows. At 1000 sessions this could be 30–40s. SQLite migrations, by contrast, are typically `ALTER TABLE ADD COLUMN` and complete in milliseconds.

### 8. Data durability

| Property | SQLite | Tantivy |
|----------|--------|---------|
| ACID transactions | Full — `BEGIN/COMMIT/ROLLBACK`, savepoints, WAL mode | Commit is atomic per segment merge, but no rollback. A crash mid-commit can leave uncommitted documents lost. |
| Write durability | `PRAGMA synchronous=NORMAL` — data survives app crash (not OS crash). Upgrade to `FULL` for OS-crash safety. | `commit()` calls `fsync` on new segment files. Durable after commit returns. |
| Read consistency | Snapshot isolation via WAL — readers see a consistent point-in-time. | `ReloadPolicy::OnCommitWithDelay` — readers see stale data until reload. Typical delay: 500ms–1s. |
| Corruption recovery | `PRAGMA integrity_check`, `.backup` command, well-understood recovery tools. | Delete index directory and rebuild. No built-in repair tool. |
| Concurrent access | Multiple readers + one writer, mediated by WAL + `busy_timeout=5000`. | Multiple readers + one writer via `Mutex<IndexWriter>`. No native multi-process support. |
| Schema migration | `ALTER TABLE` is instantaneous and non-destructive. 11 migrations have been applied cleanly. | Schema change = full index rebuild. Sidecar `tracepilot_meta.json` tracks version. |

The critical difference: **SQLite can evolve its schema without rebuilding data.** Tantivy cannot. Every schema change (adding a field, changing a tokenizer, modifying fast-field configuration) requires a full reindex. For a desktop app where users may have hundreds of sessions, a 10–40 second forced rebuild on app update is a meaningful UX penalty.

### 9. Current state

#### Completed: `search_content` → Tantivy ✅

`search_content` has been dropped (Migration 11). All search queries — text, browse, facets, context, stats — route through Tantivy. SQLite DB shrinks from ~243 MB to ~100 MB.

#### Remaining in SQLite

| Table | Rows (270 sessions) | Migrate? | Reason |
|-------|---------------------|----------|--------|
| `search_content` | ~~314,000~~ | **Done ✅** | Dropped in Migration 11 |
| `sessions` | ~270 | **No** | Relational hub; JOINed by every analytics query; complex `ON CONFLICT DO UPDATE`; tiny |
| `sessions_fts` | ~270 (virtual) | **No** | Negligible size; sub-ms FTS5 MATCH; structurally incompatible with content index |
| `session_model_metrics` | ~800 | **No** | `SUM/GROUP BY model_name` aggregations; FK cascade; tiny |
| `session_tool_calls` | ~2,000 | **No** | `SUM/GROUP BY tool_name` aggregations; FK cascade; tiny |
| `session_modified_files` | ~5,000 | **No** | `COUNT(DISTINCT)/GROUP BY` on paths and extensions; FK cascade; small |
| `session_activity` | ~3,000 | **No** | Multi-column `GROUP BY (day_of_week, hour)` heatmap; FK cascade; small |
| `session_incidents` | ~1,500 | **No** | Per-session drill-down + `ORDER BY timestamp`; FK cascade; small |
| `session_segments` | ~500 | **No** | `date()` extraction + `GROUP BY date(...)` for time-series charts; FK cascade; small |
| `schema_version` | 1 | **No** | Migration tracking; 1 row |

#### Net architecture after migration

#### Current architecture

```
Text search  → Tantivy (sole store for content)
Browse mode  → Tantivy (filtered scan + sort) → SQLite metadata hydration
Facets       → Tantivy facet aggregation
Context      → Tantivy range query by session_id + event_index
Analytics    → SQLite (aggregations over small tables)
Session list → SQLite sessions table + sessions_fts
Rebuild      → Re-parse events.jsonl → Tantivy (no SQLite intermediary)
```

SQLite shrinks from ~243 MB to ~100 MB. Tantivy index is ~99 MB. Total: ~200 MB vs the previous ~342 MB (243 + 99).

## Full Session Data in Tantivy — Feasibility Analysis

This section evaluates storing complete session event data in Tantivy for instant retrieval, replacing the current approach of re-parsing `events.jsonl` files on every access.

### Current Bottleneck

Several UI hotpaths re-parse the full `events.jsonl` from disk on every call:

| Command | What it does | Current cost |
|---------|-------------|-------------|
| `get_session_turns` | Load conversation tab | Full JSONL parse (50–500ms) |
| `get_session_events` | Raw events browser | Full parse + in-memory pagination |
| `get_tool_result` | Single tool result lookup | Full parse to find one event |
| `get_session_detail` | Session detail header | Parse to derive turn count + shutdown metrics |
| `get_shutdown_metrics` | Shutdown tab | Full parse for combined shutdown data |

An LRU cache exists for `get_session_turns` (keyed by file size), but all other paths hit disk every time.

**Session file sizes** (measured on 175 real sessions):
- Median: **3.8 MB** / Average: **7.0 MB** / P90: **18.2 MB** / Max: **43.2 MB**

### What Tantivy Could Accelerate

**1. Per-event random access** — Store each event as a Tantivy document with full content in a stored field. Look up a single tool result by `event_id` in sub-ms instead of parsing the entire JSONL.

**2. Conversation reconstruction** — Query all events for a `session_id`, ordered by `event_index`. Tantivy's fast-field sorting + stored-field retrieval would return the full conversation in ~2–5ms vs 50–500ms JSONL parse.

**3. Paginated event browsing** — The current `get_session_events` loads ALL events into memory then slices. Tantivy natively supports `offset`/`limit` with fast-field ordering.

**4. Export acceleration** — Export currently reads raw session dirs. If events lived in Tantivy, export could pull structured data without touching the filesystem (though raw files would still be needed for `session.db` todos, `plan.md`, checkpoints).

### What It Cannot Replace

| Data source | Why Tantivy can't replace it |
|------------|------------------------------|
| `session.db` (todos, custom tables) | Per-session SQLite with user-created tables; schema is dynamic |
| `plan.md` | Markdown file; read as-is, rarely accessed |
| `checkpoints/` | Directory of markdown files; structural traversal |
| `rewind-snapshots/` | JSON index + snapshot references |
| Analytics aggregations | `SUM/AVG/GROUP BY` across sessions — SQLite is fundamentally better |
| `sessions_fts` | 270-row FTS5 for session list quick-filter; sub-ms, tiny |

### Schema Design (Proposed)

```
// Extend the existing Tantivy schema with:
event_id:      STRING (indexed, stored)     — unique event identifier
event_type:    STRING (indexed, fast, stored) — "user_message", "tool_call", etc.
parent_id:     STRING (stored)              — parent event reference
event_data:    TEXT (stored, not indexed)    — full JSON blob of event.data
raw_timestamp: STRING (stored)              — original ISO timestamp
```

The existing `session_id`, `content_type`, `event_index`, `timestamp_unix` fields already exist. The addition is `event_data` as a stored-but-not-indexed field (doesn't inflate the inverted index, just the doc store).

### Storage Impact

| Dataset | Current search-only index | With full event data |
|---------|--------------------------|---------------------|
| 270 sessions, 314K content rows | 99 MB | ~200–250 MB (estimated) |
| Per session (median) | ~370 KB | ~750 KB–1 MB |

The increase comes from storing the full `event.data` JSON blob (~3.8 MB median per session compressed by Tantivy's LZ4 doc store → ~750 KB–1 MB). The inverted index itself doesn't grow since `event_data` is stored-only.

### Performance Expectations

| Operation | Current (JSONL parse) | Tantivy (projected) |
|-----------|----------------------|-------------------|
| Load conversation (50 turns) | 50–500ms | 2–5ms |
| Single tool result lookup | 50–500ms (full parse) | <1ms |
| Paginated events (50 of 5000) | 200ms+ (load all, slice) | 1–3ms |
| Session detail metadata | 50–200ms | 1–2ms (if pre-aggregated) |

### Trade-offs

**Pros:**
- Sub-ms event retrieval eliminates the biggest remaining I/O bottleneck
- Paginated access without loading full files into memory
- Single source of truth for indexed content + raw events
- Tantivy's LZ4 doc store compresses well (~4:1 on JSON)

**Cons:**
- Index size roughly doubles (~99 → ~200–250 MB)
- Schema change requires full rebuild (~11s for current dataset)
- Events are immutable after session ends, so the write-amplification of re-indexing is low, but initial indexing time would increase ~2× to store full event data
- Export pipeline would still need raw session dirs for `session.db`, `plan.md`, checkpoints
- Tantivy doc store is not a replacement for the source files — if the index corrupts, you rebuild from `events.jsonl`

### Recommendation

**Worth implementing in a follow-up phase.** The biggest win is eliminating the 50–500ms JSONL reparse on every conversation tab open. The storage cost (~100–150 MB extra) is acceptable for a desktop app. Implementation prerequisites:

1. Add `event_data` stored field to schema (bumps `TANTIVY_SCHEMA_VERSION` → 2, triggers rebuild)
2. Extend `row_to_document` to include full event JSON during indexing
3. Add `get_session_events_from_tantivy()` reader method with fast-field sort + pagination
4. Wire Tauri commands to prefer Tantivy for event retrieval, falling back to JSONL on miss
5. Keep `events.jsonl` as source-of-truth for rebuilds and export
