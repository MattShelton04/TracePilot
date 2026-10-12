# Production SQLite query catalogue

This catalogue is pinned to production main `d95f6d81d8a27f9ee3b18967f00b81d76c25e723`. Frequencies below describe source-triggered work, not measured invocation telemetry. It covers `index.db`, read-only provider `session.db`/Explorer databases, import writes, shared migration/introspection and maintenance. It does not treat tests, examples, benchmark SQL, shelved Tantivy work or pending PRs as production. Physical plans and corpus selectivity are separate evidence; a plausible index role is not proof that SQLite selects it.

## Measured diagnostic coverage

All **136 expanded SELECT shapes** prepared and executed successfully three times on the frozen snapshot, with stable ordered outputs and no unavailable cases. [query-plans.md](query-plans.md) gives every full SQL shape, public synthetic bindings, private-selection assumptions, actual plans, result row/scalar counts and timing median/range. It also documents **23 writer/freshness/maintenance EXPLAIN-only shapes** whose mutations were not executed. Runtime SQLite 3.42.0 differs from bundled 3.46.0; SELECT timings include iteration/encoding/hash verification overhead and are not app latency.

The [five-sample disposable-copy experiments](experiments.md) preserved complete results and confirmed large diagnostic gains for the pending #1022 content-only aggregate join removal, with small/empty shapes showing little difference. The candidate segment-day expression index changed the actual chart plan but is deferred: submillisecond read savings on 715 segments and added bounded replacement cost do not justify a migration. No production schema or SQL was changed by this audit.

## Workflows, parameter shapes and consumers

| Family | User workflow / source frequency | Binding shape and result contract |
| --- | --- | --- |
| Session listing / identity | Session Explorer startup, refresh and metadata filtering; one list SELECT/request. Session path, source and locator lookup on IPC resolution; count and all-ID snapshots during lifecycle work. | Optional exact repository/branch text, hide-empty flag, optional integer limit; `updated_at DESC`. Explicit 18-column list decoded by `indexed_session_from_row`; identifier lookups bind validated session text IDs. Locator decodes path/source/role/parent and skips unknown source/role. No SQL source/hidden filter is added by the list method. |
| Toolbar metadata FTS | Toolbar search request; `search_sessions` is the IPC consumer. The library also exposes ID-only `search`. | One MATCH text binding; sessions_fts `rowid` joins sessions `rowid`; hydrated rows sort updated_at descending then id ascending. ID-only API deduplicates into a HashSet and has no ordering guarantee. Unlike deep search, this library method binds the caller query directly. |
| Deep result page / count | Every `search_content` IPC request executes page and count separately. Pagination repeats count. Results feed search cards and navigation. | Optional sanitized MATCH; IN content types, NOT IN excluded types, IN repositories, IN canonical tools, exact session ID/source, inclusive integer timestamp bounds, limit default 50/cap 200, offset default 0. Params in exactly that order, MATCH first, limit/offset last. Page returns 14 positions (including joined source), decoded by `map_search_result`; FTS snippet uses content column 0/48 tokens and escaped highlight sentinels, browse preview caps 200 SQLite characters. |
| Deep facets / totals | Sidebar facet cache miss; four statements: type, repository, tool and totals. Cache invalidates on index changes. | Same filters; each dimension removes its own IN filter, retaining exclusion and every other filter. Repository/tool require non-NULL, count-descending top 20; type unbounded; totals COUNT rows and COUNT DISTINCT session. All production builder variants join sessions, even when no parent value is needed. |
| Unfiltered facet library APIs | Exposed library methods for type/repository/tool counts; retained API coverage, frequency unestablished. | Type/tool direct search_content aggregation, repository joins sessions. Their presence does not imply the cached IPC path calls them. |
| Context / reference metadata / health | Context expansion: identity lookup plus two adjacent-row reads. Tool-picker/stat cache misses; manual search-health screen/actions. | Integer result ID, radius default 2/cap 10; lookup gets session/event, NULL event becomes 0. Before/after use session+event inequalities, opposite event sorts, LIMIT radius; before reversed in Rust. Tool sources use DISTINCT canonical names, existence of non-Copilot sessions, source-first CROSS JOIN, JSON native-name extraction and one indexed count per canonical tool. Health counts content/FTS/markers, groups types and reads page-size pragmas. |
| Dashboard aggregate | Analytics route/filter change; session totals, three day buckets, two daily-model queries, model distribution, cache totals, duration rows, incidents/day, prompt cache, source cost and USD/day. | Inclusive UTC date strings, repository, hide-empty and optional source. Session dates use `date(COALESCE(updated_at,created_at))` with an OR including completely undated sessions. Segments also clamp `date(end_timestamp)` to the requested window. Group/sort by day; model distribution groups model+source. JSON model_metrics is decoded and folded in Rust. Duration percentiles are computed in Rust. Lifetime totals of overlapping sessions are intentionally distinct from clamped chart totals. |
| Tools analytics | Tools view/filter change; canonical tool, native tool, 7x24 activity and calls/day reads. | Shared dashboard session filter; joins session_tool_calls/native_tool_calls/activity to parent. SUM counts/durations grouped canonical tool, native tool+source, day/hour or last-active date; ordered aggregate count and stable names where specified. Nonnegative/saturating numeric decode; success percentages and full heatmap grid in Rust. |
| Code impact | Code view/filter change; line totals, extension breakdown, top files, distinct files and day changes. | Shared session filter. Paths normalize backslash to slash before grouping/distinct, extension groups; top 20 files by session count. Day attribution is last session activity. Values decoded to typed totals; no raw file-content SQL. |
| Agent analytics | Agents summary/detail request plus unfinished-session settlement lookup. Summary also selection stats; previous comparison window is loaded with current runs in one result. | Inclusive date on COALESCE(run started_at,session created_at), optional repo/source, optional agent exact name COLLATE NOCASE. Wide explicit projection; timestamp descending, session/run tie-breaks. Runs and percentiles grouped in Rust; configured booleans decode nullable integer, counts clamp, incomplete may become unreported. Selections group LOWER(agent_name), count distinct session, MAX display/timestamp. Unfinished lookup is correlated EXISTS with outcome filter. |
| Skill analytics / discovery | Skills summary/detail; recent candidate discovery before opening source logs. | Usage date on COALESCE(invocation timestamp,session created_at), optional repo/source/name normalized in Rust. Explicit projection, descending timestamp/session/event ordering; two token fields combine but separate no-content bit preserves NULL. Recent tool-call candidates use trimmed/lower content, timestamp fallback, bounded CTE, window partitions and top 3 paths/name. Coarse fallback joins aggregate tool counts to sessions. |
| Format diagnostics | Source diagnostics request. | Source text binding; count sessions plus join/group by observation kind/name, COUNT DISTINCT session and SUM records. Versions subsequently sort with provider version ordering. |
| Metadata indexing / freshness | Per provider session during first index and changed-session refresh. Fingerprint and analytics version determine replacement; source ownership guard prevents cross-source ID overwrite. | Snapshot binds metadata/analytics columns and ON CONFLICT updates; savepoint protects whole session + child replacement. Twelve child-table DELETEs by session followed by batched inserts; additional format observations deleted/inserted. Values from typed parsed snapshots, nullable observations preserved. Compound PKs handle replacement/dedup; cascade and session FTS triggers also consume writes. |
| Search indexing / freshness | Phase 2 after metadata; stale fingerprint/version query per candidate session, standalone or shared transactions, optional adaptive full-index bulk mode. | Source guard, DELETE by session, MAX(id), 8-column batched VALUES inserts, INSERT SELECT ids above previous max, search marker update. Insert trigger temporarily dropped within transaction; delete/update triggers stay live. Bulk mode drops all three sync triggers, replaces requested sessions, rebuilds all FTS, restores triggers before commit. Cancellation/failure rolls back to last-good snapshot; actual SQL fragments and bindings listed below. |
| Prune / source purge | Refresh discovered-source reconciliation or disable/move source. | SELECT IDs by source then DELETE source+id IN json_each(bound stale-ID JSON), or source-wide DELETE. Guarded savepoint checks source state before release; FK cascades and FTS deletes are implicit query consumers. |
| Maintenance / migration | Open-time schema checks, only pending forward migrations; post-hooks every open. Background maintenance gated 4 hours, forced after rebuild. | Schema version MAX/INSERT; table_info and ALTER fixups. ANALYZE/optimize, bounded FTS merge command, freelist/incremental vacuum, truncate checkpoint, maintenance epoch upsert/read. SQL engine-owned statistics and FTS shadow tables are implicit consumers. No migration version is inferred from outdated prose ADRs. |
| Provider todos / custom tables | Session Todos/Explorer and export load. Import creates provider-style session.db with todos/deps. | Read-only fixed todo/dependency projections; dynamic escaped table/index names for schema discovery; explicit quoted projection over discovered columns; bounded max_rows LIMIT and cell/total UTF-8 decode budgets. BLOB becomes JSON null. Unbounded library/export reader remains. Import prepares fixed INSERT once/table and commits all todos/deps together. |

## Dynamic SQL and decoding boundaries

Source templates below retain `{where_clause}`, `{TIMESTAMP}`, `{FILE_KEY}` and similar static composition slots. They are not executable SQL until the named helpers expand them. Filters bind values; identifier interpolation uses fixed internal fragments or explicit quote escaping in provider table inspection. `build_in_placeholders` and batch insertion create variable numbers of `?` placeholders. Batch arity is per row multiplied by bounded chunk length, not one binding for an entire list. Pruning instead binds one JSON array to `json_each`.

Aliases carry semantics: `s` is sessions, `sc`/`c` search_content, `m` can mean model metrics or segments depending on query, `r` agent runs, `i` skill invocations, `a` activity or selections, and `w` cache windows. Never merge column evidence solely because aliases match. Aggregate ordinal ORDER BY (e.g. `2 DESC`) refers to the second projected expression. `date` aliases (`d`) participate in filtering/grouping and rows with NULL buckets are excluded. Shared `execute_query_map`, `query_durations`, `query_model_distribution` and `query_day_bucketed` own prepare/map calls; their callers own projection meanings.

