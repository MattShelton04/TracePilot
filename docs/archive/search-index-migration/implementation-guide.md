# Implementation Guide: FTS5 → Tantivy (Next Attempt)

> This document describes exactly what to do when re-attempting the Tantivy migration. It incorporates all lessons from the first attempt.

---

## Strategy: Hybrid Architecture (Not Full Replacement)

**Do NOT drop `search_content` from SQLite.** Instead, use a dual-store approach:

| Responsibility | Store | Reason |
|---------------|-------|--------|
| Full-text search queries | Tantivy | 6–72× faster, fuzzy search, better BM25 |
| Browse mode (recent events) | Tantivy | Fast timestamp-sorted retrieval |
| Snippet highlighting | Tantivy | Built-in snippet generator |
| Context expansion | Tantivy | Range query by session_id + event_index |
| Facets / aggregation counts | SQLite | `GROUP BY` with B-tree indexes is O(log n) |
| Stats (total rows, session counts) | SQLite | Simple `COUNT(*)` queries, instant |
| Tool name list | SQLite | `SELECT DISTINCT tool_name` with index |
| Health check | SQLite | `COUNT(*)` on search_content |
| Prefix search | Tantivy | Native support |
| Fuzzy search | Tantivy | Levenshtein distance, new capability |

### Why Hybrid Works

- SQLite keeps `search_content` for aggregation (GROUP BY, COUNT, DISTINCT) — these are O(log n) with indexes
- Tantivy handles text search, ranking, snippets — where it's dramatically faster
- The `search_content` table stays ~243 MB, but aggregation queries are sub-millisecond
- Tantivy index adds ~99 MB — total is ~342 MB but CPU stays low
- If disk size is a concern, consider dropping the 6 secondary B-tree indexes on `search_content` that FTS5 used (saves ~50 MB) and only keeping indexes needed for aggregation

### Alternative: Pre-computed Aggregation Table

If the 243 MB `search_content` overhead is unacceptable, consider a lightweight aggregation sidecar:

```sql
CREATE TABLE search_aggregates (
    key TEXT PRIMARY KEY,      -- e.g. 'content_type:tool_call', 'repository:owner/repo'
    dimension TEXT NOT NULL,   -- 'content_type', 'repository', 'tool_name'
    value TEXT NOT NULL,       -- the actual value
    count INTEGER NOT NULL     -- pre-computed count
);
CREATE INDEX idx_search_agg_dim ON search_aggregates(dimension);
```

This table would be ~10 KB and updated incrementally during indexing. All aggregation queries become simple `SELECT` on this table. Tantivy handles only search.

---

## Prerequisites

Before starting, ensure:

1. **Tantivy version:** Use 0.22.x (latest stable). Pin exact version in `Cargo.toml`.
2. **Schema design is final.** Changing the schema requires a full re-index. Get it right first:
   - All STRING fields need `FAST | STORED` (for columnar reads if ever needed)
   - `content` field: `TEXT` with custom tokenizer, `STORED` for snippet generation
   - Integer fields: `FAST | STORED` (for sorting and filtering)
3. **Frontend IPC audit.** Before implementing, catalogue every IPC call the search page makes and plan which ones hit Tantivy vs SQLite.

---

## Step-by-Step Implementation

### Step 1: Tantivy Module (No Pipeline Changes)

Create `crates/tracepilot-indexer/src/tantivy_index/` with:

```
tantivy_index/
├── mod.rs      # TantivySearchIndex struct, lifecycle, public API
├── schema.rs   # Field definitions, custom tokenizer, schema versioning
├── writer.rs   # SearchContentRow → Document mapping, session upsert, commit
└── reader.rs   # Query execution, snippet gen, context expansion, result types
```

**Key design decisions:**

- `TantivySearchIndex` must be `Send + Sync` (Tauri state requirement)
- `IndexWriter` behind `Arc<Mutex<>>` — only one writer at a time
- `IndexReader` is `Clone + Send + Sync` — share freely
- Use `ReloadPolicy::OnCommitWithDelay` BUT always call `reader.reload()` explicitly after commit
- Writer heap budget: 15 MB minimum (Tantivy requirement)
- Persist to `<data_dir>/search_index/` alongside `index.db`

**Schema versioning:**

Store a `tracepilot_meta.json` sidecar file in the index directory:

```json
{
  "schema_version": 1,
  "extractor_version": 6,
  "created_at": "2026-03-28T00:00:00Z",
  "last_commit_at": null,
  "document_count": 0
}
```

On startup, if `schema_version` or `extractor_version` doesn't match the code, wipe the directory and rebuild. Set `was_rebuilt = true` so the Tauri plugin resets `search_indexed_at` for all sessions.

