# Retrospective: FTS5 → Tantivy Migration Attempt

> **Date:** 2026-03-28
> **Branch:** `feat/fst-search-index` (17 commits, not merged)
> **PR:** #200

---

## Summary

We attempted to replace SQLite FTS5 (`search_content` + `search_fts` tables, ~243 MB) with Tantivy as the sole full-text search engine. Search queries worked excellently (6–72× faster). However, aggregation operations (facets, stats, tool names, health checks) caused severe CPU regressions that we could not fully resolve, leading to the decision to shelve the migration.

---

## Timeline

### Phase 1: Analysis & Initial Implementation
- Comprehensive analysis comparing `fst` (BurntSushi) vs `tantivy` (Quickwit)
- `fst` ruled out — it's a set/map data structure, not a search engine
- Built Tantivy module: `schema.rs`, `writer.rs`, `reader.rs`, `mod.rs`
- Dual-write pipeline: SQLite + Tantivy simultaneously
- 3-agent code review (Opus 4.6, GPT 5.4, Codex 5.3) found critical bugs:
  - UTF-8 panic in snippet generation
  - `id:0` field (Tantivy auto-assigned) confused with actual doc IDs
  - Dual-write data loss on partial failure
  - 500K facet cap too high

### Phase 2: FTS5 Removal — Tantivy as Sole Store
- Removed dual-write, made Tantivy the only search store
- Dropped `search_fts` table (Migration 10), then `search_content` table (Migration 11)
- Squashed into single Migration 10+11
- Routed ALL Tauri search commands through Tantivy
- SQLite DB: 243 MB → 5.4 MB
- Tantivy index: 99 MB on disk

### Phase 3: CPU Crisis — Aggregation Performance
- **Problem:** Facets, stats, tool_names, health each did O(n) full document store reads (LZ4 decompression per doc × 314K docs × 4 IPC calls per page load)
- **Fix attempt 1:** Added `FAST` flag to all STRING fields, bumped schema to v2, rewrote aggregations to use `StrColumn.term_ords()` + `ord_to_str()` (columnar reads, no decompression)
- **Fix attempt 2:** Added `AggregateCache` (RwLock<Option<AggregateCache>>) — computed once after commit, serves O(1) on subsequent reads
- **Fix attempt 3:** Fixed stale reader bug — `commit()` wasn't calling `reader.reload()`, so cache was computed from pre-commit reader state (0 docs)

### Phase 4: Remaining Issues (Unresolved)
- CPU still high on idle / search page navigation
- Health polling, even with 5s interval and conditional check, still triggers cache recomputation at inconvenient times
- Aggregate cache invalidation/recomputation timing is fragile

---

## What Worked Well

### Search Performance (Excellent)

| Query | Tantivy | FTS5 | Speedup |
|-------|---------|------|---------|
| "error" (12K hits) | 1.8ms | 133ms | **72×** |
| "async await" (2.9K hits) | 1.2ms | 45ms | **36×** |
| "database migration" (619 hits) | 2.0ms | 15ms | **8×** |
| "fn main" (566 hits) | 1.0ms | 6ms | **6×** |
| Facets "error" (filtered) | 61ms | 201ms | **3.3×** |

### Indexing Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Full index (314K rows) | 10.9s | 29K rows/sec |
| Incremental (12.5K row session) | 563ms | Delete + insert + commit |
| Index size on disk | 99 MB | vs 243 MB SQLite (59% smaller) |

### Architecture Decisions That Proved Sound
- **Separate struct from IndexDb** — `TantivySearchIndex` is `Send + Sync`, `IndexDb` uses `!Send` rusqlite
- **Session-based upsert** — delete all docs for session, insert new ones, commit
- **Schema versioning** — `tracepilot_meta.json` sidecar triggers full rebuild on mismatch
- **Custom tokenizer** — `tracepilot_unicode` matches FTS5's `unicode61` behaviour
- **Persisted to disk** — mmap'd, survives restarts, ~10-30 MB RSS

### Features That Worked
- Text search with BM25 ranking
- Phrase search (`"exact phrase"`)
- Prefix search (`config*`)
- Boolean operators (AND, OR, NOT)
- Content type / repository / tool name / date range / session filters
- Browse mode (AllQuery + filters + timestamp sort)
- Context expansion (range query by session_id + event_index)
- Snippet highlighting with configurable context
- Fuzzy search (Levenshtein distance) — new capability
- Incremental indexing with crash-safe commit ordering

---

## What Broke

### 1. Aggregation CPU — The Core Problem

**Root cause:** Tantivy has no built-in aggregate/facet counters for non-hierarchical string fields. Every aggregation requires iterating ALL documents in the index.