There is no production broad `SELECT *` in this catalogue. Source comments/examples and tests using `SELECT *` are excluded. Dynamic custom-table reads build explicit discovered-column projections. COUNT(*) is a row aggregate and cannot be used as evidence that each table column is a product read. FTS external-content fallback is an implicit read of selected source columns, including for non-MATCH FTS counts.

## Index roles and measurement candidates

Roles below are logical evidence from constraints and predicates; bounded frozen-corpus selection is documented below for SQLite 3.42.0; it does not establish every runtime or parameter shape. Every retained index has write/storage cost. A prefix index may be replaceable only after measuring its size and selected plans, checking collation/direction/partial predicates and all writer/reader consumers.

| Current index / key | Constraint or evidenced query role | Disposition |
| --- | --- | --- |
| sessions TEXT PK autoindex | Enforces unique IDs; parent joins, path/locator/stale lookups, ON CONFLICT, cascade parent lookup. `rowid` is separate and binds metadata FTS. | KEEP |
| idx_sessions_updated_at | Unfiltered newest lists and browse reference timestamp access. | KEEP |
| idx_sessions_repo_updated(repository,updated_at) | Exact repository list and repository analytics filter; ordered list suffix after equality. v14 removed redundant repository-only index. | KEEP |
| idx_sessions_nonempty_updated_at partial | Newest lists with exact `turn_count IS NOT NULL AND turn_count > 0` predicate; contains only nonempty rows. | KEEP |
| idx_sessions_source | Source prune/purge, source diagnostics, source filtering and non-Copilot tool provenance existence/outer source selection. | KEEP |
| idx_session_incidents_session(session_id,timestamp) | FK child lookup, replacement delete and incident chronological drill-down. | KEEP |
| idx_session_incidents_type(event_type) | Declared v5 type-analysis access path. Current drill-down reads event_type but filters session; no current type-only query established. Requires complete runtime/extension and plan evidence before changing; grep absence is not removal proof. | KEEP; bounded evidence below |
| search_content INTEGER PK/AUTOINCREMENT | Stable result identity inside one snapshot; FTS rowid join, context seed, MAX(id)/new-id range writer. IDs may change on session replacement. | KEEP |
| idx_search_content_timestamp | Browse timestamp ordering/ranges across sessions. | KEEP |
| idx_search_content_tool | Canonical tool filter/count/DISTINCT and skill candidate selection. | KEEP |
| idx_search_content_type_ts | Type-filtered timestamp browse and type grouping; multi-value/exclusion cases may require sorting. | KEEP |
| idx_search_content_session_ts_type | Session delete/FK lookup, session/date/type search; left prefix replaces former session-only index removed v9. | KEEP |
| idx_search_content_session_event | Context before/after range and sort; session delete/provenance access alternative. | KEEP |
| idx_session_segments_end_ts | Declared v15 standalone end timestamp range access. Current chart SQL wraps column in date(), so plain raw-range migration test does not establish use by production date-wrapped chart. | KEEP; measured date-wrapper comparison |
| idx_agent_runs_name_started(agent_name COLLATE NOCASE,started_at) | Agent detail name equality is compatible with collation; raw started_at suffix differs from date(COALESCE(...)) filter/order. | KEEP |
| idx_agent_runs_started | Declared v18 temporal access; current COALESCE/date expressions differ. | KEEP; bounded evidence below |
| idx_skill_invocations_name_ts(normalized_name,timestamp) | Normalized detail equality; timestamp suffix expression differs from current fallback COALESCE. | KEEP |
| idx_skill_invocations_ts | Declared v19 temporal access; current COALESCE/date expression differs. | KEEP; bounded evidence below |
| Child compound PK autoindexes | Metrics(session_id,model_name), tools(session_id,tool_name), native tools(session_id,tool_name,native_tool_name), files(session_id,file_path), activity(session_id,day_of_week,hour), segments(session_id,end_timestamp), cache windows(session_id,window_index), TTLs(session_id,model,ttl_seconds), agent runs(session_id,run_key), selections/skills(session_id,event_index), format observations(session_id,kind,name). Enforce identity, replace/dedup, joins and session-prefix deletion/FK cascades. | KEEP |
| maintenance_state TEXT PK autoindex | Enforces one value per maintenance key; epoch lookup/upsert. | KEEP |
| session_incidents INTEGER PK | Rowid alias, incident identity; no separate PK index. | KEEP |
| FTS _data INTEGER PK; _idx(segid,term) PK WITHOUT ROWID; _docsize INTEGER PK; _config(k) PK WITHOUT ROWID | SQLite-owned segment, document-size and config access; virtual-table MATCH/rank, triggers, commands indirectly read/write them. No application-defined removable duplicate. | KEEP |
| Provider todos TEXT PK and todo_deps compound PK | Import identity/dependency edge uniqueness. Reads are full projections, no application secondary indexes. Custom provider indexes are discovered, not owned. | KEEP |

Historical idx_sessions_repository and idx_search_content_session are dropped by v14/v9 respectively; conversation_fts was dropped v6. They are not current removal candidates. sqlite_sequence is managed by AUTOINCREMENT; sqlite_schema and sqlite_stat1/stat4 are engine metadata/statistics, not manually maintained product indexes.

Priority requests: (1) broad/common/empty/selective FTS plus browse page/count/four facets, including deep OFFSET and weighted rank sorts; (2) filtered/nonempty/repository/source session lists; (3) production date-wrapped daily analytics versus raw timestamp diagnostic; (4) context session-event ranges and native provenance; (5) agent/skill detail and source reconciliation. Expression/range rewrite experiments require timestamp offset/null/date-boundary equality before index claims. Tool+timestamp composite or branch+timestamp indexes are candidates only if those filtered sorts are common and measured plans show expensive scans/sorts; source alone supplies no acceptance evidence.

Pending #1022 (`codex/perf-database`) adds `content_aggregate`: omit sessions join for count/totals/type/tool facets unless repository or source filtering requests it. Result hydration and repository facets keep the join. It relies on enforced search_content→sessions FK. The catalogue and plan requests use production SQL; that pending optimization must be compared separately. #1020/#1021/#1023 and the combined branch are also pending. Rejected indexing statement-reuse and full-FTS-write experiments are not recommendations; no builds, live scans or benchmarks were run for this source catalogue.

## SQL templates and execution locations

The following inventory lists production SQL literals and compositional fragments with exact source lines, followed by actual rusqlite execution/decode sites. Migration bodies are linked as bodies rather than counted as individual runtime queries. Execution sites include prepare and its query_map/decode separately; those counts must not be added to obtain request query counts. A library method with no established UI caller is retained with unestablished frequency.

### crates/tracepilot-core/src/parsing/session_db.rs

`read_todos` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L85).

```sql
SELECT id, title, description, status, created_at, updated_at FROM todos
```

`read_todo_deps` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L114).

```sql
SELECT todo_id, depends_on FROM todo_deps
```

`list_tables` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L135).

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name
```

`read_custom_table_inner` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L202).

```sql
PRAGMA table_info("{}")
```

`read_custom_table_inner` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L223).

```sql
PRAGMA index_list("{}")
```

`read_custom_table_inner` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L232).

```sql
PRAGMA index_info("{}")
```

`read_custom_table_inner` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L257).

```sql
SELECT {projection} FROM "{safe_name}"{limit_clause}
```

Execution/decode: [read_todos · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L85); [read_todos · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L88); [read_todo_deps · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L114); [read_todo_deps · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L116); [list_tables · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L135); [list_tables · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L137); [read_custom_table_inner · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L202); [read_custom_table_inner · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L205); [read_custom_table_inner · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L223); [read_custom_table_inner · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L226); [read_custom_table_inner · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L232); [read_custom_table_inner · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L235); [read_custom_table_inner · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L256); [read_custom_table_inner · query](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/parsing/session_db.rs#L262).

### crates/tracepilot-core/src/utils/migrator/mod.rs

`run_migrations` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/mod.rs#L99).

```sql
SELECT COALESCE(MAX(version), 0) FROM schema_version
```

`run_migrations` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/mod.rs#L135).

```sql
INSERT INTO schema_version (version) VALUES (?1)
```

Execution/decode: [run_migrations · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/mod.rs#L98); [run_migrations · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/mod.rs#L133); [run_migrations · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/mod.rs#L134).

### crates/tracepilot-core/src/utils/migrator/schema.rs

`ensure_schema_version_table` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/schema.rs#L10).

```sql
CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
         )
```

`ensure_schema_version_table` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/schema.rs#L18).

```sql
PRAGMA table_info(schema_version)
```

`ensure_schema_version_table` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/schema.rs#L34).

```sql
ALTER TABLE schema_version ADD COLUMN applied_at TEXT DEFAULT (datetime('now'))
```

Execution/decode: [ensure_schema_version_table · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/schema.rs#L9); [ensure_schema_version_table · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/schema.rs#L18); [ensure_schema_version_table · query](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/schema.rs#L19); [ensure_schema_version_table · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/migrator/schema.rs#L33).

### crates/tracepilot-core/src/utils/sqlite/connection.rs

`configure_connection` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/connection.rs#L18).

```sql
PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;
```

Execution/decode: [configure_connection · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/connection.rs#L17).

### crates/tracepilot-core/src/utils/sqlite/schema.rs

`table_exists` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/schema.rs#L28).

```sql
SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1
```

`column_exists` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/schema.rs#L60).

```sql
PRAGMA table_info('{}')
```

`row_count` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/schema.rs#L85).

```sql
SELECT COUNT(*) FROM "{}"
```

Execution/decode: [table_exists · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/schema.rs#L27); [column_exists · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/schema.rs#L61); [column_exists · query](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/schema.rs#L63); [row_count · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-core/src/utils/sqlite/schema.rs#L88).

### crates/tracepilot-export/src/import/writer/database.rs

`write_session_db` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L15).

```sql
CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS todo_deps (
            todo_id TEXT,
            depends_on TEXT,
            PRIMARY KEY (todo_id, depends_on)
        );
