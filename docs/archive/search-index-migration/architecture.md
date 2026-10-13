# Tantivy Module Architecture

> Reference architecture from the first implementation attempt. The search/query layer is proven and reusable. The aggregation layer should be replaced with SQLite queries.

---

## Module Structure

```
crates/tracepilot-indexer/src/tantivy_index/
├── mod.rs      # TantivySearchIndex struct — lifecycle, public API, state management
├── schema.rs   # Index schema, custom tokenizer, field definitions, versioning
├── writer.rs   # SearchContentRow → Tantivy Document, session upsert, commit
└── reader.rs   # Query execution, snippets, context expansion, result mapping
```

## Schema (v2)

```
content        TEXT    (indexed + stored, custom tokenizer)    → full-text search + snippets
session_id     STRING  (fast + stored)                        → session filtering + grouping
content_type   STRING  (fast + stored)                        → filter: user_message, tool_call, etc.
repository     STRING  (fast + stored)                        → filter: owner/repo
tool_name      STRING  (fast + stored)                        → filter: Read, Write, etc.
turn_number    I64     (fast + stored)                        → sorting within session
event_index    I64     (fast + stored)                        → unique position, context expansion
timestamp_unix I64     (fast + stored)                        → date range filter, sort key
metadata_json  STORED  (only)                                 → raw metadata blob, not searched
```

### Custom Tokenizer: `tracepilot_unicode`

Matches FTS5's `unicode61` behaviour:
- `SimpleTokenizer` — Unicode word-boundary splitting
- `LowerCaser` — case-insensitive matching
- `AsciiFoldingFilter` — diacritic removal (café → cafe)

Registered on the index during `open_or_create`:
```rust
let analyzer = TextAnalyzer::builder(SimpleTokenizer::default())
    .filter(LowerCaser)
    .filter(AsciiFoldingFilter)
    .build();
index.tokenizers().register(TOKENIZER_NAME, analyzer);
```

## Core Struct

```rust
pub struct TantivySearchIndex {
    index: Index,
    reader: IndexReader,           // Clone + Send + Sync
    writer: Mutex<IndexWriter>,    // Exclusive write access
    fields: TantivyFields,         // Resolved field handles
    index_path: PathBuf,
    meta: Mutex<TantivyIndexMeta>, // Sidecar metadata
    was_rebuilt: bool,             // True if schema mismatch triggered rebuild
}
```

**Thread safety:**
- `IndexReader` is `Clone + Send + Sync` — safe for concurrent search from multiple Tauri IPC handlers
- `IndexWriter` behind `Mutex` — only one writer thread (the indexing pipeline)
- `reader.searcher()` returns an `Arc<Searcher>` snapshot — consistent view during a query

## Session Upsert Pattern

```rust
pub fn upsert_session(session_id: &str, rows: &[SearchContentRow], repository: Option<&str>) {
    // 1. Delete all existing docs for this session
    writer.delete_term(Term::from_field_text(fields.session_id, session_id));

    // 2. Insert new docs
    for row in rows {
        let doc = row_to_document(&fields, row, repository);
        writer.add_document(doc)?;
    }

    // Note: caller must call commit() separately
}
```

Delete-then-insert ensures idempotent upserts. Tantivy's delete is by term match, so all documents with matching `session_id` are marked for deletion.

## Commit With Reader Reload

```rust
pub fn commit(&self) -> Result<()> {
    let mut w = self.writer.lock()?;
    writer::commit(&mut w)?;

    // CRITICAL: reload immediately — don't rely on OnCommitWithDelay
    self.reader.reload()?;

    Ok(())
}
```

## Query Translation

| User syntax | Tantivy query |
|-------------|---------------|
| `error` | `QueryParser::parse_query("error")` → BM25-ranked |
| `"exact phrase"` | `PhraseQuery` (automatic from parser) |
| `config*` | `QueryParser` with prefix expansion |
| `async AND error` | `BooleanQuery` with Must clauses |
| `async OR error` | `BooleanQuery` with Should clauses |
| `NOT error` | `BooleanQuery` with MustNot clause |
| (empty query) | `AllQuery` → browse mode |

### Filter Application

Filters are combined with the text query via `BooleanQuery::Must`:

```rust
let mut clauses = vec![(Occur::Must, text_query)];

if let Some(ct) = &filters.content_type {
    clauses.push((Occur::Must, TermQuery::new(content_type_term, STRING)));
}
if let Some(repo) = &filters.repository {
    clauses.push((Occur::Must, TermQuery::new(repo_term, STRING)));
}
// ... date range via RangeQuery on timestamp_unix
// ... session_id via TermQuery

BooleanQuery::new(clauses)
```

## Result Hydration

Tantivy returns `Vec<TantivyHit>`:
```rust
pub struct TantivyHit {
    pub session_id: String,
    pub content_type: String,
    pub turn_number: Option<i64>,
    pub event_index: i64,
    pub timestamp_unix: Option<i64>,
    pub tool_name: Option<String>,
    pub content: String,
    pub metadata_json: Option<String>,
    pub score: f32,
    pub snippet: Option<String>,
    pub repository: Option<String>,
}
```

Session metadata (summary, branch, model, etc.) is hydrated from SQLite's `sessions` table via `batch_session_metadata(session_ids)`, which does a single `SELECT ... WHERE id IN (...)` query.

## Context Expansion

```rust
// Get events surrounding a specific result
pub fn get_context(session_id: &str, event_index: i64, context_size: i64) -> Vec<ContextRow> {
    let range = (event_index - context_size)..=(event_index + context_size);
    // RangeQuery on event_index, filtered by session_id TermQuery
    // Sorted by event_index ascending
}
```

## Persistence and Recovery

- **Index directory:** `<data_dir>/search_index/` (sibling to `index.db`)
- **Sidecar file:** `<data_dir>/search_index/tracepilot_meta.json`
- **On startup:** Check `schema_version` and `extractor_version` against code constants
- **On mismatch:** Wipe directory, recreate index, set `was_rebuilt = true`
- **On corruption:** Same as mismatch — wipe and rebuild (self-healing)
- **On factory reset:** Delete `search_index/` directory entirely

## Integration Points

```
Tauri plugin setup (lib.rs)
├── TantivySearchIndex::open_or_create(path, extractor_version)
├── if was_rebuilt → reset search_indexed_at for all sessions
└── app.manage(TantivyState(Arc::new(search_index)))

Indexing pipeline (lib.rs)
├── reindex_search_content
│   ├── for each stale session:
│   │   ├── extract rows from events.jsonl
│   │   ├── write to SQLite search_content (keep for aggregation)
│   │   ├── tantivy.upsert_session(rows)
│   │   ├── tantivy.commit()
│   │   └── db.mark_search_indexed(session_id)  ← AFTER commit
│   └── emit search-indexing-finished event
└── rebuild_search_content
    ├── tantivy.clear_all()
    ├── db.clear_search_content()
    ├── reindex all sessions
    └── emit search-indexing-finished event

Tauri IPC commands (commands/search.rs)
├── search_fts         → tantivy.search() + db.batch_session_metadata()
├── search_fts_count   → tantivy.count()
├── get_result_context  → tantivy.get_context()
├── get_search_facets   → db.search_facets()      ← KEEP ON SQLITE
├── get_search_stats    → db.search_stats()        ← KEEP ON SQLITE
├── get_search_tool_names → db.search_tool_names() ← KEEP ON SQLITE
└── fts_health          → db.fts_health()          ← KEEP ON SQLITE
```
