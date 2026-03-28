# Tantivy Benchmarks

> All benchmarks run on production data: **314,403 rows across 174 sessions**.
> Release build (`--release`), Windows, measured via `bench_tantivy.rs` example.

---

## Indexing

| Operation | Time | Throughput |
|-----------|------|------------|
| Full index (314K rows, 174 sessions) | 10.9s | 29,000 rows/sec |
| Incremental upsert (12,529 row session) | 563ms | 22,200 rows/sec |
| └─ upsert phase | 45ms | — |
| └─ commit phase | 515ms | — |
| └─ reader reload | 3ms | — |
| Index build from cold (schema rebuild) | ~11s | Same as full index |

### Indexing Breakdown

The commit phase dominates incremental indexing because Tantivy must:
1. Flush the in-memory segment to disk
2. Merge segments if merge policy triggers
3. Fsync the commit point

During full re-index (174 sessions), each session gets its own commit. Total: 174 commits × ~50ms average = ~8.7s in commit overhead. Batching multiple sessions per commit would reduce this significantly.

## Search Latency

| Query | Hits | Tantivy | FTS5 | Speedup |
|-------|------|---------|------|---------|
| `error` | 12,057 | 1.8ms | 133ms | **72×** |
| `async await` | 2,918 | 1.2ms | 45ms | **36×** |
| `database migration` | 619 | 2.0ms | 15ms | **8×** |
| `fn main` | 566 | 1.0ms | 6ms | **6×** |
| `"exact phrase"` | varies | <2ms | 10-50ms | **5-25×** |
| `config*` (prefix) | 12,726 | 1.5ms | 23ms | **15×** |
| `async AND error` (boolean) | 1,010 | 0.8ms | 33ms | **41×** |
| Browse mode (no query, filters) | all | 3.1ms | 23ms | **7×** |

### Notes
- Tantivy times include snippet generation (highlight extraction)
- FTS5 times include `snippet()` function + JOIN for session metadata
- Tantivy uses BM25 with default k1=1.2, b=0.75
- All searches limited to 50 results (top-K collector)

## Faceted Search (Filtered)

| Operation | Tantivy | FTS5/SQL | Speedup |
|-----------|---------|----------|---------|
| Facets for "error" (12K matches) | 61ms | 201ms | **3.3×** |
| Facets for "async" (2.9K matches) | 48ms | 95ms | **2×** |
| Facets unfiltered (314K docs) | ~200ms | <5ms | **0.025× (40× slower)** |

**Critical finding:** Tantivy facets are fast when filtering (only iterate matching docs). Unfiltered facets require iterating ALL 314K documents — this is where the CPU regression comes from. SQLite's `GROUP BY` with B-tree indexes does unfiltered aggregation in <5ms.

## Aggregation (Fast Fields)

After adding `FAST` flag to STRING fields (schema v2):

| Operation | Time (fast fields) | Time (stored fields) | Improvement |
|-----------|-------------------|---------------------|-------------|
| Content type counts (314K docs) | ~180ms | ~4,200ms | **23×** |
| Repository counts (314K docs) | ~160ms | ~4,000ms | **25×** |
| Tool name distinct (314K docs) | ~150ms | ~3,800ms | **25×** |
| All aggregates combined | ~200ms | ~12,000ms | **60×** |

Fast fields avoid LZ4 stored-document decompression but still iterate every document. The `AggregateCache` eliminates repeated scans (O(1) after first computation) but introduces cache invalidation complexity.

## Disk Usage

| Component | Size |
|-----------|------|
| Tantivy index (314K docs) | **99 MB** |
| SQLite with search_content + FTS5 | **243 MB** |
| SQLite without search_content (after migration) | **5.4 MB** |
| SQLite with search_content (no FTS5, for hybrid approach) | **~150 MB** (estimated) |

### Tantivy Index Composition

| Segment data | Approx. size |
|-------------|-------------|
| Inverted index (postings + positions) | ~35 MB |
| Fast fields (columnar STRING + I64) | ~25 MB |
| Stored fields (LZ4 compressed) | ~30 MB |
| Term dictionary | ~8 MB |
| Metadata + delete bitmaps | ~1 MB |

## Memory Usage

| Component | RSS |
|-----------|-----|
| Tantivy reader (steady state) | 10–30 MB |
| Tantivy writer (during indexing) | 15 MB (heap budget) |
| Tantivy after full index | ~25 MB |
| SQLite FTS5 (page cache, steady state) | 40–60 MB |

Tantivy uses mmap — index pages are demand-paged from disk. The OS manages the page cache. Actual RSS depends on query patterns and OS memory pressure.

## CPU Profile (Observed Issues)

| Scenario | CPU | Root Cause |
|----------|-----|-----------|
| Search page load (cold cache) | 80%+ spike | 4 IPC calls × O(314K) aggregation each |
| Search page load (warm cache) | <5% | Cache serves O(1) |
| During bulk indexing | High sustained | 174 commits, each invalidates cache |
| Idle with search page open | 5-15% | Health polling (5s) + potential cache churn |
| Idle without search page | ~0% | No polling, no queries |

### CPU Root Cause Analysis

The search page makes these IPC calls on mount:
1. `get_search_stats` — needs total rows, session counts, content type breakdown
2. `get_search_filter_options` — needs distinct tool names
3. `get_search_facets` — needs content type and repository counts
4. `fts_health` — needs total docs, segment info

When all 4 hit a cold cache (e.g., right after a commit), each triggers a full O(314K) scan via `compute_aggregate_cache`. Even with the cache, the first caller does ~200ms of CPU work, and during bulk indexing the cache is invalidated on every commit.

**With SQLite:** These 4 queries are simple `COUNT(*)`, `GROUP BY`, and `SELECT DISTINCT` queries with B-tree indexes. Total time: <10ms combined.