```

`write_session_db` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L32).

```sql
BEGIN
```

`write_session_db` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L38).

```sql
INSERT INTO todos (id, title, description, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
```

`write_session_db` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L58).

```sql
INSERT INTO todo_deps (todo_id, depends_on) VALUES (?1, ?2)
```

`write_session_db` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L77).

```sql
COMMIT
```

`write_session_db` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L82).

```sql
ROLLBACK
```

Execution/decode: [write_session_db · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L14); [write_session_db · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L32); [write_session_db · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L38); [write_session_db · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L42); [write_session_db · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L58); [write_session_db · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L65); [write_session_db · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L77); [write_session_db · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-export/src/import/writer/database.rs#L82).

### crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs

`load_runs` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L136).

```sql
SELECT r.session_id, s.summary, s.repository, r.run_key, r.tool_call_id, r.agent_name,
                r.agent_type, r.display_name, r.description, r.execution_mode, {TIMESTAMP},
                r.outcome, r.error_text, r.model, r.configured_model, r.first_dispatched_model,
                r.model_override_reason, r.configured_matches_actual, r.multi_turn,
                r.total_tool_calls, r.total_tokens, r.duration_ms, r.own_nano_aiu,
                r.follow_up_count, r.depth, r.peak_siblings, r.parent_agent_name,
                r.turn_index, r.event_index, r.messages_sent, r.messages_received,
                r.peer_messages, r.queued_messages
         FROM session_agent_runs r
         JOIN sessions s ON s.id = r.session_id{clause}
         ORDER BY {TIMESTAMP} DESC, r.session_id, r.run_key
```

`sessions_with_unfinished_runs` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L226).

```sql
SELECT s.id, s.path, s.source, s.role, s.parent_session_id FROM sessions s
         WHERE EXISTS (SELECT 1 FROM session_agent_runs r
                       WHERE r.session_id = s.id AND r.outcome = 'incomplete')
         ORDER BY s.id
```

`query_selections` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L282).

```sql
SELECT MAX(a.agent_name), MAX(a.display_name), COUNT(DISTINCT a.session_id),
                MAX({timestamp})
         FROM session_agent_selections a
         JOIN sessions s ON s.id = a.session_id{clause}
         GROUP BY LOWER(a.agent_name)
         ORDER BY COUNT(DISTINCT a.session_id) DESC, LOWER(a.agent_name)
```

Execution/decode: [load_runs · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L149); [load_runs · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L151); [sessions_with_unfinished_runs · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L225); [sessions_with_unfinished_runs · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L231); [query_selections · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L290); [query_selections · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L291).

### crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs

`query_code_impact` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L27).

```sql
SELECT COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s{}
```

`query_code_impact` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L39).

```sql
SELECT COALESCE(f.extension, '(no ext)'), COUNT(DISTINCT f.session_id || '|' || {FILE_KEY})
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{where_clause}
             GROUP BY f.extension ORDER BY 2 DESC
```

`query_code_impact` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L75).

```sql
SELECT MAX(f.file_path), COUNT(DISTINCT f.session_id)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{where_clause}
             GROUP BY {FILE_KEY} ORDER BY 2 DESC LIMIT 20
```

`query_code_impact` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L97).

```sql
SELECT COUNT(DISTINCT {FILE_KEY})
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{where_clause}
```

`query_code_impact` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L109).

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s
             WHERE 1=1{} AND d IS NOT NULL
             GROUP BY d ORDER BY d
```

Execution/decode: [query_code_impact · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L33); [query_code_impact · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L45); [query_code_impact · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L46); [query_code_impact · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L81); [query_code_impact · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L82); [query_code_impact · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L103); [query_code_impact · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L117); [query_code_impact · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L118).

### crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs

`query_analytics` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L35).

```sql
SELECT COUNT(*), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(total_cost), 0.0),
                    COALESCE(SUM(turn_count), 0), COALESCE(SUM(tool_call_count), 0),
                    COUNT(CASE WHEN turn_count > 0 THEN 1 END),
                    COALESCE(SUM(total_premium_requests), 0.0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN total_api_duration_ms END), 0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN
                        (SELECT SUM(m.output_tokens) FROM session_model_metrics m WHERE m.session_id = s.id)
                    END), 0),
                    COUNT(CASE WHEN error_count > 0 THEN 1 END),
                    COALESCE(SUM(rate_limit_count), 0),
                    COALESCE(SUM(compaction_count), 0),
                    COALESCE(SUM(truncation_count), 0),
                    COALESCE(SUM(total_nano_aiu), 0),
                    COUNT(CASE WHEN total_nano_aiu IS NOT NULL THEN 1 END)
             FROM sessions s{}
```

`query_analytics` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L174).

```sql
SELECT m.model_name,
                    SUM(m.input_tokens + m.output_tokens),
                    SUM(m.input_tokens),
                    SUM(m.output_tokens),
                    SUM(m.cache_read_tokens),
                    SUM(m.cache_write_tokens),
                    SUM(m.cost),
                    SUM(m.request_count),
                    SUM(COALESCE(m.reasoning_tokens, 0)),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(COALESCE(m.total_nano_aiu, 0)),
                    MAX(CASE WHEN m.total_nano_aiu IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.input_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.output_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_read_tokens ELSE 0 END),
                    SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_write_tokens ELSE 0 END),
                    s.source,
                    SUM(m.cost_usd),
                    COUNT(m.cost_usd) > 0 AND COUNT(m.cost_usd) < COUNT(*)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}
             GROUP BY m.model_name, s.source ORDER BY 2 DESC
```

`query_analytics` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L202).

```sql
SELECT COALESCE(SUM(m.cache_read_tokens), 0), COALESCE(SUM(m.input_tokens), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}
```

`query_analytics` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L227).

```sql
SELECT s.total_api_duration_ms FROM sessions s{} AND s.total_api_duration_ms IS NOT NULL AND s.total_api_duration_ms > 0
```

`query_analytics` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L265).

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.error_count), 0),
                    COALESCE(SUM(s.rate_limit_count), 0),
                    COALESCE(SUM(s.compaction_count), 0),
                    COALESCE(SUM(s.truncation_count), 0)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d
```

Execution/decode: [query_analytics · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L86); [query_analytics · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L209); [query_analytics · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L274); [query_analytics · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L276).

### crates/tracepilot-indexer/src/index_db/analytics_queries/day_bucket.rs

`query_day_bucketed` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/day_bucket.rs#L83).

```sql
SELECT date({col}) AS d, {agg} FROM {from} {where_clause} AND d IS NOT NULL GROUP BY d ORDER BY d
```

Execution/decode: [query_day_bucketed · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/day_bucket.rs#L89); [query_day_bucketed · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/day_bucket.rs#L90).

### crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs

`query_model_usage_by_day` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L57).

```sql
SELECT date(m.end_timestamp) as d, m.model_metrics_json, s.source
             FROM session_segments m
             JOIN sessions s ON s.id = m.session_id
             {} AND d IS NOT NULL AND m.model_metrics_json IS NOT NULL
             ORDER BY d
```

`query_model_usage_by_day` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L86).

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    m.model_name,
                    s.source,
                    COALESCE(SUM(m.input_tokens), 0),
                    COALESCE(SUM(m.output_tokens), 0),
                    COALESCE(SUM(m.cache_read_tokens), 0),
                    COALESCE(SUM(m.cache_write_tokens), 0),
                    COALESCE(SUM(COALESCE(m.reasoning_tokens, 0)), 0),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END),
                    COALESCE(SUM(COALESCE(m.total_nano_aiu, 0)), 0),
                    MAX(CASE WHEN m.total_nano_aiu IS NOT NULL THEN 1 ELSE 0 END),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.input_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.output_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_read_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_write_tokens ELSE 0 END), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}
             AND d IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM session_segments seg WHERE seg.session_id = s.id
             )
             GROUP BY d, m.model_name, s.source
             ORDER BY d, m.model_name, s.source
```

Execution/decode: [query_model_usage_by_day · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L65); [query_model_usage_by_day · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L66); [query_model_usage_by_day · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L112); [query_model_usage_by_day · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/model_usage_by_day.rs#L113).

### crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs

`query_prompt_cache` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs#L24).

```sql
SELECT w.session_id, w.outcome, w.idle_seconds, w.prefix_tokens, w.change_kinds,
                w.resume_source, w.model
         FROM session_cache_windows w
         JOIN sessions s ON s.id = w.session_id{where_clause}
           AND w.resume_at IS NOT NULL
```

`query_observed_ttls` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs#L109).

```sql
SELECT t.model, t.ttl_seconds, SUM(t.observation_count)
         FROM session_cache_ttls t{join}{where_clause}
         GROUP BY t.model, t.ttl_seconds
```

Execution/decode: [query_prompt_cache · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs#L31); [query_prompt_cache · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs#L32); [query_observed_ttls · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs#L114); [query_observed_ttls · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs#L115).

### crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs

`load_invocations` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L95).

```sql
SELECT i.session_id, s.summary, s.repository, i.turn_index, i.event_index, {TIMESTAMP},
                i.skill_name, i.normalized_name, i.skill_path, i.normalized_directory,
                i.description, i.source, i.trigger, i.agent_name, i.agent_id, i.model,
                i.plugin_name, i.content_sha256,
                COALESCE(i.frontmatter_tokens, 0) + COALESCE(i.instruction_tokens, 0),
                i.frontmatter_tokens IS NULL AND i.instruction_tokens IS NULL, i.origin
         FROM session_skill_invocations i
         JOIN sessions s ON s.id = i.session_id{clause}
         ORDER BY {TIMESTAMP} DESC, i.session_id, i.event_index DESC
```

Execution/decode: [load_invocations · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L106); [load_invocations · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L108).

### crates/tracepilot-indexer/src/index_db/analytics_queries/source_cost.rs

`query_cost_by_source` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/source_cost.rs#L22).

```sql
SELECT s.source, COUNT(*), COALESCE(SUM(s.total_tokens), 0),
                SUM(s.cost_usd), COUNT(s.cost_usd)
         FROM sessions s{}
         GROUP BY s.source
```

Execution/decode: [query_cost_by_source · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/source_cost.rs#L29); [query_cost_by_source · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/source_cost.rs#L30).

### crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs

`query_tool_analysis` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L25).

```sql
SELECT t.tool_name,
                    SUM(t.call_count), SUM(t.success_count), SUM(t.failure_count),
                    SUM(t.total_duration_ms), SUM(t.calls_with_duration)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id{}
             GROUP BY t.tool_name ORDER BY SUM(t.call_count) DESC, t.tool_name ASC
```

`query_tool_analysis` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L83).