With FTS5, aggregations were `GROUP BY` SQL queries that SQLite optimized with B-tree indexes. With Tantivy, we had to manually iterate 314K+ documents for each aggregation.

**Progression of the problem:**

1. **First implementation:** Used `searcher.doc(doc_address)` to read stored fields for every doc → LZ4 decompression per doc → ~4 seconds per aggregation × 4 calls = 16+ seconds on page load
2. **Fast field fix:** Switched to `StrColumn.term_ords()` columnar reads → ~200ms per aggregation, but still 4 calls = ~800ms, plus all calls run on IPC thread
3. **Cache fix:** `AggregateCache` computed once, serves O(1) → theoretically solves it, BUT:
4. **Stale reader bug:** `commit()` didn't reload reader → cache computed from empty index → 0 rows, no facets
5. **After reader reload fix:** Cache recomputation still triggers on every commit (174 sessions = 174 commits during full index), and timing of frontend IPC calls vs cache invalidation is fragile

**The fundamental issue:** SQLite's `GROUP BY` with indexes is O(log n) per unique value. Tantivy's fast field iteration is O(n) always. For 314K documents, this matters.

### 2. Reader Reload Timing

Tantivy's `ReloadPolicy::OnCommitWithDelay` does not make committed data visible to readers immediately. There's an async delay (typically <100ms but unpredictable). Any code that reads after commit but before the reader auto-reloads sees stale data.

We fixed this by adding `self.reader.reload()` in `commit()`, but this is a synchronous operation that blocks until all segments are loaded. For large indexes (99 MB, multiple segments), this adds latency to every commit.

### 3. Mmap and Windows

Tantivy uses memory-mapped files. On Windows:
- File locks prevent deletion while the index is open
- `cleanup_index_dir` needed special handling for subdirectories
- Process crashes can leave lock files that prevent reopening
- We added self-healing (wipe and rebuild on open failure), but this means a crash = full re-index

### 4. Cache Invalidation Complexity

The `AggregateCache` design has inherent race conditions:
- `commit()` invalidates cache → next IPC call recomputes → but recomputation takes ~200ms during which other IPC calls also try to compute
- Multiple concurrent IPC calls can all miss the cache and all compute simultaneously
- The `RwLock` prevents data races but not redundant computation
- During bulk indexing (174 sessions), the cache is invalidated 174 times

### 5. Frontend Coupling

The search page makes 4+ IPC calls on mount:
- `get_search_stats`
- `get_search_filter_options` (tool names)
- `get_search_facets` (content types, repositories)
- `fts_health`

Each call independently acquires the cache. If the cache is invalid (just committed), each call triggers a full recomputation. This is the primary source of the CPU spikes on page navigation.

---

## Root Causes

| Issue | Root Cause | Severity |
|-------|-----------|----------|
| High CPU on facets/stats | O(n) document iteration for aggregation (no SQL indexes) | **Critical** |
| Empty facets after indexing | `reader.reload()` not called after `commit()` | High (fixed) |
| CPU spikes on page load | 4+ IPC calls each hitting cold cache after commit | **Critical** |
| CPU on idle | Health polling (5s interval) + potential cache thrashing | Medium |
| Fragile cache invalidation | Lazy computation with no debounce/coalescing | Medium |
| Windows file lock issues | mmap prevents file operations on open index | Low |

---

## Lessons Learned

1. **Tantivy is not a database.** It excels at text search but has no equivalent to SQL's `GROUP BY` with indexed columns. Any feature that needs aggregate counts over the full corpus (facets, stats, health) requires a fundamentally different approach than "query the index."

2. **The dual-write approach was better for stability.** Keeping `search_content` in SQLite for aggregations while using Tantivy only for text search would have avoided the CPU regression entirely. The 243 MB database size is the tradeoff.

3. **Cache invalidation is genuinely hard.** A lazy cache that invalidates on every commit doesn't work well during bulk indexing (174 invalidations). An eager cache (compute in commit) blocks the indexing pipeline. A debounced cache needs careful timing.

4. **Frontend architecture matters.** 4+ parallel IPC calls on page mount means 4+ cache recomputations if the cache is cold. Batching these into a single IPC call would help enormously.

5. **Test against real-world data early.** Unit tests with 3-10 documents don't reveal O(n) aggregation problems. The 314K document production dataset exposed issues that synthetic tests missed.

6. **Reader reload semantics are not obvious.** Tantivy's `OnCommitWithDelay` sounds automatic but the delay is unpredictable. Always call `reader.reload()` explicitly after commit if you need immediate consistency.

7. **Windows mmap adds complexity.** File locks, cleanup semantics, and crash recovery all behave differently on Windows. Test on Windows early and often.
