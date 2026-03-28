# Search Index Replacement Analysis: SQLite FTS5 → Tantivy / FST

> **Date:** 2026-03-28  
> **Status:** Shelved — search performance proven (6–72× faster), but aggregation CPU regression unresolved. See [search-index-migration/](search-index-migration/) for full retrospective.  
> **Branch:** `feat/fst-search-index` (implementation code, not merged)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture](#current-architecture)
3. [Real-World Data Profile](#real-world-data-profile)
4. [Candidate Analysis: `fst` (BurntSushi)](#candidate-analysis-fst)
5. [Candidate Analysis: `tantivy` (Quickwit)](#candidate-analysis-tantivy)
6. [Head-to-Head Comparison](#head-to-head-comparison)
7. [Recommendation](#recommendation)
8. [Implementation Plan](#implementation-plan)
9. [Migration Strategy](#migration-strategy)
10. [Risk Assessment](#risk-assessment)

---

## Executive Summary

This analysis evaluates replacing TracePilot's current SQLite FTS5 search index with either **[`fst`](https://github.com/BurntSushi/fst)** (finite state transducers) or **[`tantivy`](https://github.com/quickwit-oss/tantivy)** (Lucene-inspired full-text search engine).

**Recommendation: Replace FTS5 with Tantivy** for deep content search (`search_fts` + `search_content`), while keeping SQLite as the relational store for `search_content` metadata, session data, and analytics. This gives us:

- **5–15× faster full search pipeline** (realistic estimate; best-case up to 20×)
- **Native fuzzy search** (Levenshtein distance) — currently unsupported
- **Improved BM25 with per-field boosting** — FTS5 already uses BM25 via `rank`, but Tantivy offers configurable k1/b parameters and field-level boosting
- **Incremental segment-based indexing** — concurrent readers/writers, no full rebuild needed
- **~15–30 MB reader RAM** + 15 MB writer budget during indexing (vs ~40–60 MB FTS5 page cache)
- **Single-pass faceted search** — eliminates our 4-query facet pattern
- **Snippet highlighting** with configurable context windows

`fst` is **not suitable** as a standalone replacement — it's a building block for set/map lookups, not a full-text search engine. It lacks scoring, document storage, phrase search, and incremental updates.

> **Important caveats**: Windows-specific file locking with mmap requires careful handling. Tantivy is pre-1.0 (0.22+), so API stability is not guaranteed. The report includes a dedicated [Windows Considerations](#windows-considerations) section and [Tantivy State Management](#tantivy-state-management) design.

---

## Current Architecture

### Two-Layer FTS Design

TracePilot currently uses **two FTS5 virtual tables** in a single SQLite database (`~/.copilot/tracepilot/index.db`):

```
┌─────────────────────────────────────────────────────────┐
│                    index.db (SQLite)                     │
├─────────────────────────────────────────────────────────┤
│  sessions (270 rows)                                     │
│    ├── metadata: id, summary, repo, branch, cwd, ...     │
│    ├── analytics: tokens, cost, health_score, ...         │
│    └── search state: search_indexed_at, extractor_ver     │
│                                                           │
│  sessions_fts (FTS5) ─── lightweight toolbar search       │
│    └── indexes: id, summary, repository, branch           │
│                                                           │
│  search_content (314,403 rows) ─── deep content store     │
│    ├── session_id, content_type, turn_number, event_index │
│    ├── timestamp_unix, tool_name, content, metadata_json  │
│    └── 6 secondary B-tree indexes                         │
│                                                           │
│  search_fts (FTS5) ─── deep full-text index               │
│    └── content-synced from search_content via triggers     │
│                                                           │
│  + session_model_metrics, session_tool_calls,              │
│    session_modified_files, session_activity,                │
│    session_incidents, session_segments                      │
└─────────────────────────────────────────────────────────┘
```

### Indexing Pipeline

```
Phase 1 (blocking): Session discovery → Parallel parse (Rayon) → Sequential DB write
Phase 2 (background): Staleness check → Parallel event parse+extract → Sequential FTS upsert
```

- **Phase 1** indexes session metadata + analytics into `sessions` table
- **Phase 2** extracts searchable content from `events.jsonl` into `search_content` + `search_fts`
- Incremental detection uses `events_mtime`, `events_size`, `search_extractor_version`
- Per-session upsert: `DELETE FROM search_content WHERE session_id = ? → INSERT new rows`

### Content Types Indexed

| Content Type | Description | Avg Size | Row Count |
|---|---|---|---|
| `tool_call` | Tool invocation arguments (flattened JSON) | 213 bytes | 134,574 |
| `tool_result` | Tool output (tool-specific extraction) | 377 bytes | 121,130 |
| `assistant_message` | LLM response text | 446 bytes | 32,773 |
| `reasoning` | Chain-of-thought / thinking blocks | 767 bytes | 19,949 |
| `subagent` | Sub-agent names | 29 bytes | 3,295 |
| `tool_error` | Tool execution errors | 82 bytes | 1,482 |
| `user_message` | User prompts | 641 bytes | 894 |
| `compaction_summary` | Context compaction summaries | 2,989 bytes | 255 |
| `error` | Session-level errors | 297 bytes | 51 |

### Query Features Currently Supported

| Feature | Supported | Implementation |
|---|---|---|
| Exact phrase search | ✅ | `"quoted phrases"` via FTS5 |
| Prefix search | ✅ | `word*` via FTS5 |
| Boolean operators | ✅ | `AND`, `OR`, `NOT` (infix only) |
| Browse mode (filter-only) | ✅ | Empty query → skip FTS MATCH |
| Content type filter | ✅ | SQL WHERE clause |
| Repository filter | ✅ | SQL JOIN + WHERE |
| Tool name filter | ✅ | SQL WHERE clause |
| Date range filter | ✅ | SQL WHERE on timestamp_unix |
| Session scope | ✅ | SQL WHERE on session_id |
| Faceted counts | ✅ | 4 separate GROUP BY queries |
| Snippet highlighting | ✅ | FTS5 `snippet()` function |
| Result context (before/after) | ✅ | Adjacent row lookup by event_index |
| Fuzzy search | ❌ | Not implemented |
| NEAR proximity | ❌ | Stripped by sanitizer (UI claims support) |
| Field-scoped search | ❌ | Colons stripped by sanitizer |
| Relevance scoring | ✅ | FTS5 `rank` IS BM25 by default; weighted by content-type. Lacks per-field boosting and configurable k1/b parameters. |

---

## Real-World Data Profile

Measured against a **production index database** with real Copilot CLI session data:

| Metric | Value |
|---|---|
| Database file size | **243 MB** |
| Total sessions | 270 |
| Indexed sessions | 270 (174 with deep content) |
| Total `search_content` rows | 314,403 |
| Total content text | **101 MB** |
| Average content per row | 337 bytes |
| Min / Max rows per session | 1 / 12,529 |
| Average rows per session | 1,807 |
| Sessions with 1000+ events | 97 (36%) |
| Sessions with 5000+ events | 25 (9%) |

### Current FTS5 Query Performance (Cold Cache)

| Query | Matches | Latency |
|---|---|---|
| Simple term (`error`) | 12,057 | 19 ms (50 results) |
| Prefix (`config*`) | 12,726 | 23 ms (count) |
| Boolean (`async AND error`) | 1,010 | 33 ms (count) |
| Browse mode (`user_message` filter) | 894 | 23 ms (count) |
| Full FTS + snippet + JOIN (50 results) | 12,057 | 138 ms |
| Facet GROUP BY (content_type) | 12,057 | 68 ms |
| Totals (COUNT + COUNT DISTINCT) | 12,057 | 69 ms |
| Rare term (`tantivy`) | 3 | 18 ms |

### Performance Pain Points

1. **Full search pipeline** (query + count + 3 facet queries) requires **~350–400 ms** for common terms
2. **FTS5 snippet generation** is the bottleneck — 138 ms for 50 results with JOINs
3. **Faceted navigation** requires 4 separate queries (content_type, repository, tool_name, totals)
4. **No fuzzy matching** — typos return zero results
5. **BM25 ranking lacks per-field boosting** — FTS5's `rank` column returns BM25 scores, but cannot boost individual fields (e.g., user_message vs tool_result) at the BM25 level; current code approximates this with post-hoc content-type weight multipliers
6. **243 MB on disk** for the entire index DB, of which FTS5 overhead is estimated at ~80–120 MB (the remaining ~120–160 MB is relational data, analytics tables, and B-tree indexes that remain regardless of search engine choice)
7. **No NEAR/proximity search** — documented in UI help but stripped by query sanitizer
8. **No field-scoped search** — colons stripped by sanitizer despite FTS5 supporting column filters

---

## Candidate Analysis: `fst`

### What It Is

`fst` implements **Finite State Transducers** — a compact, immutable data structure for storing ordered sets and maps of byte strings. Think of it as a highly compressed trie that shares both prefixes and suffixes.

### Capabilities

| Feature | Support |
|---|---|
| Exact key lookup | ✅ O(key_length) |
| Prefix search | ✅ Via automaton |
| Range queries | ✅ Via stream ranges |
| Fuzzy search (Levenshtein) | ✅ Via `levenshtein_automata` crate |
| Regex search | ✅ Via `regex-automata` crate |
| Phrase search | ❌ Not a concept — operates on keys, not documents |
| Boolean queries | ❌ Only set union/intersection on FST streams |
| Document storage | ❌ Maps keys → u64 values only |
| Relevance scoring | ❌ No TF-IDF / BM25 |
| Snippet generation | ❌ No document awareness |
| Faceted search | ❌ No aggregation support |
| Incremental updates | ❌ **Immutable once built** — full rebuild required |

### Memory & Storage

- **Extremely compact**: An FST of 1 billion English words fits in ~1.5 GB (vs 40+ GB raw)
- **Memory-mapped**: Can use `mmap` to keep index on disk with OS page cache
- For our 101 MB corpus, unique terms might compress to **5–15 MB** FST
- But FST only stores terms, not positions/documents — you'd need a separate postings list

### Why `fst` Is Not Suitable as a Standalone Replacement

1. **Not a search engine** — it's a building block. You'd need to build:
   - An inverted index on top (term → document ID list)
   - A postings list with positions (for phrase search)
   - A scoring/ranking system
   - Snippet generation
   - Facet aggregation
   - Incremental update logic (FSTs are immutable)

2. **No incremental updates** — the FST must be rebuilt from scratch when data changes. For our use case with sessions being added/updated during app usage, this is a fundamental mismatch.

3. **No document awareness** — FST maps byte strings to u64 values. It has no concept of documents, fields, positions within documents, or term frequency. You'd essentially be reimplementing Tantivy from scratch.

### Where `fst` Could Help (As a Component)

- **Autocomplete / suggestion engine** for the search toolbar
- **Term dictionary** inside a larger custom index
- Tantivy actually uses `fst` internally for its term dictionary

### Verdict: ❌ Not Recommended as Primary Index

`fst` is a data structure, not a search engine. Using it would require building an entire IR (information retrieval) system from scratch. The engineering effort would be enormous with no clear benefit over Tantivy, which already uses FSTs internally.

---

## Candidate Analysis: `tantivy`

### What It Is

Tantivy is a **full-text search engine library** written in Rust, inspired by Apache Lucene. It provides a complete search stack: schema definition, indexing, querying, scoring, and result retrieval — all as an embeddable library with no external server process.

### Capabilities

| Feature | Support | Notes |
|---|---|---|
| Exact term search | ✅ | TermQuery |
| Phrase search | ✅ | PhraseQuery with slop |
| Prefix search | ✅ | Via `PhrasePrefixQuery` (efficient) or `RegexQuery` (fallback) |
| Fuzzy search | ✅ | Levenshtein with configurable distance |
| Boolean queries | ✅ | BooleanQuery with MUST/SHOULD/MUST_NOT |
| Regex search | ✅ | RegexQuery |
| Range queries | ✅ | On numeric/date fields |
| Relevance scoring (BM25) | ✅ | Native, field-boosted |
| Custom scoring | ✅ | Custom `Scorer` implementations |
| Snippet highlighting | ✅ | `SnippetGenerator` with configurable context |
| Faceted search | ✅ | `FacetCollector` — single-pass aggregation |
| Field-scoped search | ✅ | Queries target specific schema fields |
| Incremental indexing | ✅ | Segment-based, concurrent readers/writers |
| Document deletion | ✅ | By term (e.g., session_id) |
| Document storage | ✅ | Stored fields retrievable from index |
| Memory-mapped I/O | ✅ | `MmapDirectory` for disk-backed indexes |
| RAM-only index | ✅ | `RamDirectory` for in-memory operation |
| Concurrent access | ✅ | `IndexReader` is `Clone + Send + Sync` |
| Index merging | ✅ | Automatic background segment merging |

### Schema Design for TracePilot

```rust
let mut schema_builder = Schema::builder();

// Full-text search field — custom TextAnalyzer matching unicode61 behavior
let text_options = TextOptions::default()
    .set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer("tracepilot_unicode")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    )
    .set_stored();
let content = schema_builder.add_text_field("content", text_options);

// String fields (exact match, no tokenization)
let session_id = schema_builder.add_text_field("session_id", STRING | STORED);
let content_type = schema_builder.add_text_field("content_type", STRING | STORED);
let tool_name = schema_builder.add_text_field("tool_name", STRING | STORED);
let repository = schema_builder.add_text_field("repository", STRING | STORED);

// Numeric fields — FAST for sorting/aggregation, INDEXED for range queries
let turn_number = schema_builder.add_i64_field("turn_number", INDEXED | STORED | FAST);
let event_index = schema_builder.add_i64_field("event_index", INDEXED | STORED | FAST);
let timestamp_unix = schema_builder.add_i64_field("timestamp_unix", INDEXED | STORED | FAST);

// Metadata (stored only, for result display)
let metadata_json = schema_builder.add_text_field("metadata_json", STORED);

// Facet field for hierarchical faceted search
// Documents are indexed with facets like:
//   /content_type/tool_call
//   /repository/my-repo
//   /tool_name/Read
let facets = schema_builder.add_facet_field("facets", INDEXED);

let schema = schema_builder.build();
```

> **Tokenizer equivalence note**: FTS5's `unicode61` tokenizer performs Unicode-aware word boundary detection, diacritic removal, and case folding. Tantivy's default analyzer (`SimpleTokenizer` + `LowerCaser`) splits on non-alphanumeric characters and lowercases, but does NOT handle diacritic removal or Unicode segmentation identically. We must register a custom `TextAnalyzer` named `"tracepilot_unicode"` that chains `UnicodeTokenizer` + `LowerCaser` + `AsciiFoldingFilter` to approximate `unicode61` behavior. This is critical for matching existing query behavior on paths, identifiers, and non-ASCII text.

> **Facet population**: When indexing documents, each document must be tagged with its facets:
> ```rust
> let mut doc = TantivyDocument::new();
> doc.add_text(content, &row.content);
> doc.add_facet(facets, Facet::from(&format!("/content_type/{}", row.content_type)));
> doc.add_facet(facets, Facet::from(&format!("/repository/{}", row.repository)));
> if let Some(tool) = &row.tool_name {
>     doc.add_facet(facets, Facet::from(&format!("/tool_name/{}", tool)));
> }
> ```
>
> At query time, `FacetCollector` requires root facet paths:
> ```rust
> let mut facet_collector = FacetCollector::for_field("facets");
> facet_collector.add_facet(Facet::from("/content_type"));
> facet_collector.add_facet(Facet::from("/repository"));
> facet_collector.add_facet(Facet::from("/tool_name"));
> ```

### Memory & Storage Characteristics

For our production corpus (314K documents, 101 MB text):

| Metric | Estimated Value | Confidence | Notes |
|---|---|---|---|
| Index size on disk | **40–70 MB** | Medium | Tantivy search index only. Total disk = this + SQLite relational (~120–160 MB). |
| Warm reader RAM | **15–30 MB** | Medium | Shared mmap pages + term dict + segment metadata. Shared across concurrent readers. |
| Peak writer RAM | **30–60 MB** | Low-Medium | 15 MB min writer budget + merge threads + segment buffers. During Phase 2 bulk indexing. |
| Cold/idle RAM | **2–5 MB** | High | Segment metadata + file handles only. |
| Index open time | **1–5 ms** | High | Load segment metadata, no data scanning. |
| Commit latency | **10–50 ms** | Medium | Flush new segment; merge amortized over time. |
| Search latency (top 50) | **3–15 ms** | Low-Medium | BM25 scoring + stored-field loads. Desktop P95 may be higher with cold cache or AV interference. |
| Search + snippets (top 50) | **10–40 ms** | Low-Medium | Snippet generation requires stored-field access; heavily depends on content length. |
| Count query | **2–10 ms** | Medium | Via `CountCollector`. |
| Facet query (single pass) | **5–20 ms** | Low-Medium | `FacetCollector` with 3 root facets. Self-excluding facet semantics (current UX) still needs per-dimension filtered queries. |
| Full pipeline (query+count+facets) | **15–60 ms** | Low-Medium | Desktop realistic range; vs 350–400 ms current. **5–15× improvement**, not 16–40×. |

> **Confidence levels explained**: "High" = validated by benchmarks or Tantivy docs. "Medium" = extrapolated from similar corpora. "Low-Medium" = optimistic estimate needing real benchmarks; actual performance depends on stored-field I/O, Windows AV, and warm/cold cache state.

> **Storage comparison note**: The current 243 MB SQLite database includes ALL data (sessions, analytics, search_content rows, B-tree indexes, AND FTS5 tables). FTS5-specific overhead is estimated at ~80–120 MB. In the hybrid architecture, SQLite remains for relational data, so total disk footprint = ~120–160 MB SQLite + ~40–70 MB Tantivy = **160–230 MB total** (comparable or slightly smaller than today, with dramatically better search capabilities).

### How It Handles Current Use Cases

#### 1. Incremental Session Updates

```rust
// Delete old content for this session
let session_term = Term::from_field_text(session_id_field, &sid);
index_writer.delete_term(session_term);

// Add new documents
for row in extracted_rows {
    let mut doc = TantivyDocument::new();
    doc.add_text(content_field, &row.content);
    doc.add_text(session_id_field, &row.session_id);
    // ... other fields ...
    index_writer.add_document(doc)?;
}

// Commit makes changes visible to readers
index_writer.commit()?;
```

This is **fundamentally better** than the current SQLite approach:
- Deletes are **lazy** (tombstoned in segments, cleaned up on merge)
- Writes go to a new segment immediately
- Readers see a consistent snapshot and are never blocked by writers (but new data only becomes visible after `commit()` + `reader.reload()`)
- No trigger-based FTS sync overhead
- **Segment growth note**: Repeated reindexing of the same session creates tombstones + new segments. Auto-merge cleans these up, but frequent updates to the same sessions can temporarily bloat disk and degrade query performance until merge catches up. Tune `LogMergePolicy` for desktop workloads.

#### 2. FTS Query with Filters

```rust
// "error" in content, filtered to tool_error type, sorted by timestamp
let text_query = QueryParser::for_index(&index, vec![content_field])
    .parse_query("error")?;
let type_filter = TermQuery::new(
    Term::from_field_text(content_type_field, "tool_error"),
    IndexRecordOption::Basic,
);
let combined = BooleanQuery::new(vec![
    (Occur::Must, text_query),
    (Occur::Must, Box::new(type_filter)),
]);

let searcher = reader.searcher();
let top_docs = searcher.search(&combined, &TopDocs::with_limit(50))?;
```

#### 3. Faceted Search (Single Pass!)

```rust
let mut collectors = MultiCollector::new();
let top_handle = collectors.add_collector(TopDocs::with_limit(50));
let count_handle = collectors.add_collector(Count);

// FacetCollector requires explicit root paths
let mut facet_collector = FacetCollector::for_field("facets");
facet_collector.add_facet(Facet::from("/content_type"));
facet_collector.add_facet(Facet::from("/repository"));
facet_collector.add_facet(Facet::from("/tool_name"));
let facet_handle = collectors.add_collector(facet_collector);

let mut multi_fruit = searcher.search(&query, &collectors)?;
let top_docs = top_handle.extract(&mut multi_fruit);
let total_count = count_handle.extract(&mut multi_fruit);
let facet_counts = facet_handle.extract(&mut multi_fruit);

// Extract per-dimension counts
for (facet, count) in facet_counts.get("/content_type") {
    println!("{}: {}", facet, count);
}
```

This replaces our **4 separate SQL queries** with a single index scan.

> **Self-excluding facet caveat**: The current UI shows facet counts that *exclude their own dimension's active filter* (e.g., when filtering by content_type=tool_call, the content_type facet shows counts as if no content_type filter were applied). This "drill-sideways" behavior requires **per-dimension queries with different filters**, not just a single `FacetCollector` pass. Implementation options: (a) run 1+N queries (one per active filter dimension), (b) use Tantivy's `FilterCollector` to selectively exclude one dimension per pass, or (c) redesign the UX to use standard facet counts. Option (a) is recommended for simplicity.

#### 4. Fuzzy Search (New Capability!)

```rust
let fuzzy_query = FuzzyTermQuery::new(
    Term::from_field_text(content_field, "configuraton"), // typo!
    2,     // max edit distance
    true,  // transpositions count as 1 edit
);
// Matches: "configuration", "configurations", etc.
```

#### 5. Snippet Highlighting

```rust
let snippet_generator = SnippetGenerator::create(&searcher, &query, content_field)?;
for (_score, doc_address) in top_docs {
    let doc = searcher.doc(doc_address)?;
    let snippet = snippet_generator.snippet_from_doc(&doc);
    // snippet.to_html() → "<b>error</b> in module configuration..."
}
```

#### 6. App Startup / Index Persistence

Tantivy indexes are **persisted to disk** and **opened instantly** on restart:

```rust
// On startup: open existing index (1-5ms)
let dir = MmapDirectory::open(&index_path)?;
let index = Index::open(dir)?;
let reader = index.reader()?;

// Index is immediately queryable — no rebuild needed!
```

**This is a major improvement**: the current system must run Phase 2 search indexing on every app start for sessions that changed. With Tantivy, the index persists on disk and only needs incremental updates for genuinely changed sessions.

#### 7. Session Pruning

```rust
// Remove all documents for a deleted session
index_writer.delete_term(Term::from_field_text(session_id_field, &deleted_id));
index_writer.commit()?;
// Garbage collected during automatic segment merges
```

### Tantivy Version & Ecosystem

- **Current version**: 0.22+ (actively maintained by Quickwit)
- **API stability**: Pre-1.0, meaning breaking API changes are possible between minor versions. Pin exact version and treat upgrades as deliberate decisions. **Risk: Medium** (not Low).
- **Dependencies**: ~30 transitive crates (reasonable for what it provides)
- **Binary size impact**: ~2–4 MB added to release binary
- **Compile time impact**: ~15–30 seconds incremental, ~60–90 seconds clean
- **Thread safety**: `IndexReader` is `Clone + Send + Sync`; `IndexWriter` needs exclusive access via a **dedicated writer task or `Arc<Mutex<IndexWriter>>`** — see [Tantivy State Management](#tantivy-state-management) section below

---

## Head-to-Head Comparison

### Feature Matrix

| Capability | SQLite FTS5 (Current) | `fst` | Tantivy |
|---|---|---|---|
| Full-text search | ✅ | ❌ (key lookup only) | ✅ |
| Phrase search | ✅ | ❌ | ✅ |
| Prefix search | ✅ | ✅ | ✅ |
| Fuzzy search | ❌ | ✅ (Levenshtein automaton) | ✅ (FuzzyTermQuery) |
| Boolean queries | ✅ | ❌ | ✅ |
| BM25 ranking | ✅ (FTS5 `rank` IS BM25) | ❌ | ✅ (native, configurable k1/b, field boosting) |
| Snippet generation | ✅ (FTS5 snippet()) | ❌ | ✅ (SnippetGenerator) |
| Faceted search | ⚠️ (manual GROUP BY) | ❌ | ✅ (FacetCollector) |
| Field-scoped search | ⚠️ (FTS5 supports it, but our sanitizer strips colons) | N/A | ✅ |
| Incremental updates | ✅ (trigger-synced) | ❌ (immutable) | ✅ (segment-based) |
| Document deletion | ✅ (cascade) | ❌ (rebuild) | ✅ (tombstone) |
| Concurrent read/write | ⚠️ (WAL, single writer) | ✅ (immutable) | ✅ (MVCC-like) |
| Memory efficiency | ⚠️ (page cache) | ✅ (extremely compact) | ✅ (mmap) |
| Disk persistence | ✅ | ✅ | ✅ |
| Schema evolution | ✅ (migrations) | N/A | ⚠️ (reindex on schema change) |
| Maintenance ops | ⚠️ (VACUUM, optimize) | None | ✅ (auto-merge) |
| Ecosystem maturity | ✅ (SQLite) | ✅ (stable) | ✅ (Quickwit-backed) |

### Performance Comparison (Estimated for Our Corpus)

> **Methodology note**: FTS5 numbers are real measurements from production data (270 sessions, 314K rows, 101 MB text). Tantivy numbers are extrapolated from published benchmarks on comparable corpora, adjusted for desktop conditions (Windows, cold cache possible, AV scanning). Confidence is LOW for Tantivy estimates — actual benchmarking required post-implementation.

| Operation | FTS5 (Measured) | Tantivy (Estimated) | Estimated Speedup | Confidence |
|---|---|---|---|---|
| Simple term search (50 results) | 19 ms | 2–8 ms | **2–10×** | Medium |
| Search + snippets (50 results) | 138 ms | 10–40 ms | **3–14×** | Low |
| Count query | 69 ms | 2–10 ms | **7–35×** | Medium |
| Facet aggregation (3 dimensions) | 204 ms (3 queries) | 5–20 ms (1 pass) | **10–40×** | Low-Medium |
| **Full search pipeline** | **~400 ms** | **~25–80 ms** | **5–15×** | Low |
| Boolean query | 33 ms | 3–10 ms | **3–11×** | Medium |
| Prefix search | 23 ms | 2–8 ms | **3–12×** | Medium |
| Index open time | ~50 ms (SQLite open) | 1–5 ms (mmap) | **10–50×** | High |
| Per-session index update | ~20–50 ms | ~10–30 ms | **1–2×** | Medium |
| Full rebuild (314K docs) | ~30–60 s | ~5–15 s | **2–6×** | Medium |

> **Why snippet estimates vary so much**: Snippet generation requires loading stored fields from disk (I/O bound). Performance depends heavily on: document length (tool_result can be huge), warm/cold page cache, Windows Defender real-time scanning of index files, and number of matches per document.

### Storage Comparison

| Metric | FTS5 (Measured) | Tantivy (Estimated) | Notes |
|---|---|---|---|
| FTS5/Tantivy index size | ~80–120 MB (estimated FTS5 portion) | 40–70 MB | Tantivy is more compact |
| Relational data (kept) | ~120–160 MB | ~120–160 MB | Same — SQLite retained |
| **Total disk footprint** | **243 MB** | **160–230 MB** | Modest savings or comparable |
| Warm reader RAM | 40–60 MB (SQLite page cache) | 15–30 MB (shared mmap) | Reader RAM is lower |
| Peak writer RAM | N/A (SQLite internal) | 30–60 MB | Tantivy writer is RAM-hungry |
| Cold/idle RAM | ~0 (disk-only) | 2–5 MB (segment metadata) | Tantivy keeps metadata loaded |

### Dependency & Build Impact

| Metric | FTS5 (Current) | Tantivy |
|---|---|---|
| New dependencies | 0 (bundled in rusqlite) | ~30 transitive crates |
| Binary size delta | 0 | +2–4 MB |
| Clean build time delta | 0 | +60–90 s |
| Incremental build time delta | 0 | +15–30 s |

---

## Recommendation

### ✅ Replace `search_fts` with Tantivy, Keep SQLite for Everything Else

**Architecture:**

```
┌─────────────────────────────────────────────────────────────┐
│                    index.db (SQLite)                         │
│  ├── sessions (metadata, analytics, search state)            │
│  ├── sessions_fts (FTS5, lightweight toolbar search)         │
│  ├── search_content (relational store, filters, context)     │
│  ├── session_* tables (analytics, tools, incidents, etc.)    │
│  └── NO search_fts table (removed)                           │
│       NO FTS5 sync triggers (removed)                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  search_index/ (Tantivy, on disk next to index.db)           │
│  ├── meta.json (schema + segment metadata)                    │
│  ├── *.managed (segment files)                                │
│  └── .tantivy-writer.lock                                     │
│                                                               │
│  Handles: FTS MATCH, BM25 scoring, snippets, facets,          │
│           fuzzy search, phrase search, prefix search           │
└─────────────────────────────────────────────────────────────┘
```

### Why This Hybrid Approach

1. **SQLite stays for what it's good at**: relational queries, metadata, analytics, browse mode filters, context lookups, migrations
2. **Tantivy handles what FTS5 struggles with**: full-text search, relevance scoring, faceted aggregation, fuzzy matching
3. **`search_content` table remains**: it's the canonical store for deep content rows. Tantivy indexes it but doesn't replace it. Browse mode (empty query) still queries SQLite directly.
4. **`sessions_fts` stays as FTS5**: Only 270 rows for toolbar search — the FTS5 performance is excellent here and doesn't warrant the complexity of a second Tantivy index
5. **Minimal migration risk**: If Tantivy index corrupts, rebuild from `search_content` rows. SQLite is the source of truth.
6. **Result hydration**: Search hits from Tantivy return `session_id` + stored fields. Session summary, repository, branch, and updated_at are fetched via batch SQLite lookup (single `WHERE session_id IN (...)` query) after hit retrieval.

### What We Gain

| Gain | Impact |
|---|---|
| **5–15× faster full search pipeline** | ~25–80 ms from ~400 ms (realistic desktop estimate) |
| **Fuzzy search** | New capability — handles typos |
| **Configurable BM25 with field boosting** | Per-field k1/b tuning + boost factors (FTS5 BM25 lacks these) |
| **Single-pass faceted search** | 1 query instead of 4 (with caveats for drill-sideways UX) |
| **~30–50% smaller search index** | 40–70 MB Tantivy vs ~80–120 MB FTS5 overhead |
| **No FTS5 trigger overhead** | Faster content writes (~15–20% write speedup) |
| **Field-scoped search** | Search within specific content types natively |
| **NEAR/proximity queries** | Actually works (currently broken by sanitizer) |

### What We Lose / Trade Off

| Trade-off | Mitigation |
|---|---|
| +30 transitive dependencies | Acceptable for a desktop app |
| +2–4 MB binary size | Negligible for a Tauri app |
| +60–90s clean build time | Incremental builds unaffected for most changes |
| Schema changes need full reindex | Versioned schema with auto-rebuild (same as current extractor versioning) |
| Two storage systems to manage | Tantivy is self-managing (auto-merge); rebuild from SQLite if needed |
| Pre-1.0 API stability risk | Pin exact version; treat upgrades as deliberate decisions |
| Windows mmap complications | See [Windows Considerations](#windows-considerations) |
| 15–60 MB peak writer RAM | Only during Phase 2 bulk indexing; reader-only is 15–30 MB |
| New API surface to learn | Well-documented; conceptually similar to current code |
| Dual-write consistency risk | See [Dual-Write Consistency](#dual-write-consistency) |

---

## Implementation Plan

### Phase 1: Core Tantivy Integration

1. **Add `tantivy` dependency** to `tracepilot-indexer/Cargo.toml`
2. **Define schema** matching current `search_content` columns with FAST fields for sorting
3. **Register custom `"tracepilot_unicode"` tokenizer** to match FTS5 `unicode61` behavior
4. **Create `TantivyIndex` wrapper** as a SEPARATE struct from `IndexDb` (required: `IndexDb` contains `rusqlite::Connection` which is `!Send`, but `TantivyIndex` must be `Send + Sync`)
5. **Implement document mapping** from `SearchContentRow` → Tantivy `Document` (including facet population)
6. **Implement basic query translation** from our `SearchFilters` → Tantivy query AST
7. **Add snippet generation** via `SnippetGenerator`

### Phase 2: Replace Search Pipeline

8. **Replace `query_content()`** to query Tantivy instead of FTS5 MATCH
9. **Replace `query_count()`** with Tantivy `Count` collector
10. **Replace `facets()`** with `FacetCollector` (with drill-sideways support for self-excluding dimensions)
11. **Update `upsert_search_content()`** to dual-write to both SQLite + Tantivy (see [Dual-Write Consistency](#dual-write-consistency))
12. **Update `clear_search_content()`** to also rebuild Tantivy index
13. **Drop FTS5 sync triggers in migration 10** — saves ~15-20% write overhead since Tantivy is now the search engine
14. **Implement result hydration** — session summary/repository/branch/updated_at via batch SQLite lookup after Tantivy hit retrieval

### Phase 3: Add New Capabilities

12. **Add fuzzy search** support to query parser
13. **Add field-scoped search** (`content_type:error AND ...`)
14. **Add NEAR/proximity** queries (fix the documented-but-broken feature)
15. **Improve ranking** with field-level BM25 boosting

### Phase 4: Cleanup & Optimization

19. **Remove `search_fts` table** (already dropped triggers in Phase 2, now drop the FTS5 virtual table)
20. **Remove `sanitize_fts_query()`** in favor of Tantivy's query parser
21. **Update benchmarks** to cover Tantivy queries (query_content, snippets, facets, per-session update, full rebuild)
22. **Update perf-budget.json** with new performance baselines
23. **Add Tantivy index health** to `fts_health` command
24. **Add schema versioning** — stored version hash in meta file for auto-rebuild on mismatch

### File Changes

| File | Change |
|---|---|
| `crates/tracepilot-indexer/Cargo.toml` | Add `tantivy` dependency |
| `crates/tracepilot-indexer/src/index_db/mod.rs` | Add Tantivy index alongside SQLite |
| `crates/tracepilot-indexer/src/tantivy_index/mod.rs` | **New**: Tantivy wrapper module |
| `crates/tracepilot-indexer/src/tantivy_index/schema.rs` | **New**: Schema definition |
| `crates/tracepilot-indexer/src/tantivy_index/writer.rs` | **New**: Document indexing |
| `crates/tracepilot-indexer/src/tantivy_index/reader.rs` | **New**: Query execution |
| `crates/tracepilot-indexer/src/index_db/search_reader.rs` | Replace FTS5 queries with Tantivy |
| `crates/tracepilot-indexer/src/index_db/search_writer.rs` | Add Tantivy writes alongside SQLite |
| `crates/tracepilot-indexer/src/index_db/migrations.rs` | Migration 10: drop search_fts |
| `crates/tracepilot-indexer/src/lib.rs` | Update reindex pipeline |
| `crates/tracepilot-tauri-bindings/src/commands/search.rs` | Minor: pass Tantivy reader |
| `packages/types/src/search.ts` | Add fuzzy/proximity query types |
| `apps/desktop/src/stores/search.ts` | Add fuzzy toggle UI |

---

## Migration Strategy

### On First Launch After Update

```
1. App starts → opens index.db (SQLite) as normal
2. Check: does search_index/ directory exist?
   - No → trigger full Tantivy index build from search_content rows
   - Yes → open existing Tantivy index, check schema version
3. If schema version mismatch → rebuild Tantivy from search_content
4. Normal incremental indexing proceeds (both SQLite + Tantivy)
```

### Backward Compatibility

- **Tantivy index is derived from `search_content`** — it can always be rebuilt
- **If user downgrades**, the old code ignores the `search_index/` directory and uses FTS5
- **Migration 10** can be deferred — keep `search_fts` table until Tantivy is proven stable
- **Rollback path**: revert migration, `search_fts` rebuilt from existing `search_content`

### Atomic Rebuild Strategy

> **⚠️ Windows limitation**: `std::fs::rename()` on a directory with mmap'd files will fail on Windows (handles remain open). We use a backup-rename-cleanup strategy instead:

```rust
async fn rebuild_tantivy_index(
    index_path: &Path,
    search_content_rows: &[SearchContentRow],
    tantivy_state: &TantivyState,
) -> Result<()> {
    let temp_dir = index_path.with_extension("rebuilding");
    let backup_dir = index_path.with_extension("backup");

    // 1. Build new index in temp directory
    build_tantivy_index(&temp_dir, search_content_rows)?;

    // 2. Close existing writer + readers (release mmap handles)
    tantivy_state.close().await?;

    // 3. Backup-rename-cleanup (Windows-safe)
    if index_path.exists() {
        // Rename old → backup (may need retries on Windows if AV holds handles)
        retry_rename(&index_path, &backup_dir, /*retries=*/3, /*delay=*/100ms)?;
    }
    std::fs::rename(&temp_dir, &index_path)?;

    // 4. Reopen index + reader
    tantivy_state.reopen(&index_path)?;

    // 5. Clean up backup (best-effort; may fail if AV scanning)
    let _ = std::fs::remove_dir_all(&backup_dir);

    Ok(())
}
```

**Search availability during rebuild**: Users cannot search during step 2–4 (writer/reader closed). This window should be < 1 second for the rename operations. For zero-downtime, an alternative is generation-based indexing (build new generation, atomically swap reader), but that adds significant complexity. Recommended approach: show a brief "rebuilding search index" indicator in the UI.

---

## Tantivy State Management

> **This section addresses a critical architectural concern flagged by all three reviewers.**

### The Problem

- `IndexDb` contains `rusqlite::Connection` which is `!Send` — it cannot be shared across Tauri async commands
- `IndexReader` is `Clone + Send + Sync` — it CAN be shared
- `IndexWriter` requires exclusive access and has a **15 MB minimum memory budget**
- Current code opens `IndexDb::open_readonly()` per command inside `spawn_blocking`

### The Solution: Separate `TantivyState` Struct

```rust
/// Tantivy index state, separate from IndexDb (which is !Send due to rusqlite).
/// This struct lives in Tauri's managed state and is shared across all commands.
pub struct TantivyState {
    /// Shared reader — Clone + Send + Sync. Cloned per search command.
    reader: IndexReader,

    /// Exclusive writer — behind Arc<Mutex<>> or a dedicated writer task.
    /// Only one writer can exist per index at a time.
    writer: Arc<Mutex<Option<IndexWriter>>>,

    /// Schema handle for field lookups
    schema: TantivySchema,

    /// Index path for rebuild/reopen
    index_path: PathBuf,
}

impl TantivyState {
    /// Reader is cheap to clone — hand out to each search command
    pub fn reader(&self) -> IndexReader {
        self.reader.clone()
    }

    /// Writer access via lock — used by indexing pipeline only
    pub async fn with_writer<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&mut IndexWriter) -> Result<R>,
    {
        let mut guard = self.writer.lock().await;
        let writer = guard.as_mut().ok_or(IndexerError::WriterClosed)?;
        f(writer)
    }
}
```

### Reader Reload Policy

Tantivy readers see a **point-in-time snapshot**. New data is only visible after `commit()` + `reader.reload()`:

- Use `ReloadPolicy::OnCommit` for automatic reload after each commit
- Or call `reader.reload()` explicitly after batch indexing completes
- **Do NOT** assume writes are "immediately visible" without reload

### Writer Lifecycle

- **On app startup**: Open or create index, create writer with 15 MB heap
- **During Phase 2 indexing**: Writer adds documents, commits per batch (e.g., every 100 sessions)
- **Between indexing runs**: Writer stays alive (avoids re-acquiring `.tantivy-writer.lock`)
- **On app shutdown**: Writer is dropped, releasing the lock file
- **Lock failure recovery**: If `.tantivy-writer.lock` is stale (previous crash), detect `LockFailure` error and force-delete the lock file with user confirmation

---

## Dual-Write Consistency

> **Flagged by GPT 5.4 review**: If SQLite write succeeds but Tantivy commit fails, the app falsely thinks a session is indexed.

### Current Behavior

`upsert_search_content()` updates SQLite within a savepoint and sets `search_indexed_at`. With dual-write:

```
1. SQLite: DELETE old rows, INSERT new rows → savepoint commit
2. Tantivy: delete_term(session_id), add_documents, commit()
3. SQLite: UPDATE search_indexed_at → confirms completion
```

### Risk: Tantivy Fails After SQLite Succeeds

If step 2 fails:
- `search_content` rows exist in SQLite ✅
- `search_indexed_at` is NOT set (step 3 skipped) ✅
- Session appears "stale" on next incremental check → re-indexed automatically ✅

**Mitigation**: Set `search_indexed_at` ONLY after Tantivy commit succeeds. The existing staleness detection (events_mtime + search_extractor_version) provides natural retry semantics. If Tantivy is persistently broken, add an `IndexerError::Tantivy` variant that triggers a full Tantivy rebuild.

---

## Windows Considerations

> **Flagged as critical by all three reviewers. This is the highest-risk area for a Tauri desktop app.**

### Known Issues

1. **mmap handle retention**: Windows locks files opened via `MmapDirectory`. Segment files cannot be deleted/renamed while readers hold handles. This affects:
   - Index rebuild (rename fails)
   - Segment merge (old segments can't be cleaned up immediately)
   - Index deletion (stale `.lock` files)

2. **Antivirus interference**: Windows Defender and other AV tools may:
   - Lock newly created segment files during scanning
   - Cause `PermissionDenied` errors on commit/merge
   - Add latency to file operations (especially first access after creation)

3. **Known Tantivy issues**: [#2847](https://github.com/quickwit-oss/tantivy/issues/2847), [#2272](https://github.com/quickwit-oss/tantivy/issues/2272), [#2504](https://github.com/quickwit-oss/tantivy/issues/2504) document Windows-specific mmap problems.

4. **Cloud sync conflicts**: If the index directory is inside OneDrive/Dropbox/iCloud, the `.tantivy-writer.lock` and segment files may conflict across machines. Mitigation: place the index in a non-synced location (e.g., `%LOCALAPPDATA%`).

### Mitigations

| Issue | Mitigation |
|---|---|
| mmap handle retention | Close readers/writer before rebuild; retry rename with backoff |
| AV scanning | Add index directory to AV exclusion list (document in setup guide); retry file operations |
| Stale lock files | Detect `LockFailure`, check if owning process is alive, force-delete if crashed |
| Cloud sync | Default index path to `%LOCALAPPDATA%\TracePilot\search_index\` |
| Segment cleanup | Accept delayed cleanup; GC on next app start if needed |

### Panic/Failure Containment

If Tantivy panics during indexing inside `spawn_blocking`:
1. The `catch_unwind` boundary in the blocking task catches the panic
2. Mark the Tantivy index as "unhealthy" in app state
3. Log the error and surface it in the UI (e.g., "Search index needs rebuild")
4. On next app start, detect unhealthy state and trigger full rebuild from `search_content`
5. Rate-limit rebuild attempts to prevent infinite loops (max 3 attempts per app session)

---

## Schema Versioning

The Tantivy index needs its own versioning separate from SQLite migrations:

```rust
/// Schema version — bump when schema fields or tokenizer config change
const TANTIVY_SCHEMA_VERSION: u32 = 1;

/// Stored in a `meta.json` sidecar next to the index
#[derive(Serialize, Deserialize)]
struct TantivyIndexMeta {
    schema_version: u32,
    extractor_version: u32,  // matches search_extractor_version
    created_at: String,
    last_commit_at: Option<String>,
    session_count: u64,
    document_count: u64,
}
```

On startup: if `schema_version` or `extractor_version` doesn't match, trigger full rebuild.

---

## Alternative Considered: Optimize FTS5 Instead

> **Raised by GPT 5.4 review**: Before committing to Tantivy, consider whether FTS5 optimizations could close the gap.

### What Could Be Improved Without Tantivy

| Optimization | Potential Impact | Effort |
|---|---|---|
| Use explicit `bm25()` ranking function | Better relevance (already available!) | Low |
| Fix `sanitize_fts_query()` to allow column filters | Enable field-scoped search | Low |
| Fix query sanitizer to allow NEAR queries | Enable proximity search | Low |
| Cache facet queries (they change infrequently) | Eliminate 3 of 4 facet queries | Medium |
| Optimize snippet generation (limit content length) | Reduce 138ms bottleneck | Medium |
| Consolidate facet queries into single GROUP BY | Reduce round trips | Medium |

### What FTS5 Cannot Provide (Tantivy advantages that remain)

- **Fuzzy search** with Levenshtein distance — no FTS5 equivalent
- **Per-field BM25 boosting** (k1/b tuning) — FTS5's `bm25()` doesn't support this
- **Single-pass faceted aggregation** — FTS5 needs GROUP BY queries
- **Concurrent readers during writes** — SQLite WAL helps but is still single-writer
- **Sub-10ms search latency** on this corpus — FTS5's page-cache model has inherent overhead
- **Memory-mapped I/O** — more efficient than SQLite's page cache for read-heavy workloads

**Verdict**: FTS5 optimization is a viable LOW-EFFORT approach that addresses some pain points, but cannot match Tantivy's capabilities for fuzzy search, relevance tuning, and raw search performance. **Tantivy remains recommended**, but implementers should be aware that 30–50% of the perceived gap is due to underutilization of FTS5's existing features.

---

## Risk Assessment

### High Risk

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Windows mmap file locking | High | High | Backup-rename-cleanup strategy; retry with backoff; AV exclusion docs |
| Dual-write SQLite/Tantivy desync | Medium | High | Set `search_indexed_at` only after Tantivy commit; staleness auto-retry |

### Medium Risk

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tantivy API breaks (pre-1.0) | Medium | Medium | Pin exact version; treat upgrades as deliberate decisions |
| Build time regression | Medium | Medium | Only affects clean builds; CI caching mitigates |
| Segment merge latency spikes | Low-Medium | Medium | Tune `LogMergePolicy` for desktop; low CPU priority |
| Writer panic leaves index unhealthy | Low | Medium | `catch_unwind`; mark unhealthy; auto-rebuild on next start |
| Tokenizer mismatch (unicode61 vs custom) | Medium | Medium | Comprehensive tokenizer tests; visual diff of query results |
| Cloud sync conflicts (.lock files) | Medium | Medium | Default to non-synced `%LOCALAPPDATA%` path |

### Low Risk

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Index corruption on crash | Low | Low | Rebuild from `search_content` (< 15 seconds) |
| Binary size increase | Certain | Low | +2–4 MB is negligible for desktop app |
| Memory bloat during indexing | Low | Medium | 15 MB min writer; bounded by commit frequency |
| Data loss | None | N/A | `search_content` in SQLite is the source of truth; Tantivy is derived |

---

## Appendix A: Why Not Pure Tantivy (Replacing SQLite Entirely)?

We considered making Tantivy the sole data store, eliminating SQLite for search content. This was rejected because:

1. **Browse mode** (empty query, filter-only) is better served by SQLite's B-tree indexes on structured columns
2. **Context lookups** (`get_result_context`) need sequential row access by session_id + event_index — relational queries
3. **Analytics queries** depend on relational JOINs across sessions, tool_calls, incidents, etc.
4. **Schema migrations** are battle-tested with SQLite; Tantivy schema changes require full reindex
5. **Session metadata** (summaries, repos, branches) is used by 20+ non-search queries

The hybrid approach gives us the best of both worlds.

## Appendix B: Why Not `fst` + Custom Postings?

Building a custom search engine on `fst` would require:

1. Term dictionary (FST) — `fst` provides this
2. Postings lists (term → doc IDs + positions) — must build from scratch
3. Document storage — must build from scratch
4. Scoring (BM25 needs TF, DF, doc length) — must build from scratch
5. Phrase matching (needs positional postings) — must build from scratch
6. Snippet generation — must build from scratch
7. Faceted aggregation — must build from scratch
8. Incremental updates — must build from scratch (FST is immutable)
9. Segment merging — must build from scratch
10. Concurrent access — must build from scratch

This is literally what Tantivy is. Using `fst` directly would be reinventing the wheel with worse results.

## Appendix C: Tantivy RAM Footprint Deep Dive

With `MmapDirectory` (recommended for our use case):

### Steady-State (Reader Only, Between Indexing Runs)

| Component | RAM Usage | Notes |
|---|---|---|
| Segment metadata | ~100 bytes/segment | Typically 5–20 segments |
| Term dictionary (FST) | mmap'd, OS-managed | ~5–10 MB for our corpus |
| Postings lists | mmap'd, OS-managed | Hot pages cached by OS |
| Stored fields | mmap'd, OS-managed | Only loaded on doc retrieval |
| Searcher + reader | ~1 KB | Lightweight reference-counted handle |
| Query parsing | ~10 KB transient | Freed after query |
| **Total baseline** | **2–5 MB** | Plus OS page cache as needed |
| **Warm steady-state** | **15–30 MB** | After typical query workload |

### Peak (During Phase 2 Bulk Indexing)

| Component | RAM Usage | Notes |
|---|---|---|
| IndexWriter heap | **15 MB** minimum | Configurable; this is the floor |
| Merge thread buffers | 5–15 MB | 1–2 merge threads for desktop |
| New segment buffer | 5–10 MB | For in-progress segment |
| Reader mmap pages | 15–30 MB | Concurrent searches during indexing |
| **Total peak** | **30–60 MB** | During active indexing; drops to steady-state after commit |

### Concurrent Search Impact

Multiple concurrent searches share the same `IndexReader` (clone is O(1)). The mmap pages are shared at the OS level, so 5 concurrent searchers do NOT use 5× the memory. The main per-search overhead is:
- Collector allocations: ~1–10 KB per search
- Snippet buffers: ~10–100 KB per search (depends on result count and content length)

The OS page cache naturally evicts Tantivy pages when memory is needed by other apps, making this highly adaptive to system memory pressure.

---

*This analysis was conducted against a production TracePilot index with 270 sessions, 314,403 search content rows, and 101 MB of indexed text.*

---

## Appendix: Implementation Results

> Added after full implementation was completed and validated.

### Performance Benchmarks (Production Data: 314K rows, 174 sessions, release build)

| Metric | FTS5 | Tantivy | Speedup |
|--------|------|---------|---------|
| "error" (12K hits) | 133ms | 1.8ms | **72×** |
| "async await" (2.9K hits) | 45ms | 1.2ms | **36×** |
| "database migration" (619 hits) | 15ms | 2.0ms | **8×** |
| "fn main" (566 hits) | 6ms | 1.0ms | **6×** |
| Facets "error" | 201ms | 61ms | **3.3×** |
| Full index (314K rows) | N/A | 10.9s | 29K rows/sec |
| Incremental (12.5K row session) | N/A | 563ms | upsert 45ms + commit 515ms + reload 3ms |
| Index size on disk | 243 MB (full DB) | 99 MB | 59% smaller |

### Architecture Implemented

- **Hybrid approach**: Tantivy for deep content FTS, SQLite retained for browse mode, relational queries, and session metadata
- **Dual-write pipeline**: SQLite first → Tantivy second → commit after batch
- **Result hydration**: Tantivy returns hits → `batch_session_metadata` from SQLite
- **Facets**: Single-pass segment-level aggregation (no cap), drill-sideways for filtered dimensions
- **State management**: `TantivyState(Arc<TantivySearchIndex>)` registered as Tauri managed state
- **Migration 10**: Drops FTS5 sync triggers (~15-20% write overhead reduction)

### Key Files

| File | Purpose |
|------|---------|
| `crates/tracepilot-indexer/src/tantivy_index/mod.rs` | TantivySearchIndex wrapper |
| `crates/tracepilot-indexer/src/tantivy_index/schema.rs` | Schema + custom tokenizer |
| `crates/tracepilot-indexer/src/tantivy_index/writer.rs` | Document mapping + upsert |
| `crates/tracepilot-indexer/src/tantivy_index/reader.rs` | Query, search, count, facets |
| `crates/tracepilot-tauri-bindings/src/commands/search.rs` | Tauri command routing |

### Issues Found and Fixed During 3-Agent Review

1. **UTF-8 panic** — `&c[..300]` could panic on multi-byte chars → replaced with `is_char_boundary` safe truncation
2. **`id: 0` for all results** — broke Vue keys, expand state, and context lookup → sequential negative IDs + `get_result_context_by_key` command
3. **Dual-write data loss** — Tantivy failure left sessions permanently unindexed → reset `search_indexed_at` on failure for retry
4. **500K facet cap** — truncated aggregations on large result sets → segment-level `Weight`/`Scorer` iteration with no cap

### Test Coverage

- 504 Rust workspace tests passing (103 indexer, 197 core, 84 export, 52 orchestrator, etc.)
- 417 desktop frontend tests passing
- TypeScript typecheck clean