```sql
SELECT a.day_of_week, a.hour, SUM(a.tool_call_count)
             FROM session_activity a
             JOIN sessions s ON s.id = a.session_id{}
             GROUP BY a.day_of_week, a.hour
```

`query_calls_by_day` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L126).

```sql
SELECT date(COALESCE(s.updated_at, s.created_at)) AS d,
                SUM(t.call_count), SUM(t.failure_count), SUM(t.total_duration_ms)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id{where_clause} AND d IS NOT NULL
             GROUP BY d ORDER BY d
```

`query_native_tools` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L163).

```sql
SELECT n.tool_name, n.native_tool_name, s.source,
                SUM(n.call_count), SUM(n.success_count), SUM(n.failure_count),
                SUM(n.total_duration_ms), SUM(n.calls_with_duration)
             FROM session_native_tool_calls n
             JOIN sessions s ON s.id = n.session_id{}
             GROUP BY n.tool_name, n.native_tool_name, s.source
             ORDER BY SUM(n.call_count) DESC, n.native_tool_name ASC, s.source ASC
```

Execution/decode: [query_tool_analysis · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L34); [query_tool_analysis · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L35); [query_tool_analysis · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L90); [query_tool_analysis · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L91); [query_calls_by_day · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L133); [query_calls_by_day · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L134); [query_native_tools · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L173); [query_native_tools · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/tool_analysis.rs#L174).

### crates/tracepilot-indexer/src/index_db/format_diagnostics.rs

`format_diagnostics` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/format_diagnostics.rs#L41).

```sql
SELECT COUNT(*) FROM sessions WHERE source = ?1
```

`format_diagnostics` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/format_diagnostics.rs#L48).

```sql
SELECT o.kind, o.name, COUNT(DISTINCT o.session_id), SUM(o.record_count)
             FROM session_format_observations o
             JOIN sessions s ON s.id = o.session_id
             WHERE s.source = ?1
             GROUP BY o.kind, o.name
             ORDER BY o.kind, o.name
```

Execution/decode: [format_diagnostics · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/format_diagnostics.rs#L40); [format_diagnostics · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/format_diagnostics.rs#L47); [format_diagnostics · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/format_diagnostics.rs#L55).

### crates/tracepilot-indexer/src/index_db/maintenance.rs

`analyze` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L34).

```sql
ANALYZE
```

`maintenance` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L67).

```sql
PRAGMA optimize=0x10002
```

`run_full_maintenance` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L108).

```sql
PRAGMA freelist_count
```

`run_full_maintenance` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L115).

```sql
PRAGMA incremental_vacuum({cap})
```

`run_full_maintenance` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L121).

```sql
PRAGMA freelist_count
```

`run_full_maintenance` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L129).

```sql
PRAGMA wal_checkpoint(TRUNCATE)
```

`merge_fts_segments` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L157).

```sql
INSERT INTO search_fts(search_fts, rank) VALUES('merge', ?1)
```

`read_maintenance_epoch` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L176).

```sql
SELECT CAST(value AS INTEGER) FROM maintenance_state WHERE key = 'last_run_epoch'
```

`write_maintenance_epoch` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L185).

```sql
INSERT OR REPLACE INTO maintenance_state (key, value) VALUES ('last_run_epoch', ?1)
```

Execution/decode: [analyze · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L34); [maintenance · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L67); [run_full_maintenance · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L108); [run_full_maintenance · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L115); [run_full_maintenance · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L121); [run_full_maintenance · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L129); [merge_fts_segments · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L156); [read_maintenance_epoch · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L175); [write_maintenance_epoch · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/maintenance.rs#L184).

### crates/tracepilot-indexer/src/index_db/migrations/columns.rs

`add_column_if_missing` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/columns.rs#L40).

```sql
ALTER TABLE {} ADD COLUMN {} {}
```

`has_column` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/columns.rs#L48).

```sql
PRAGMA table_info({})
```

Execution/decode: [add_column_if_missing · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/columns.rs#L39); [has_column · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/columns.rs#L48); [has_column · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/columns.rs#L50).

### crates/tracepilot-indexer/src/index_db/open.rs

`(module constant)` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L11).

```sql
PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY;
```

`open_readonly` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L61).

```sql
PRAGMA busy_timeout=5000;
```

`with_transaction` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L76).

```sql
BEGIN DEFERRED
```

`with_transaction` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L79).

```sql
COMMIT
```

`with_transaction` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L83).

```sql
ROLLBACK
```

`ensure_incremental_auto_vacuum` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L100).

```sql
PRAGMA auto_vacuum
```

`ensure_incremental_auto_vacuum` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L106).

```sql
PRAGMA auto_vacuum = INCREMENTAL
```

`ensure_incremental_auto_vacuum` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L112).

```sql
PRAGMA page_count
```

`ensure_incremental_auto_vacuum` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L119).

```sql
VACUUM
```

Execution/decode: [open_or_create · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L30); [open_readonly · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L61); [with_transaction · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L76); [with_transaction · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L79); [with_transaction · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L83); [ensure_incremental_auto_vacuum · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L100); [ensure_incremental_auto_vacuum · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L106); [ensure_incremental_auto_vacuum · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L112); [ensure_incremental_auto_vacuum · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/open.rs#L119).

### crates/tracepilot-indexer/src/index_db/search_reader/queries.rs

`query_content` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L33).

```sql
SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, sc.timestamp_unix, sc.tool_name, {snippet_col}, sc.metadata_json, s.summary, s.repository, s.branch, s.updated_at, s.source
```

`query_count` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L66).

```sql
SELECT COUNT(*)
```

`facet_dimension` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L144).

```sql
SELECT {column}, COUNT(*)
```

`totals_query` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L183).

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id)
```

`query_content_type_facets` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L198).

```sql
SELECT content_type, COUNT(*) FROM search_content GROUP BY content_type ORDER BY COUNT(*) DESC
```

`query_repository_facets` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L211).

```sql
SELECT s.repository, COUNT(*) FROM search_content sc JOIN sessions s ON s.id = sc.session_id WHERE s.repository IS NOT NULL GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT 20
```

`query_tool_name_facets` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L227).

```sql
SELECT tool_name, COUNT(*) FROM search_content WHERE tool_name IS NOT NULL GROUP BY tool_name ORDER BY COUNT(*) DESC LIMIT 20
```

Execution/decode: [query_content · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L48); [query_content · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L49); [query_count · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L71); [facet_dimension · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L163); [facet_dimension · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L164); [totals_query · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L188); [query_content_type_facets · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L197); [query_content_type_facets · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L200); [query_repository_facets · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L210); [query_repository_facets · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L216); [query_tool_name_facets · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L226); [query_tool_name_facets · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L231).

### crates/tracepilot-indexer/src/index_db/search_reader/stats.rs

`search_content_row_count` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L17).

```sql
SELECT COUNT(*) FROM search_content
```

`search_stats` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L25).

```sql
SELECT COUNT(*) FROM search_content
```

`search_stats` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L28).

```sql
SELECT COUNT(*) FROM sessions WHERE search_indexed_at IS NOT NULL
```

`search_stats` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L35).

```sql
SELECT COUNT(*) FROM sessions
```

`search_stats` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L38).

```sql
SELECT content_type, COUNT(*) FROM search_content GROUP BY content_type ORDER BY COUNT(*) DESC
```

`search_repositories` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L57).

```sql
SELECT DISTINCT repository FROM sessions WHERE repository IS NOT NULL AND repository != '' ORDER BY repository
```

`search_tool_names` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L78).

```sql
SELECT DISTINCT tool_name FROM search_content WHERE tool_name IS NOT NULL ORDER BY tool_name
```

`search_tool_names` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L95).

```sql
SELECT sc.tool_name, s.source, {NATIVE_TOOL_NAME_SQL} AS native_tool_name, COUNT(*) FROM sessions s CROSS JOIN search_content sc ON sc.session_id = s.id WHERE s.source != ?1 AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name, s.source, native_tool_name
```

`search_tool_names` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L133).

```sql
SELECT COUNT(*) FROM search_content WHERE tool_name = ?1
```

`fts_optimize` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L154).

```sql
INSERT INTO search_fts(search_fts) VALUES('optimize');
             PRAGMA wal_checkpoint(TRUNCATE);
