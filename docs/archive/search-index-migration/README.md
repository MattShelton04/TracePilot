# Search Index Migration: FTS5 → Tantivy

This folder documents the attempt to replace TracePilot's SQLite FTS5 search index with [Tantivy](https://github.com/quickwit-oss/tantivy), a Rust-native full-text search engine.

## Documents

| File | Description |
|------|-------------|
| [retrospective.md](retrospective.md) | Full post-mortem: what worked, what broke, root causes, lessons |
| [implementation-guide.md](implementation-guide.md) | Exact steps to re-attempt this migration successfully |
| [architecture.md](architecture.md) | Tantivy module design, schema, and integration points |
| [benchmarks.md](benchmarks.md) | Performance data collected during the attempt |

## Status

**Shelved** — The implementation worked for search queries (72× faster than FTS5) but introduced critical CPU regressions in aggregation paths (facets, stats, health). The core Tantivy search is sound; the aggregation layer needs a fundamentally different approach.

## Branch

All implementation code lives on `feat/fst-search-index` (not merged). The branch contains 17 commits with a working but unstable implementation. This documentation is the only artifact committed to main.