**Tests at this point:**
- Create empty index, verify 0 docs
- Add documents, commit, verify search works
- Reopen persisted index, verify data survives
- Schema version mismatch triggers rebuild

### Step 2: Dual-Write Pipeline

Modify `reindex_search_content` and `rebuild_search_content` in `lib.rs`:

```rust
// For each session:
// 1. Extract rows (existing logic)
// 2. Write to SQLite search_content (existing logic)
// 3. Write to Tantivy via upsert_session
// 4. Commit Tantivy
// 5. Mark search_indexed_at in SQLite (AFTER Tantivy commit)
```

**Critical: commit ordering.** `mark_search_indexed` must happen AFTER `tantivy.commit()` succeeds. If the app crashes between Tantivy write and SQLite update, the session will be re-indexed on next startup (safe). The reverse (SQLite marked but Tantivy lost) causes permanent desync.

**Do NOT remove any existing SQLite writes.** This is additive only.

**Tests at this point:**
- Full reindex writes to both stores
- Verify Tantivy doc count matches SQLite row count
- Crash simulation: kill between Tantivy commit and SQLite update → session re-indexed on restart

### Step 3: Route Search Commands Through Tantivy

In `commands/search.rs`, change these commands to use Tantivy:

| Command | Change |
|---------|--------|
| `search_fts` | Tantivy `search()` → SQLite `batch_session_metadata()` for hydration |
| `search_fts_count` | Tantivy `count()` |
| `get_result_context` | Tantivy range query by session_id + event_index |

**Keep these on SQLite:**

| Command | Reason |
|---------|--------|
| `get_search_facets` | `GROUP BY content_type` / `GROUP BY repository` on search_content |
| `get_search_stats` | `COUNT(*)` on search_content |
| `get_search_tool_names` | `SELECT DISTINCT tool_name` from search_content |
| `fts_health` | `COUNT(*)` on search_content |
| `get_search_filter_options` | Combination of above |

**Result hydration pattern:**

```
User query → Tantivy search → Vec<TantivyHit> (session_id, event_index, score, snippet)
           → batch_session_metadata(session_ids) → HashMap<session_id, SessionMeta>
           → merge into final Vec<SearchResult>
```

SQLite `sessions` table provides: summary, repository, branch, model_name, created_at, updated_at, etc.

**Tests at this point:**
- Search results match between Tantivy and old FTS5 path (parallel query comparison)
- Snippets contain query terms
- Browse mode returns results sorted by timestamp descending
- Filters (content_type, repository, tool_name, date range) all work
- Context expansion returns correct surrounding events

### Step 4: Drop FTS5 Virtual Table Only

Add a migration to drop `search_fts` (the FTS5 virtual table) and its triggers:

```sql
-- Migration N
DROP TRIGGER IF EXISTS search_content_ai;
DROP TRIGGER IF EXISTS search_content_ad;
DROP TRIGGER IF EXISTS search_content_au;
DROP TABLE IF EXISTS search_fts;
```

**Keep `search_content` table and all its indexes.** This table serves aggregation queries.

Remove dead code:
- `sanitize_fts_query()` — Tantivy has its own query parser
- FTS5-specific query building in `search_reader.rs`
- Trigger creation in migrations

### Step 5: Tauri Integration

In `lib.rs` (Tauri plugin setup):

```rust
let search_index = TantivySearchIndex::open_or_create(&search_index_path, extractor_version)?;

if search_index.was_rebuilt() {
    // Reset search_indexed_at for all sessions so they re-index into Tantivy
    db.reset_all_search_indexed_at()?;
}

app.manage(TantivyState(Arc::new(search_index)));
```

**Self-healing on corruption:**
If `open_or_create` fails (corrupted mmap files, stale locks), wipe the directory and retry. Log a warning. The full re-index will reconstruct the Tantivy index from `events.jsonl` files on disk.

**Factory reset:**
Add `search_index/` directory cleanup to the factory reset command.

### Step 6: Frontend Changes

Minimal frontend changes needed:
- `getResultContext` signature: change from `(sessionId, eventIndex, contextSize)` to `getResultContextByKey(sessionId, eventIndex, contextSize)`
- No changes to facets/stats/health calls (they still hit SQLite)
- Search results may have slightly different ranking (BM25 params differ) — this is expected and desirable

### Step 7: Optional — Drop FTS5 Indexes

Once Tantivy is stable and validated, consider dropping the secondary B-tree indexes on `search_content` that were only used by FTS5 queries:

```sql
DROP INDEX IF EXISTS idx_sc_content_type;
DROP INDEX IF EXISTS idx_sc_tool_name;
DROP INDEX IF EXISTS idx_sc_session_id;
-- Keep: idx_sc_timestamp (used for browse mode fallback)
-- Keep: idx_sc_session_event (used for context expansion fallback)
```