```

`fts_integrity_check` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L164).

```sql
INSERT INTO search_fts(search_fts) VALUES('integrity-check')
```

`fts_health` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L175).

```sql
SELECT COUNT(*) FROM search_content
```

`fts_health` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L178).

```sql
SELECT COUNT(*) FROM search_fts
```

`fts_health` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L180).

```sql
SELECT COUNT(*) FROM sessions WHERE search_indexed_at IS NOT NULL
```

`fts_health` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L186).

```sql
SELECT COUNT(*) FROM sessions
```

`fts_health` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L191).

```sql
SELECT content_type, COUNT(*) FROM search_content GROUP BY content_type ORDER BY COUNT(*) DESC
```

`fts_health` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L201).

```sql
SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()
```

`get_result_context` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L227).

```sql
SELECT session_id, event_index FROM search_content WHERE id = ?1
```

`get_result_context` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L236).

```sql
SELECT id, content_type, turn_number, event_index, tool_name, {NATIVE_TOOL_NAME_SQL} AS native_tool_name, substr(content, 1, 300) AS preview FROM search_content WHERE session_id = ?1 AND event_index < ?2 AND event_index IS NOT NULL ORDER BY event_index DESC LIMIT ?3
```

`get_result_context` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L258).

```sql
SELECT id, content_type, turn_number, event_index, tool_name, {NATIVE_TOOL_NAME_SQL} AS native_tool_name, substr(content, 1, 300) AS preview FROM search_content WHERE session_id = ?1 AND event_index > ?2 AND event_index IS NOT NULL ORDER BY event_index ASC LIMIT ?3
```

Execution/decode: [search_content_row_count · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L17); [search_stats · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L25); [search_stats · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L27); [search_stats · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L35); [search_stats · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L37); [search_stats · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L40); [search_repositories · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L56); [search_repositories · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L59); [search_tool_names · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L77); [search_tool_names · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L82); [search_tool_names · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L101); [search_tool_names · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L102); [search_tool_names · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L133); [search_tool_names · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L136); [fts_optimize · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L153); [fts_integrity_check · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L164); [fts_health · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L175); [fts_health · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L178); [fts_health · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L179); [fts_health · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L186); [fts_health · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L190); [fts_health · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L193); [fts_health · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L200); [get_result_context · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L226); [get_result_context · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L235); [get_result_context · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L242); [get_result_context · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L257); [get_result_context · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L264).

### crates/tracepilot-indexer/src/index_db/search_writer/mod.rs

`(module constant)` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L50).

```sql
CREATE TRIGGER IF NOT EXISTS search_content_ai AFTER INSERT ON search_content BEGIN
        INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
     END;
```

`search_is_stale` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L97).

```sql
SELECT CASE WHEN search_indexed_at IS NULL THEN NULL ELSE search_source_fingerprint END,
                    search_extractor_version FROM sessions WHERE id = ?1
```

`upsert_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L182).

```sql
SAVEPOINT upsert_search
```

`upsert_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L186).

```sql
RELEASE upsert_search
```

`upsert_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L191).

```sql
ROLLBACK TO upsert_search
```

`upsert_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L194).

```sql
RELEASE upsert_search
```

`write_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L214).

```sql
DELETE FROM search_content WHERE session_id = ?1
```

`write_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L229).

```sql
SELECT COALESCE(MAX(id), 0) FROM search_content
```

`write_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L234).

```sql
DROP TRIGGER IF EXISTS search_content_ai;
```

`write_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L239).

```sql
INSERT INTO search_content (session_id, content_type, turn_number, event_index, timestamp_unix, tool_name, content, metadata_json) VALUES
```

`write_search_snapshot` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L260).

```sql
INSERT INTO search_fts(rowid, content)
             SELECT id, content FROM search_content WHERE id > ?1 ORDER BY id
```

`mark_search_indexed` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L277).

```sql
UPDATE sessions SET search_indexed_at = ?1, search_extractor_version = ?2,
                search_source_fingerprint = ?4 WHERE id = ?3
```

`invalidate_search_content` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L292).

```sql
UPDATE sessions SET search_source_fingerprint = NULL
```

`clear_search_content` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L299).

```sql
BEGIN;
             DELETE FROM search_content;
             UPDATE sessions SET search_indexed_at = NULL, search_extractor_version = 0,
                search_source_fingerprint = NULL;
             COMMIT;
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L338).

```sql
BEGIN
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L343).

```sql
DROP TRIGGER IF EXISTS search_content_ai;
                 DROP TRIGGER IF EXISTS search_content_ad;
                 DROP TRIGGER IF EXISTS search_content_au;
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L357).

```sql
DELETE FROM search_content WHERE session_id = ?1
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L367).

```sql
INSERT INTO search_content (session_id, content_type, turn_number, event_index, timestamp_unix, tool_name, content, metadata_json) VALUES
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L388).

```sql
UPDATE sessions SET search_indexed_at = ?1, search_extractor_version = ?2,
                        search_source_fingerprint = ?4 WHERE id = ?3
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L402).

```sql
INSERT INTO search_fts(search_fts) VALUES('rebuild');
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L406).

```sql
CREATE TRIGGER search_content_ai AFTER INSERT ON search_content BEGIN
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;
                 CREATE TRIGGER search_content_ad AFTER DELETE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                 END;
                 CREATE TRIGGER search_content_au AFTER UPDATE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L428).

```sql
CREATE TRIGGER IF NOT EXISTS search_content_ai AFTER INSERT ON search_content BEGIN
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;
                 CREATE TRIGGER IF NOT EXISTS search_content_ad AFTER DELETE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                 END;
                 CREATE TRIGGER IF NOT EXISTS search_content_au AFTER UPDATE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L450).

```sql
COMMIT
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L451).

```sql
ROLLBACK
```

`bulk_write_search_snapshots` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L466).

```sql
ROLLBACK
```

Execution/decode: [search_is_stale · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L96); [upsert_search_snapshot · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L182); [upsert_search_snapshot · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L186); [upsert_search_snapshot · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L191); [upsert_search_snapshot · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L194); [write_search_snapshot · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L213); [write_search_snapshot · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L228); [write_search_snapshot · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L234); [write_search_snapshot · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L259); [write_search_snapshot · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L264); [mark_search_indexed · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L276); [invalidate_search_content · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L292); [clear_search_content · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L298); [bulk_write_search_snapshots · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L338); [bulk_write_search_snapshots · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L342); [bulk_write_search_snapshots · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L356); [bulk_write_search_snapshots · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L387); [bulk_write_search_snapshots · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L402); [bulk_write_search_snapshots · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L405); [bulk_write_search_snapshots · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L427); [bulk_write_search_snapshots · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L450); [bulk_write_search_snapshots · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L451); [bulk_write_search_snapshots · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L466).

### crates/tracepilot-indexer/src/index_db/session_reader.rs

`list_sessions_filtered` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L38).

```sql
SELECT {SESSION_COLUMNS} FROM sessions WHERE 1=1
```

`session_count` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L84).

```sql
SELECT COUNT(*) FROM sessions
```

`all_indexed_ids` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L90).

```sql
SELECT id FROM sessions
```

`get_session_path` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L107).

```sql
SELECT path FROM sessions WHERE id = ?1
```

`get_session_source_name` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L121).

```sql
SELECT source FROM sessions WHERE id = ?1
```

`get_session_locator` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L137).

```sql
SELECT path, source, role, parent_session_id FROM sessions WHERE id = ?1
```

`search` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L168).

```sql
SELECT id FROM sessions_fts WHERE sessions_fts MATCH ?1
```

`search_sessions` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L180).

```sql
SELECT
                s.id, s.path, s.summary, s.repository, s.branch, s.cwd, s.host_type,
                s.created_at, s.updated_at, s.event_count, s.turn_count, s.current_model,
                s.copilot_version, s.error_count, s.rate_limit_count, s.compaction_count, s.truncation_count,
                s.source
             FROM sessions_fts f
             INNER JOIN sessions s ON s.rowid = f.rowid
             WHERE sessions_fts MATCH ?1
             ORDER BY s.updated_at DESC, s.id ASC
```

`distinct_session_cwds` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L203).

```sql
SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL AND cwd != ''
```

`recent_skill_call_candidates` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L223).

```sql
WITH recent_skill_calls AS (
                 SELECT
                     LOWER(TRIM(c.content)) AS normalized_name,
                     TRIM(c.content) AS display_name,
                     s.path AS session_path,
                     COALESCE(c.timestamp_unix, unixepoch(s.updated_at), 0) AS sort_ts,
                     c.id AS search_row_id
                 FROM search_content c
                 JOIN sessions s ON s.id = c.session_id
                 WHERE c.tool_name = 'skill'
                   AND c.content_type = 'tool_call'
                   AND LENGTH(TRIM(c.content)) > 0
                   AND s.turn_count IS NOT NULL
                   AND s.turn_count > 0
                 ORDER BY sort_ts DESC, search_row_id DESC
                 LIMIT ?1
             ),
             ranked AS (
                 SELECT
                     normalized_name,
                     display_name,
                     session_path,
                     sort_ts,
                     search_row_id,
                     COUNT(*) OVER (PARTITION BY normalized_name) AS invocation_count,
                     ROW_NUMBER() OVER (
                         PARTITION BY normalized_name
                         ORDER BY sort_ts DESC, search_row_id DESC
                     ) AS rn
                 FROM recent_skill_calls
             )
             SELECT normalized_name, display_name, session_path, invocation_count
             FROM ranked
             WHERE rn <= 3
             ORDER BY sort_ts DESC, search_row_id DESC
```

`recent_skill_tool_sessions` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L281).

```sql
SELECT s.id, s.path
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id
             WHERE t.tool_name = 'skill'
               AND t.call_count > 0
               AND s.turn_count IS NOT NULL
               AND s.turn_count > 0
             ORDER BY s.updated_at DESC, s.id ASC
             LIMIT ?1
```

`get_session_incidents` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L307).

```sql
SELECT event_type, source_event_type, timestamp, severity, summary, detail_json
             FROM session_incidents WHERE session_id = ?1 ORDER BY timestamp
```

Execution/decode: [list_sessions_filtered · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L67); [list_sessions_filtered · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L68); [session_count · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L84); [all_indexed_ids · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L90); [all_indexed_ids · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L91); [get_session_path · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L106); [get_session_source_name · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L120); [get_session_locator · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L136); [search · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L168); [search · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L169); [search_sessions · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L179); [search_sessions · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L190); [distinct_session_cwds · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L203); [distinct_session_cwds · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L204); [recent_skill_call_candidates · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L222); [recent_skill_call_candidates · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L259); [recent_skill_tool_sessions · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L280); [recent_skill_tool_sessions · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L291); [get_session_incidents · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L306); [get_session_incidents · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L310).

### crates/tracepilot-indexer/src/index_db/session_writer/agent_runs.rs

`write_agent_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/agent_runs.rs#L80).

