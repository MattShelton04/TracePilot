# Search schema and lifecycle

Production source: `d95f6d81d8a27f9ee3b18967f00b81d76c25e723`. The current reconstructed schema has **11 search-related tables and 36 visible/hidden xinfo columns**: search_content (9), search_fts (3), sessions_fts (6), and four shadow tables per virtual table (9 columns each). This is source/schema coverage, not production occupancy or application timing evidence. Per-column meanings and exact repository references are in [semantics-search.json](semantics-search.json); [queries.md](queries.md) lists actual SQL call sites, templates, binding order and index roles.

## Content and identity

Each search_content row is a chunk, not necessarily a complete event or unique `(session_id,event_index)` pair. A single event may yield message and reasoning, or multiple system notifications. The [extractor](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/content_extraction/extractor.rs#L41) stores canonical event-array positions and reconstructed turn ownership. Nullable turn/event/timestamp fields preserve missing data. `id` aliases the SQLite rowid and is AUTOINCREMENT; it is an index-row identity that changes when a session is replaced. `session_id` joins a provider session, `tool_name` stays canonical and native spelling is an optional JSON annotation. Foreign-key deletion cascades from sessions; the FK does not require event indexes to be unique.

The [v9 schema](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L269) checks eleven content kinds and rejects whitespace-only text. The active extractor emits user/assistant/reasoning/tool call/result/error/session error/compaction/system/subagent rows. `checkpoint` remains allowed without a current emitted match arm; that fact alone does not establish safe removal. Canonical events decide eligibility: prompt attachments and native-only bookkeeping remain outside this search text. Search is therefore not a lossless copy of source logs.

Text limits in [extraction limits](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/content_extraction/limits.rs#L2) are UTF-8 bytes: calls/errors 2,000, tool results 800, compaction/system 3,000, assistant 5,000, reasoning 4,000. The shown user-message path clones full content. Tool skip lists remove both call/result rows or only boilerplate results. In production tool JSON is flattened before truncation; bounded extraction work on a pending branch does not change this pinned description. Native metadata is written with `nativeToolName`; other rows may annotate checkpoint number or system role. SQL JSON readers guard json_valid; metadata is not an indexed generic search field.

## Query and display contract

[Production deep search](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/query_builder.rs#L249) always joins search_fts→search_content→sessions for MATCH and search_content→sessions for browse. Empty/sanitized-empty input falls back to browse. The type-weighted relevance expression uses FTS rank; newest/oldest use nullable timestamp ordering. Page+count execute separately. Facets remove their own positive dimension filter, retain all other filters, and count chunks rather than sessions; totals also count distinct session IDs. Repository/source metadata is read from the parent session instead of being duplicated in each chunk.

[Row decoding](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/sanitize.rs#L7) fixes the page projection positions. Highlight sentinels are converted after escaping HTML; browse preview is 200 SQLite characters. [Context lookup](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_reader/stats.rs#L218) first finds the result's session/event position, then reads strict lower and higher event indexes (300-character previews, radius cap 10). Chunks at the same event index are excluded from adjacent context. NULL seed event indexes fall back to zero. [Search cards](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/apps/desktop/src/components/search/SearchResultCard.vue#L43) use result identity for expansion, while [navigation](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/apps/desktop/src/composables/useSearchPaletteController.ts#L165) uses session, turn and event positions to reveal conversation content.

Session metadata FTS remains a separate lightweight index over id/summary/repository/branch. [Toolbar search](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/session_reader.rs#L185) joins by sessions.rowid, which differs from the TEXT business id; it hydrates explicit session columns and sorts updated_at descending/id ascending. Metadata writes trigger FTS updates even if only a non-FTS session column changed. The ID-only library API is also retained, though an established IPC consumer uses hydrated session search.

## Synchronization and failure boundaries

[Per-session replacement](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/search_writer/mod.rs#L204) validates source ownership, deletes old chunks, temporarily removes only the insert trigger, writes bounded multi-row VALUES batches and indexes new IDs with one INSERT SELECT. MAX(id) before insertion plus AUTOINCREMENT identifies those rows. Delete/update sync triggers remain active. Standalone transaction or shared-batch savepoint atomically protects content, FTS, trigger restoration and successful search marker/fingerprint. Cancelled or failed preparation keeps last-good rows; a failed transaction rolls back. Staleness compares successful source search fingerprint and source-specific extractor version, separately from metadata freshness. Source guard prevents another provider overwriting an existing session identifier.

[Adaptive bulk choice](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/indexing/search.rs#L32) requires at least 10 prepared sessions and new_rows×5 >= existing_rows. The bulk writer drops all three search sync triggers within its transaction, replaces requested sessions and rebuilds the entire FTS index, then restores triggers before commit. The existing-row COUNT occurs for each prepared write batch. This whole-path behavior matters when evaluating indexing changes; rejected statement reuse/full-FTS experiments are not recommendations.

[v6](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L156) replaced older metadata/conversation FTS and created deep content. [v9](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/sql.rs#L261) recreated deep content and FTS, added tool_result/nonblank guard, changed indexes, set automerge 8, and invalidated search markers. [Column hooks](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/migrations/columns.rs#L8) ensure markers before v9 and on every open. Extractor-version changes re-extract from source; v21 separates successful metadata/search fingerprints, v22 adds source identity. Current schema is v25 with the retired v12 gap; older ADR counts are historical.

## Engine-owned storage and validation

Both FTS tables use external content. They have hidden table-name and rank interfaces plus implicit rowid. Each owns _data(id,block), _idx(segid,term,pgno), _docsize(id,sz) and _config(k,v). _idx/_config are WITHOUT ROWID; _data/_docsize integer keys alias rowid. There is no _content shadow table here. Segment payloads, token sizes and configuration are SQLite internals used by MATCH, ranking and writes. They must not be judged unused because application SQL lacks direct references. See [SQLite FTS5 storage](https://www.sqlite.org/fts5.html#fts5_data_structures).

Non-MATCH external-content reads fetch backing content. Consequently equal `COUNT(*)` from content and FTS does not verify term postings. The current health method compares those counts and pending markers; its integrity command omits the external-content comparison parameter. A separately controlled audit should use the stronger engine check on a disposable copy, retain complete query-result equality and validate triggers/FKs. See [SQLite external-content caveats](https://www.sqlite.org/fts5.html#external_content_table_pitfalls) and [integrity-check](https://www.sqlite.org/fts5.html#the_integrity_check_command).

Pending #1022 conditionally removes sessions joins for content-only aggregates, keeping them for repository/source filters, hydration and repository facets. Its production predecessor is documented here; measured pending-PR gains are not main behavior. Main, candidate and combined revisions must retain separate schema/plan/provenance records. Frozen plans from a different SQLite runtime are diagnostic evidence; they do not establish the bundled app's selected plans or latency.


## Frozen evidence and retained purpose

The snapshot has **679,345 chunks across 510 sessions with content**. Deep search_content occupies **336,801,792 bytes (58.20% of the database)**; its five secondary indexes **124,141,568 bytes**, and deep FTS shadow b-trees **94,396,416 bytes**. Together they account for **555,339,776 bytes / 95.96%** of the database. This identifies the main storage cost without double-counting virtual external-content text. These allocations include b-tree headers/slack/overflow; logical column text bytes are not reclaimable-page estimates. See [storage](storage.md) and [statistics](statistics.md#search_content).

Every measured search column retains the source/engine purpose below. Sparsity, zero counts and constant computed hidden handles do not justify removal. All 36 columns have exact source references and measured facts in [semantics-search.json](semantics-search.json). Ranking observations outside MATCH and virtual external-content reads need their runtime interpretation. Both external-content integrity checks passed on the disposable experiment copy; current health COUNT equality remains a weaker check.

| Table.column | NULL | Non-NULL | Distinct non-NULL | Logical text/BLOB bytes | Decision and purpose |
| --- | --- | --- | --- | --- | --- |
| `search_content.id` | 0 | 679,345 | 679,345 | 0 | KEEP: FTS rowid join, current result identity, context and incremental FTS insertion. |
| `search_content.session_id` | 0 | 679,345 | 510 | 24,456,420 | KEEP: Parent join, source metadata hydration, session filter, context grouping and cascade scope. |
| `search_content.content_type` | 0 | 679,345 | 10 | 7,181,721 | KEEP: Display badges/grouping, include/exclude filters, facet totals and relevance weights. |
| `search_content.turn_number` | 50 | 679,295 | 3,095 | 0 | KEEP: Conversation navigation and user-visible turn labels; NULL cannot safely become zero. |
| `search_content.event_index` | 0 | 679,345 | 30,009 | 0 | KEEP: Precise conversation deep links and efficient context inequalities/order. |
| `search_content.timestamp_unix` | 0 | 679,345 | 229,675 | 0 | KEEP: Search date filters, chronology and displayed relative/event time. |
| `search_content.tool_name` | 115,254 | 564,091 | 81 | 3,376,254 | KEEP: Canonical tool filters, indexed picker counts, native label fallback and skill-call discovery. |
| `search_content.content` | 0 | 679,345 | 499,074 | 245,907,291 | KEEP: FTS term source, browse/context previews and normalized recent skill-name discovery. |
| `search_content.metadata_json` | 613,555 | 65,790 | 84 | 1,672,254 | KEEP: Native provider tool labels and source-compatible annotations; NULL is valid for simple text. |
| `search_fts.content` | 0 | 679,345 | 499,074 | 245,907,291 | KEEP: MATCH metadata/content access is an implicit reader even when projection does not mention this column. |
| `search_fts.search_fts` | 0 | 679,345 | 1 | 0 | KEEP: Required engine handle for full-text matching and synchronization/maintenance. |
| `search_fts.rank` | 679,345 | 0 | 0 | 0 | KEEP: Engine-managed hidden interface; absence of direct sessions rank sorting does not justify dropping an FTS column. |
| `search_fts_config.k` | 0 | 2 | 2 | 16 | KEEP: Required config engine storage; no direct SQL reference is expected. |
| `search_fts_config.v` | 0 | 2 | 2 | 0 | KEEP: Required config engine storage; no direct SQL reference is expected. |
| `search_fts_data.id` | 0 | 21,946 | 21,946 | 0 | KEEP: Required data engine storage; no direct SQL reference is expected. |
| `search_fts_data.block` | 0 | 21,946 | 21,946 | 85,973,255 | KEEP: Required data engine storage; no direct SQL reference is expected. |
| `search_fts_docsize.id` | 0 | 679,345 | 679,345 | 0 | KEEP: Required docsize engine storage; no direct SQL reference is expected. |
| `search_fts_docsize.sz` | 0 | 679,345 | 896 | 723,650 | KEEP: Required docsize engine storage; no direct SQL reference is expected. |
| `search_fts_idx.segid` | 0 | 7,767 | 7 | 0 | KEEP: Required idx engine storage; no direct SQL reference is expected. |
| `search_fts_idx.term` | 0 | 7,767 | 7,032 | 59,087 | KEEP: Required idx engine storage; no direct SQL reference is expected. |
| `search_fts_idx.pgno` | 0 | 7,767 | 6,396 | 0 | KEEP: Required idx engine storage; no direct SQL reference is expected. |
| `sessions_fts.id` | 0 | 729 | 729 | 26,244 | KEEP: MATCH metadata/content access is an implicit reader even when projection does not mention this column. |
| `sessions_fts.summary` | 219 | 510 | 445 | 22,112 | KEEP: MATCH metadata/content access is an implicit reader even when projection does not mention this column. |
| `sessions_fts.repository` | 110 | 619 | 11 | 14,826 | KEEP: MATCH metadata/content access is an implicit reader even when projection does not mention this column. |
| `sessions_fts.branch` | 98 | 631 | 252 | 10,956 | KEEP: MATCH metadata/content access is an implicit reader even when projection does not mention this column. |
| `sessions_fts.sessions_fts` | 0 | 729 | 1 | 0 | KEEP: Required engine handle for full-text matching and synchronization/maintenance. |
| `sessions_fts.rank` | 729 | 0 | 0 | 0 | KEEP: Engine-managed hidden interface; absence of direct sessions rank sorting does not justify dropping an FTS column. |
| `sessions_fts_config.k` | 0 | 1 | 1 | 7 | KEEP: Required config engine storage; no direct SQL reference is expected. |
| `sessions_fts_config.v` | 0 | 1 | 1 | 0 | KEEP: Required config engine storage; no direct SQL reference is expected. |
| `sessions_fts_data.id` | 0 | 61 | 61 | 0 | KEEP: Required data engine storage; no direct SQL reference is expected. |
| `sessions_fts_data.block` | 0 | 61 | 61 | 224,611 | KEEP: Required data engine storage; no direct SQL reference is expected. |
| `sessions_fts_docsize.id` | 0 | 729 | 729 | 0 | KEEP: Required docsize engine storage; no direct SQL reference is expected. |
| `sessions_fts_docsize.sz` | 0 | 729 | 72 | 2,917 | KEEP: Required docsize engine storage; no direct SQL reference is expected. |
| `sessions_fts_idx.segid` | 0 | 59 | 7 | 0 | KEEP: Required idx engine storage; no direct SQL reference is expected. |
| `sessions_fts_idx.term` | 0 | 59 | 49 | 243 | KEEP: Required idx engine storage; no direct SQL reference is expected. |
| `sessions_fts_idx.pgno` | 0 | 59 | 16 | 0 | KEEP: Required idx engine storage; no direct SQL reference is expected. |


[136 executed SELECT plans](query-plans.md) and [controlled experiments](experiments.md) show the existing search indexes serving browse/tool/session/context paths. Pending #1022 improves the large content-only aggregates on this corpus without another search index. The tested date expression index changed analytics plans but is deferred because its absolute benefit was below half a millisecond and maintenance cost increased in the bounded diagnostic. Main remains unchanged.