This saves ~50 MB but removes the ability to fall back to SQLite for search. Only do this after the Tantivy path is proven stable in production.

---

## Critical Pitfalls to Avoid

### 1. Do NOT Remove search_content for Aggregation

The first attempt dropped `search_content` entirely and tried to do aggregation in Tantivy. This requires O(n) document iteration for every `GROUP BY` equivalent. SQLite does this in O(log n) with B-tree indexes.

**Rule:** Tantivy for search, SQLite for aggregation.

### 2. Always Call reader.reload() After commit()

```rust
pub fn commit(&self) -> Result<()> {
    let mut w = self.writer.lock()?;
    writer::commit(&mut w)?;
    self.reader.reload()?;  // MUST be here
    Ok(())
}
```

Without this, `ReloadPolicy::OnCommitWithDelay` causes a race where queries after commit see stale data.

### 3. Commit Ordering: Tantivy Before SQLite

```
tantivy.upsert_session(sid, rows) → tantivy.commit() → db.mark_search_indexed(sid)
```

Never mark SQLite before Tantivy commit. A crash between them should cause re-indexing (safe), not a permanent desync (unsafe).

### 4. Windows mmap File Locks

On Windows, Tantivy's mmap'd segment files cannot be deleted while the index is open. The `cleanup_index_dir` function must handle:
- Files in subdirectories (Tantivy creates segment directories)
- `.lock` files that persist after crashes
- The index must be fully closed before cleanup

Self-healing pattern:
```rust
match TantivySearchIndex::open_or_create(&path, version) {
    Ok(idx) => idx,
    Err(_) => {
        // Wipe and retry
        let _ = std::fs::remove_dir_all(&path);
        let _ = std::fs::create_dir_all(&path);
        TantivySearchIndex::open_or_create(&path, version)?
    }
}
```

### 5. Don't Do Aggregation in Tantivy (Even With Fast Fields)

Fast fields (`StrColumn.term_ords()`) avoid LZ4 decompression but still require O(n) iteration over all documents. For 314K documents, this takes ~200ms per aggregation. With 4 IPC calls per page load, that's ~800ms of CPU work.

The `AggregateCache` approach partially solves this but introduces cache invalidation complexity that's hard to get right, especially during bulk indexing.

### 6. Batch Frontend IPC Calls

If you ever do move aggregation to Tantivy (not recommended), batch all aggregation into a single IPC call:

```typescript
// BAD: 4 separate calls
const stats = await getSearchStats();
const tools = await getSearchToolNames();
const facets = await getSearchFacets();
const health = await getFtsHealth();

// GOOD: 1 call
const { stats, tools, facets, health } = await getSearchOverview();
```

This is good practice regardless of the backend.

---

## Files to Reference

All implementation code from the first attempt is on branch `feat/fst-search-index`. Key files:

| File | What to Reuse |
|------|--------------|
| `tantivy_index/schema.rs` | Schema definition, custom tokenizer — **reuse as-is** |
| `tantivy_index/writer.rs` | Document mapping, session upsert — **reuse as-is** |
| `tantivy_index/reader.rs` | Search, count, context, snippets — **reuse search/count/context/snippet functions**. Do NOT reuse `compute_aggregate_cache`, `facets_single_pass` aggregation, or any fast-field aggregation code. |
| `tantivy_index/mod.rs` | `TantivySearchIndex` struct, `open_or_create`, `commit` — **reuse but remove `AggregateCache`** |
| `commands/search.rs` | Tauri command routing — **reuse search/count/context commands, keep facets/stats/health on SQLite** |
| `examples/bench_tantivy.rs` | Benchmark harness — **reuse for validation** |

---

## Validation Checklist

Before considering the migration complete:

- [ ] All existing search features work (phrase, prefix, boolean, filters, browse, context)
- [ ] Fuzzy search works as a new feature
- [ ] Facets/stats/health load in <50ms (should be instant — they're SQLite queries)
- [ ] Search page load causes no CPU spike (check Task Manager)
- [ ] Idle CPU is 0% (no polling, no background computation)
- [ ] Full reindex completes without errors (174 sessions, 314K rows)
- [ ] Incremental reindex works (modify one session, only that session re-indexes)
- [ ] Factory reset clears both SQLite and Tantivy index
- [ ] Crash recovery: kill process during indexing → restart → no corruption, re-indexes incomplete sessions
- [ ] Windows file locks don't prevent index operations
- [ ] Schema version bump triggers clean rebuild
- [ ] 490+ Rust tests pass
- [ ] 417+ frontend tests pass
- [ ] Test with real production data, not just synthetic fixtures