```sql
INSERT OR REPLACE INTO session_agent_runs (session_id, run_key, tool_call_id, agent_id, parent_run_key, parent_agent_name, depth, agent_name, agent_type, display_name, description, execution_mode, started_at, ended_at, outcome, error_text, requested_model, model, configured_model, configured_effort, context_tier, multi_turn, first_dispatched_model, explicit_model_override, model_override_reason, configured_model_preference, configured_matches_actual, total_tool_calls, total_tokens, duration_ms, own_nano_aiu, follow_up_count, messages_sent, messages_received, peer_messages, queued_messages, peak_siblings, turn_index, event_index, source) VALUES
```

`write_agent_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/agent_runs.rs#L152).

```sql
INSERT OR REPLACE INTO session_agent_selections (session_id, event_index, agent_name, display_name, selected, timestamp) VALUES
```

### crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L14).

```sql
DELETE FROM session_model_metrics WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L15).

```sql
DELETE FROM session_tool_calls WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L16).

```sql
DELETE FROM session_native_tool_calls WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L17).

```sql
DELETE FROM session_modified_files WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L18).

```sql
DELETE FROM session_activity WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L19).

```sql
DELETE FROM session_incidents WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L20).

```sql
DELETE FROM session_segments WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L21).

```sql
DELETE FROM session_cache_windows WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L22).

```sql
DELETE FROM session_cache_ttls WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L23).

```sql
DELETE FROM session_agent_runs WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L24).

```sql
DELETE FROM session_agent_selections WHERE session_id = ?1
```

`delete_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L25).

```sql
DELETE FROM session_skill_invocations WHERE session_id = ?1
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L47).

```sql
INSERT INTO session_model_metrics (session_id, model_name, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost, request_count, reasoning_tokens, total_nano_aiu, cost_usd) VALUES
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L70).

```sql
INSERT INTO session_tool_calls (session_id, tool_name, call_count, success_count, failure_count, total_duration_ms, calls_with_duration) VALUES
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L88).

```sql
INSERT INTO session_native_tool_calls (session_id, tool_name, native_tool_name, call_count, success_count, failure_count, total_duration_ms, calls_with_duration) VALUES
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L107).

```sql
INSERT OR IGNORE INTO session_modified_files (session_id, file_path, extension) VALUES
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L120).

```sql
INSERT INTO session_activity (session_id, day_of_week, hour, tool_call_count) VALUES
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L134).

```sql
INSERT INTO session_segments (session_id, start_timestamp, end_timestamp, total_tokens, total_requests, total_premium_requests, total_api_duration_ms, current_model, model_metrics_json, total_nano_aiu, cost_usd) VALUES
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L157).

```sql
INSERT INTO session_incidents (session_id, event_type, source_event_type, timestamp, severity, summary, detail_json) VALUES
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L175).

```sql
INSERT INTO session_cache_windows (session_id, window_index, idle_start, resume_at, idle_seconds, model, expires_at, ttl_seconds, outcome, resume_source, prefix_tokens, interaction_nano_aiu, change_kinds) VALUES
```

`write_child_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L200).

```sql
INSERT INTO session_cache_ttls (session_id, model, ttl_seconds, observation_count) VALUES
```

Execution/decode: [delete_child_rows · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/child_rows.rs#L29).

### crates/tracepilot-indexer/src/index_db/session_writer/format_observations.rs

`write` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/format_observations.rs#L29).

```sql
DELETE FROM session_format_observations WHERE session_id = ?1
```

`write` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/format_observations.rs#L51).

```sql
INSERT INTO session_format_observations (session_id, kind, name, record_count) VALUES
```

Execution/decode: [write · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/format_observations.rs#L28).

### crates/tracepilot-indexer/src/index_db/session_writer/prune.rs

`prune_source` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L29).

```sql
SELECT id FROM sessions WHERE source = ?1
```

`prune_source` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L47).

```sql
DELETE FROM sessions
                 WHERE source = ?1 AND id IN (SELECT value FROM json_each(?2))
```

`purge_source` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L67).

```sql
DELETE FROM sessions WHERE source = ?1
```

`delete_guarded` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L78).

```sql
SAVEPOINT delete_sessions
```

`delete_guarded` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L90).

```sql
RELEASE SAVEPOINT delete_sessions
```

`delete_guarded` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L96).

```sql
ROLLBACK TO SAVEPOINT delete_sessions
```

`delete_guarded` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L101).

```sql
RELEASE SAVEPOINT delete_sessions
```

Execution/decode: [prune_source · prepare](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L29); [prune_source · query_map](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L31); [prune_source · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L46); [purge_source · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L67); [delete_guarded · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L78); [delete_guarded · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L90); [delete_guarded · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L96); [delete_guarded · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/prune.rs#L101).

### crates/tracepilot-indexer/src/index_db/session_writer/skill_invocations.rs

`write_skill_invocation_rows` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer/skill_invocations.rs#L43).

```sql
INSERT OR REPLACE INTO session_skill_invocations (session_id, event_index, turn_index, tool_call_id, timestamp, skill_name, normalized_name, skill_path, normalized_directory, description, source, trigger, agent_id, agent_name, model, plugin_name, plugin_version, content_sha256, frontmatter_tokens, instruction_tokens, origin) VALUES
```

### crates/tracepilot-indexer/src/index_db/session_writer.rs

`ensure_same_source` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L154).

```sql
SELECT source FROM sessions WHERE id = ?1
```

`write_prepared_session` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L209).

```sql
SAVEPOINT upsert_session
```

`write_prepared_session` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L222).

```sql
INSERT INTO sessions (
                    id, path, summary, repository, branch, cwd, host_type,
                    created_at, updated_at, event_count, turn_count,
                    current_model, copilot_version, total_premium_requests, total_api_duration_ms,
                    total_nano_aiu,
                    workspace_mtime,
                    total_tokens, total_cost, tool_call_count, lines_added, lines_removed,
                    events_mtime, events_size, analytics_version,
                    error_count, rate_limit_count, compaction_count, truncation_count,
                    total_compaction_input_tokens, total_compaction_output_tokens,
                    source_fingerprint, source, parent_session_id, role, hidden,
                    source_format_version, cost_usd, indexed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                    ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
                    ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38,
                    datetime('now')
                )
                ON CONFLICT(id) DO UPDATE SET
                    path=excluded.path, summary=excluded.summary, repository=excluded.repository,
                    branch=excluded.branch, cwd=excluded.cwd, host_type=excluded.host_type,
                    created_at=excluded.created_at, updated_at=excluded.updated_at,
                    event_count=excluded.event_count, turn_count=excluded.turn_count,
                    current_model=excluded.current_model,
                    copilot_version=excluded.copilot_version,
                    total_premium_requests=excluded.total_premium_requests,
                    total_api_duration_ms=excluded.total_api_duration_ms,
                    total_nano_aiu=excluded.total_nano_aiu,
                    workspace_mtime=excluded.workspace_mtime,
                    total_tokens=excluded.total_tokens, total_cost=excluded.total_cost,
                    tool_call_count=excluded.tool_call_count,
                    lines_added=excluded.lines_added, lines_removed=excluded.lines_removed,
                    events_mtime=excluded.events_mtime, events_size=excluded.events_size,
                    analytics_version=excluded.analytics_version,
                    error_count=excluded.error_count, rate_limit_count=excluded.rate_limit_count,
                    compaction_count=excluded.compaction_count,
                    truncation_count=excluded.truncation_count,
                    total_compaction_input_tokens=excluded.total_compaction_input_tokens,
                    total_compaction_output_tokens=excluded.total_compaction_output_tokens,
                    source_fingerprint=excluded.source_fingerprint,
                    parent_session_id=excluded.parent_session_id,
                    role=excluded.role, hidden=excluded.hidden,
                    source_format_version=excluded.source_format_version,
                    cost_usd=excluded.cost_usd,
                    indexed_at=excluded.indexed_at
