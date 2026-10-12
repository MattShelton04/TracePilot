# Controlled query and index experiments

The disposable-copy diagnostics completed on production main `d95f6d81d8a27f9ee3b18967f00b81d76c25e723`, using **SQLite 3.42.0** and warm caches. All eight join-removal shapes preserved complete duplicate-sensitive result multisets across warmups and five measured samples per side. Both FTS external-content integrity checks (`rank=1`) passed before and after, foreign-key checks found zero violations, and the frozen original remained byte-identical. Actual rows/bindings and content-derived hashes remain private. These are SQL diagnostics, not native application timings.

## Conditional session-join removal

Pending [PR #1022](https://github.com/MattShelton04/TracePilot/pull/1022) supplies this behavior: content-only counts/type/tool/totals may omit sessions, while repository/source filters and metadata hydration retain it. Each shape had one warmup per side, then five alternating AB/BA pairs on the same unchanged clone. Query timers include execute/fetch and exclude hashing. Full before/after plans were retained privately. Baseline shape/plans and corpus counts are also in [query-plans.md](query-plans.md).

| Shape | Baseline median [min–max] ms | Candidate median [min–max] ms | Complete multiset |
| --- | --- | --- | --- |
| `browse-all-count` | 66.963 [63.605–79.646] | 19.063 [7.621–19.206] | equal |
| `browse-type-facet-tool` | 0.822 [0.816–0.847] | 0.823 [0.814–0.899] | equal |
| `browse-tool-count` | 213.136 [212.413–223.583] | 11.864 [8.389–11.996] | equal |
| `browse-session-totals` | 2.493 [2.449–2.558] | 2.480 [2.428–2.520] | equal |
| `fts-common-totals` | 120.572 [103.713–122.995] | 104.167 [96.126–110.987] | equal |
| `fts-no-results-totals` | 0.083 [0.082–0.090] | 0.084 [0.083–0.085] | equal |
| `browse-all-facet-type` | 1,153.052 [1,110.416–1,170.249] | 69.505 [46.632–83.141] | equal |
| `browse-all-facet-tool` | 855.130 [793.601–1,311.791] | 56.804 [43.246–61.176] | equal |


Baseline corpus checks establish 679,345 total chunks, 213,579 chunks for the privately selected frequent tool, 22,761 chunks in the selected session, 34,375 common-term matches and zero empty-term matches. The type-filtered tool facet returns no groups because that message type has no tool-name values in this scope. It is an empty facet case, not evidence for a populated tool facet.

The large unfiltered facets and frequent-tool count show a clear diagnostic opportunity; the selective-session and empty queries show little difference. Keep this evidence attached to the already-open #1022, with the enforced parent FK as its semantic premise. It supplies no reason to add another search index, and no new production behavior is attributed to main.

## Segment-day expression index

The disposable candidate was `CREATE INDEX audit_segments_end_day ON session_segments(date(end_timestamp))`. The actual token day query retained its sessions join, nonempty-session predicate, date-wrapped parent range with undated fallback, date-wrapped segment range, non-NULL bucket, GROUP BY and ORDER BY. The copy contains **715 segment rows**. Wide/one-day/empty boundaries were chosen privately; no dates are published. Baseline warmup plus five samples preceded DDL, then candidate warmup plus five samples. These phases were not interleaved. All complete output histograms remained equal.

| Range | Result days | Baseline median [min–max] ms | Candidate median [min–max] ms | Saved median ms |
| --- | --- | --- | --- | --- |
| wide | 107 | 1.584 [1.579–1.619] | 1.151 [0.993–1.171] | 0.434 |
| one-day | 1 | 0.241 [0.238–0.276] | 0.087 [0.085–0.105] | 0.155 |
| empty | 0 | 0.206 [0.203–0.364] | 0.072 [0.067–0.078] | 0.134 |


The baseline scans segments and uses a temporary grouping b-tree. The candidate uses an expression range search and removes that grouping b-tree in this runtime:

```text
10 / 0: SCAN m
21 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
48 / 0: USE TEMP B-TREE FOR GROUP BY
```

```text
11 / 0: SEARCH m USING INDEX audit_segments_end_day (<expr>>? AND <expr><?)
21 / 0: SEARCH s USING INDEX sqlite_autoindex_sessions_1 (id=?)
```

Index DDL took **6.483 ms**. Immediate used-page growth was **24,576 bytes** with **0 bytes** file growth because free pages were reused. Final exact dbstat on SQLite 3.50.4 attributed **5 b-tree pages / 20,480 bytes** to the candidate (10,725 payload, 7,554 slack). Comparing all b-trees accounts for the total delta: five candidate-index pages (**20,480 bytes**) plus one expanded sqlite_schema page (**4,096 bytes**, 24,576→28,672); no other b-tree changed. The 24,576-byte database delta is therefore not the candidate index size.

| Bounded replacement/rollback | Rows | Median [min–max] ms |
| --- | --- | --- |
| Baseline | 715 | 12.418 [11.298–13.733] |
| Expression index | 715 | 14.119 [13.023–15.920] |


Each maintenance side had one warmup and five measured rollback transactions; rowid and every selected row column were restored exactly. The timer includes DELETE, per-row Python INSERT calls and rollback. It excludes parsing, extraction, whole-index transactions and native refresh behavior. This is a bounded maintenance microbenchmark, not whole-index throughput.

**Defer this index.** It saved about 0.434 ms for the wide chart and 0.155 ms for one day on this small table, while the bounded replacement median increased by 1.701 ms. The changed plan establishes an access-path benefit, but the absolute gains, phased design and alternate runtime do not justify a schema migration PR. Revisit only with larger representative segment tables and native runtime/write-workflow confirmation.

The [day-bucket builder](https://github.com/MattShelton04/TracePilot/blob/d95f6d81d8a27f9ee3b18967f00b81d76c25e723/crates/tracepilot-indexer/src/index_db/analytics_queries/day_bucket.rs#L80) supplies the expression-wrapped workload. Existing raw timestamp indexes remain KEEP; expression mismatch alone was never treated as unused-index proof. Rejected statement-reuse/full-FTS experiments were not repeated.

## Full candidate SQL for the eight join comparisons

Each candidate below uses exactly the baseline projection, filters, grouping, ordering, limit, parameter order and private-selector rules. Only `JOIN sessions s ON s.id = sc.session_id` is removed; none of these projections/filters needs a sessions value. The linked baseline section supplies public synthetic parameter templates, selector SQL, cardinalities and observed plans. Actual private replacement values are withheld. These candidates were executed only on the disposable copy.

### Candidate browse-all-count

[Full baseline shape and parameter assumptions](query-plans.md#browse-all-count).

```sql
SELECT COUNT(*) FROM search_content sc WHERE 1=1
```

### Candidate browse-type-facet-tool

[Full baseline shape and parameter assumptions](query-plans.md#browse-type-facet-tool).

```sql
SELECT sc.tool_name, COUNT(*) FROM search_content sc WHERE sc.content_type IN (?) AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```

### Candidate browse-tool-count

[Full baseline shape and parameter assumptions](query-plans.md#browse-tool-count).

```sql
SELECT COUNT(*) FROM search_content sc WHERE sc.tool_name IN (?)
```

### Candidate browse-session-totals

[Full baseline shape and parameter assumptions](query-plans.md#browse-session-totals).

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_content sc WHERE sc.session_id = ?
```

### Candidate fts-common-totals

[Full baseline shape and parameter assumptions](query-plans.md#fts-common-totals).

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid WHERE search_fts MATCH ?
```

### Candidate fts-no-results-totals

[Full baseline shape and parameter assumptions](query-plans.md#fts-no-results-totals).

```sql
SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts JOIN search_content sc ON sc.id = search_fts.rowid WHERE search_fts MATCH ?
```

### Candidate browse-all-facet-type

[Full baseline shape and parameter assumptions](query-plans.md#browse-all-facet-type).

```sql
SELECT sc.content_type, COUNT(*) FROM search_content sc WHERE 1=1 GROUP BY sc.content_type ORDER BY COUNT(*) DESC
```

### Candidate browse-all-facet-tool

[Full baseline shape and parameter assumptions](query-plans.md#browse-all-facet-tool).

```sql
SELECT sc.tool_name, COUNT(*) FROM search_content sc WHERE 1=1 AND sc.tool_name IS NOT NULL GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT ?
```