```

`write_prepared_session` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L324).

```sql
RELEASE upsert_session
```

`write_prepared_session` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L329).

```sql
ROLLBACK TO upsert_session
```

`write_prepared_session` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L332).

```sql
RELEASE upsert_session
```

`session_is_stale` — [SQL source](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L365).

```sql
SELECT source_fingerprint, analytics_version FROM sessions WHERE id = ?1
```

Execution/decode: [ensure_same_source · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L153); [write_prepared_session · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L209); [write_prepared_session · execute](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L221); [write_prepared_session · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L324); [write_prepared_session · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L329); [write_prepared_session · execute_batch](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L332); [session_is_stale · query_row](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_writer.rs#L364).

## Dynamic filter, ordering and shared-expression fragments

- [date](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L102): `COALESCE(r.started_at, s.created_at)`

- [load_runs](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L111): `WHERE 1=1`

- [load_runs](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L119): `AND date({TIMESTAMP}) >= ?`

- [load_runs](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L123): `AND date({TIMESTAMP}) <= ?`

- [load_runs](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L127): `AND s.repository = ?`

- [load_runs](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L132): `AND r.agent_name = ? COLLATE NOCASE`

- [query_selections](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L265): `COALESCE(a.timestamp, s.created_at)`

- [query_selections](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L266): `WHERE a.selected = 1 AND a.agent_name IS NOT NULL`

- [query_selections](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L269): `AND date({timestamp}) >= ?`

- [query_selections](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L273): `AND date({timestamp}) <= ?`

- [query_selections](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/agents.rs#L277): `AND s.repository = ?`

- [query_code_impact](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/code_impact.rs#L114): `WHERE 1=1`

- [(module constant)](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L12): `session_segments m JOIN sessions s ON s.id = m.session_id`

- [query_analytics](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L113): `COALESCE(SUM(m.total_tokens), 0)`

- [query_analytics](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/dashboard.rs#L156): `COALESCE(SUM(m.total_premium_requests), 0.0)`

- [query_observed_ttls](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/prompt_cache.rs#L105): `JOIN sessions s ON s.id = t.session_id`

- [invoked_by](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L67): `COALESCE(i.timestamp, s.created_at)`

- [load_invocations](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L75): `WHERE 1=1`

- [load_invocations](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L78): `AND date({TIMESTAMP}) >= ?`

- [load_invocations](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L82): `AND date({TIMESTAMP}) <= ?`

- [load_invocations](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L86): `AND s.repository = ?`

- [load_invocations](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/skills.rs#L91): `AND i.normalized_name = ?`

- [query_cost_usd_by_day](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/source_cost.rs#L69): `session_segments m JOIN sessions s ON s.id = m.session_id`

- [query_cost_usd_by_day](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/source_cost.rs#L70): `SUM(m.cost_usd)`

- [build_date_repo_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L19): `WHERE 1=1`

- [build_date_repo_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L23): `AND s.turn_count IS NOT NULL AND s.turn_count > 0`

- [build_date_repo_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L29): `AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL))`

- [build_date_repo_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L35): `AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL))`

- [build_date_repo_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L40): `AND s.repository = ?`

- [append_source_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L57): `AND s.source = ?`

- [append_segment_date_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L85): `AND date({col}) >= ?`

- [append_segment_date_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L89): `AND date({col}) <= ?`

- [build_eq_filter](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/filters.rs#L105): `AND {} = ?`

- [(module constant)](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/mod.rs#L110): `CASE WHEN json_valid(metadata_json) THEN json_extract(metadata_json, '$.nativeToolName') END`

- [query_content](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L27): `CASE WHEN LENGTH(sc.content) > 200 THEN SUBSTR(sc.content, 1, 200) || '…' ELSE sc.content END`

- [facet_dimension](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/queries.rs#L155): `ORDER BY COUNT(*) DESC`

- [with_sort](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L151): `ORDER BY sc.timestamp_unix DESC NULLS LAST`

- [with_sort](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L154): `ORDER BY sc.timestamp_unix ASC NULLS LAST`

- [with_sort](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L159): `ORDER BY CASE sc.content_type WHEN 'user_message' THEN rank * 2.0 WHEN 'error' THEN rank * 2.0 WHEN 'tool_error' THEN rank * 1.8 WHEN 'assistant_message' THEN rank * 1.5 WHEN 'reasoning' THEN rank * 1.3 WHEN 'compaction_summary' THEN rank * 1.1 WHEN 'subagent' THEN rank * 1.1 WHEN 'system_message' THEN rank * 1.0 WHEN 'tool_call' THEN rank * 0.6 WHEN 'tool_result' THEN rank * 0.7 ELSE rank END`

- [with_sort](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L176): `ORDER BY sc.timestamp_unix DESC NULLS LAST`

- [with_group_by](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L194): `GROUP BY {} {}`

- [build](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L212): `WHERE`

- [build](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L215): `AND`

- [build](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L220): `WHERE 1=1`

- [build_from_clause](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L251): `FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid JOIN sessions s ON s.id = sc.session_id`

- [build_from_clause](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L255): `FROM search_content sc JOIN sessions s ON s.id = sc.session_id`

- [list_sessions_filtered](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L42): `AND turn_count IS NOT NULL AND turn_count > 0`

- [list_sessions_filtered](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L60): `ORDER BY updated_at DESC`

## Remaining execution sites (DDL, shared helpers and provider inspection)

| Site | Function | Method / first argument |
| --- | --- | --- |
| [crates/tracepilot-indexer/src/index_db/batch_insert.rs:92](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/batch_insert.rs#L92) | batched_insert | prepare: &sql)?) |
| [crates/tracepilot-indexer/src/index_db/batch_insert.rs:106](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/batch_insert.rs#L106) | batched_insert | execute: rusqlite::params_from_iter(params))?; |
| [crates/tracepilot-indexer/src/index_db/batch_insert.rs:110](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/batch_insert.rs#L110) | batched_insert | prepare: &sql)?; |
| [crates/tracepilot-indexer/src/index_db/batch_insert.rs:117](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/batch_insert.rs#L117) | batched_insert | execute: rusqlite::params_from_iter(params))?; |
| [crates/tracepilot-indexer/src/index_db/helpers/model_distribution.rs:35](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/model_distribution.rs#L35) | query_model_distribution | prepare: sql)?; |
| [crates/tracepilot-indexer/src/index_db/helpers/model_distribution.rs:36](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/model_distribution.rs#L36) | query_model_distribution | query_map: params_from_iter(refs.iter().copied()), \|row\| { |
| [crates/tracepilot-indexer/src/index_db/helpers/queries.rs:19](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/queries.rs#L19) | execute_query_map | prepare: sql)?; |
| [crates/tracepilot-indexer/src/index_db/helpers/queries.rs:20](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/helpers/queries.rs#L20) | execute_query_map | query_map: params_from_iter(params), \|row\| mapper(row))?; |


Source inventory: 180 SQL-bearing literals/templates, 48 dynamic fragments, 206 execution/decode call sites. These are source counts, not expanded SQL variants or measured request counts.

## Every reconstructed current named index

This source-reconstructed inventory includes named constraint indexes returned by index_list, including WITHOUT ROWID primary-key b-trees. Auxiliary rowid entries in index_xinfo are payload/tie-breakers, not additional product columns. The role table above explains the relevant workflows; compound session-prefixed constraints support child replacement, joins and cascades in addition to uniqueness.

| Name | Table / ordered key | Definition evidence | Constraint / workload mapping |
| --- | --- | --- | --- |
| `sqlite_autoindex_maintenance_state_1` | maintenance_state (key) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L327) | PK uniqueness + exact key lookup/upsert; KEEP |
| `idx_search_content_session_event` | search_content (session_id, event_index) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L291) | adjacent context inequalities/order and child delete; KEEP |
| `idx_search_content_session_ts_type` | search_content (session_id, timestamp_unix, content_type) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L290) | session+date/type filters, child deletes and FK lookup; KEEP |
| `idx_search_content_type_ts` | search_content (content_type, timestamp_unix) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L289) | content-type filters/facets and chronological browse; KEEP |
| `idx_search_content_tool` | search_content (tool_name) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L288) | canonical tool IN/count/DISTINCT and skill discovery; KEEP |
| `idx_search_content_timestamp` | search_content (timestamp_unix) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L287) | browse date/sort; KEEP |
| `sqlite_autoindex_search_fts_config_1` | search_fts_config (k) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L294) | FTS engine segment/config key; KEEP |
| `sqlite_autoindex_search_fts_idx_1` | search_fts_idx (segid, term) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L294) | FTS engine segment/config key; KEEP |
| `sqlite_autoindex_session_activity_1` | session_activity (session_id, day_of_week, hour) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L108) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `idx_agent_runs_started` | session_agent_runs (started_at) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L472) | declared temporal access; COALESCE/date plans measured below; KEEP |
| `idx_agent_runs_name_started` | session_agent_runs (agent_name COLLATE NOCASE, started_at) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L470) | NOCASE agent detail name; expression timestamp suffix caveat; KEEP |
| `sqlite_autoindex_session_agent_runs_1` | session_agent_runs (session_id, run_key) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L423) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `sqlite_autoindex_session_agent_selections_1` | session_agent_selections (session_id, event_index) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L476) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `sqlite_autoindex_session_cache_ttls_1` | session_cache_ttls (session_id, model, ttl_seconds) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L410) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `sqlite_autoindex_session_cache_windows_1` | session_cache_windows (session_id, window_index) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L388) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `sqlite_autoindex_session_format_observations_1` | session_format_observations (session_id, kind, name) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/plan.rs#L180) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `idx_session_incidents_type` | session_incidents (event_type) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L153) | declared incident-type access; current type-only runtime caller unestablished; KEEP |
| `idx_session_incidents_session` | session_incidents (session_id, timestamp) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L152) | session incident drill-down timestamp order; child replacement/FK; KEEP |
| `sqlite_autoindex_session_model_metrics_1` | session_model_metrics (session_id, model_name) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L73) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `sqlite_autoindex_session_modified_files_1` | session_modified_files (session_id, file_path) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L99) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `sqlite_autoindex_session_native_tool_calls_1` | session_native_tool_calls (session_id, tool_name, native_tool_name) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/plan.rs#L149) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `idx_session_segments_end_ts` | session_segments (end_timestamp) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/plan.rs#L262) | raw timestamp range design; date-wrapped actual chart plans measured below; KEEP |
| `sqlite_autoindex_session_segments_1` | session_segments (session_id, end_timestamp) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L246) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `idx_skill_invocations_ts` | session_skill_invocations (timestamp) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/019_skill_invocations.sql#L48) | declared temporal access; expression plans measured below; KEEP |
| `idx_skill_invocations_name_ts` | session_skill_invocations (normalized_name, timestamp) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/019_skill_invocations.sql#L46) | normalized skill detail equality; COALESCE timestamp caveat; KEEP |
| `sqlite_autoindex_session_skill_invocations_1` | session_skill_invocations (session_id, event_index) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/019_skill_invocations.sql#L5) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `sqlite_autoindex_session_tool_calls_1` | session_tool_calls (session_id, tool_name) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L87) | PK uniqueness + session-prefix join/replace/delete/FK; KEEP |
| `idx_sessions_source` | sessions (source) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/plan.rs#L142) | source prune/purge/diagnostics and filtering; KEEP |
| `idx_sessions_nonempty_updated_at` | sessions (updated_at DESC) partial | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L380) | exact nonempty list predicate + newest order; KEEP |
| `idx_sessions_repo_updated` | sessions (repository, updated_at) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L376) | repository list/filter + newest order; KEEP |
| `idx_sessions_updated_at` | sessions (updated_at) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L118) | newest session list; KEEP |
| `sqlite_autoindex_sessions_1` | sessions (id) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L4) | PK uniqueness + exact key lookup/upsert; KEEP |
| `sqlite_autoindex_sessions_fts_config_1` | sessions_fts_config (k) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L208) | FTS engine segment/config key; KEEP |
| `sqlite_autoindex_sessions_fts_idx_1` | sessions_fts_idx (segid, term) | [definition](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L208) | FTS engine segment/config key; KEEP |


INTEGER PRIMARY KEY rowid aliases (search_content.id, session_incidents.id and FTS _data/_docsize.id) have no separate named PK index. External provider todo/dependency PK definitions are linked in the import SQL section above; arbitrary provider-owned indexes are discovered via PRAGMA index_list/index_info.

## Measured named-index selection

The mapping below derives from all 136 executed SELECT EQPs and 23 writer/freshness/maintenance EXPLAIN-only EQPs in [query-plans.md](query-plans.md), using SQLite 3.42.0. Counts mean **distinct tested SQL shapes whose plan names this index**, not query invocations, traversed rows or workload frequency. Executed SELECTs and merely explained mutation statements are separate. A plan may select different indexes for different parameters/statistics/runtime; this is one corpus and its frozen statistics.

All 34 named indexes from the reconstructed current schema are listed. **Not selected by name in these bounded plans is not unused-index proof.** Constraints still enforce identities and writers still maintain their b-trees. FTS shadow PKs are used inside the virtual-table engine and generally are not exposed as named indexes in outer EQP. INTEGER PRIMARY KEY rowid aliases have no separate named index; rowid searches and FTS virtual-table index operations remain relevant implicit access paths.

| Named index | Table | Executed SELECT shapes | EXPLAIN-only shapes | Example selected/explained shapes | Observation / decision |
| --- | --- | --- | --- | --- | --- |
| `sqlite_autoindex_maintenance_state_1` | `maintenance_state` | 0 | 1 | [maintenance-read](query-plans.md#maintenance-read) | Selected only by explained shape(s); KEEP, mutation cost was not timed here. |
| `idx_search_content_session_event` | `search_content` | 21 | 2 | [browse-all-count](query-plans.md#browse-all-count), [browse-all-facet-repo](query-plans.md#browse-all-facet-repo), [browse-all-totals](query-plans.md#browse-all-totals) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_search_content_session_ts_type` | `search_content` | 10 | 0 | [browse-type-facet-repo](query-plans.md#browse-type-facet-repo), [browse-repo-facet-type](query-plans.md#browse-repo-facet-type), [browse-session-page](query-plans.md#browse-session-page) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_search_content_type_ts` | `search_content` | 6 | 0 | [browse-all-facet-type](query-plans.md#browse-all-facet-type), [browse-type-page](query-plans.md#browse-type-page), [browse-type-count](query-plans.md#browse-type-count) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_search_content_tool` | `search_content` | 3 | 0 | [browse-all-facet-tool](query-plans.md#browse-all-facet-tool), [browse-tool-page](query-plans.md#browse-tool-page), [browse-tool-count](query-plans.md#browse-tool-count) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_search_content_timestamp` | `search_content` | 4 | 0 | [browse-all-page](query-plans.md#browse-all-page), [browse-date-page](query-plans.md#browse-date-page), [browse-excluded-page](query-plans.md#browse-excluded-page) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_search_fts_config_1` | `search_fts_config` | 0 | 0 | None by name in this bounded set | Not named by outer EQP; FTS engine-managed constraint/storage, KEEP. |
| `sqlite_autoindex_search_fts_idx_1` | `search_fts_idx` | 0 | 0 | None by name in this bounded set | Not named by outer EQP; FTS engine-managed constraint/storage, KEEP. |
| `sqlite_autoindex_session_activity_1` | `session_activity` | 1 | 2 | [analytics-query_tool_analysis-2-filtered](query-plans.md#analytics-query_tool_analysis-2-filtered) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_agent_runs_started` | `session_agent_runs` | 0 | 0 | None by name in this bounded set | Not selected by name in this bounded set; source role/constraint audit remains necessary, KEEP. |
| `idx_agent_runs_name_started` | `session_agent_runs` | 0 | 0 | None by name in this bounded set | Not selected by name in this bounded set; source role/constraint audit remains necessary, KEEP. |
| `sqlite_autoindex_session_agent_runs_1` | `session_agent_runs` | 2 | 2 | [analytics-load_runs-1](query-plans.md#analytics-load_runs-1), [analytics-sessions_with_unfinished_runs-1](query-plans.md#analytics-sessions_with_unfinished_runs-1) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_session_agent_selections_1` | `session_agent_selections` | 1 | 2 | [analytics-query_selections-1](query-plans.md#analytics-query_selections-1) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_session_cache_ttls_1` | `session_cache_ttls` | 0 | 2 | [session-delete](query-plans.md#session-delete), [session_cache_ttls-replace-delete](query-plans.md#session_cache_ttls-replace-delete) | Selected only by explained shape(s); KEEP, mutation cost was not timed here. |
| `sqlite_autoindex_session_cache_windows_1` | `session_cache_windows` | 1 | 2 | [analytics-query_prompt_cache-1-filtered](query-plans.md#analytics-query_prompt_cache-1-filtered) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_session_format_observations_1` | `session_format_observations` | 1 | 2 | [analytics-format_diagnostics-2](query-plans.md#analytics-format_diagnostics-2) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_session_incidents_type` | `session_incidents` | 0 | 0 | None by name in this bounded set | Not selected by name in this bounded set; source role/constraint audit remains necessary, KEEP. |
| `idx_session_incidents_session` | `session_incidents` | 0 | 2 | [session-delete](query-plans.md#session-delete), [session_incidents-replace-delete](query-plans.md#session_incidents-replace-delete) | Selected only by explained shape(s); KEEP, mutation cost was not timed here. |
| `sqlite_autoindex_session_model_metrics_1` | `session_model_metrics` | 7 | 2 | [analytics-query_analytics-1](query-plans.md#analytics-query_analytics-1), [analytics-query_analytics-1-filtered](query-plans.md#analytics-query_analytics-1-filtered), [analytics-query_analytics-2](query-plans.md#analytics-query_analytics-2) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_session_modified_files_1` | `session_modified_files` | 5 | 2 | [analytics-query_code_impact-2-filtered](query-plans.md#analytics-query_code_impact-2-filtered), [analytics-query_code_impact-3](query-plans.md#analytics-query_code_impact-3), [analytics-query_code_impact-3-filtered](query-plans.md#analytics-query_code_impact-3-filtered) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_session_native_tool_calls_1` | `session_native_tool_calls` | 2 | 2 | [analytics-query_native_tools-1](query-plans.md#analytics-query_native_tools-1), [analytics-query_native_tools-1-filtered](query-plans.md#analytics-query_native_tools-1-filtered) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_session_segments_end_ts` | `session_segments` | 1 | 0 | [segments-raw-range-diagnostic](query-plans.md#segments-raw-range-diagnostic) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_session_segments_1` | `session_segments` | 4 | 2 | [analytics-query_model_usage_by_day-1-filtered](query-plans.md#analytics-query_model_usage_by_day-1-filtered), [analytics-query_model_usage_by_day-2](query-plans.md#analytics-query_model_usage_by_day-2), [analytics-query_model_usage_by_day-2-filtered](query-plans.md#analytics-query_model_usage_by_day-2-filtered) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_skill_invocations_ts` | `session_skill_invocations` | 0 | 0 | None by name in this bounded set | Not selected by name in this bounded set; source role/constraint audit remains necessary, KEEP. |
| `idx_skill_invocations_name_ts` | `session_skill_invocations` | 0 | 0 | None by name in this bounded set | Not selected by name in this bounded set; source role/constraint audit remains necessary, KEEP. |
| `sqlite_autoindex_session_skill_invocations_1` | `session_skill_invocations` | 1 | 2 | [analytics-load_invocations-1](query-plans.md#analytics-load_invocations-1) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_session_tool_calls_1` | `session_tool_calls` | 3 | 2 | [analytics-query_tool_analysis-1](query-plans.md#analytics-query_tool_analysis-1), [analytics-query_tool_analysis-1-filtered](query-plans.md#analytics-query_tool_analysis-1-filtered), [analytics-query_calls_by_day-1-filtered](query-plans.md#analytics-query_calls_by_day-1-filtered) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_sessions_source` | `sessions` | 28 | 1 | [browse-source-page](query-plans.md#browse-source-page), [browse-source-count](query-plans.md#browse-source-count), [browse-source-facet-type](query-plans.md#browse-source-facet-type) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_sessions_nonempty_updated_at` | `sessions` | 1 | 0 | [list-nonempty](query-plans.md#list-nonempty) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_sessions_repo_updated` | `sessions` | 11 | 0 | [browse-all-facet-repo](query-plans.md#browse-all-facet-repo), [browse-type-facet-repo](query-plans.md#browse-type-facet-repo), [browse-repo-page](query-plans.md#browse-repo-page) | Selected for the examples; KEEP with evidenced reader role. |
| `idx_sessions_updated_at` | `sessions` | 2 | 0 | [list-all](query-plans.md#list-all), [list-branch](query-plans.md#list-branch) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_sessions_1` | `sessions` | 81 | 4 | [browse-all-page](query-plans.md#browse-all-page), [browse-all-count](query-plans.md#browse-all-count), [browse-all-facet-type](query-plans.md#browse-all-facet-type) | Selected for the examples; KEEP with evidenced reader role. |
| `sqlite_autoindex_sessions_fts_config_1` | `sessions_fts_config` | 0 | 0 | None by name in this bounded set | Not named by outer EQP; FTS engine-managed constraint/storage, KEEP. |
| `sqlite_autoindex_sessions_fts_idx_1` | `sessions_fts_idx` | 0 | 0 | None by name in this bounded set | Not named by outer EQP; FTS engine-managed constraint/storage, KEEP. |


Production date-wrapped chart queries must be compared with the actual expression-wrapped shapes, not only the raw-range migration diagnostic. The [controlled expression-index experiment](experiments.md#segment-day-expression-index) changed the chart plan and preserved full histograms but was deferred on absolute benefit and write cost. [Pending aggregate join removal](experiments.md#conditional-session-join-removal) improves the selected content-only query plans without adding a search index.
