
## 2025-05-18 - Optimized sqlite batch insertion
**Learning:** In the `tracepilot-indexer` crate, batch insertion into SQLite with rusqlite recompiled the prepared statement inside a loop. This caused a performance bottleneck when inserting thousands of rows.
**Action:** When performing `rusqlite` batch operations with chunked data arrays in Rust, explicitly cache the prepared `rusqlite::Statement` object (rather than just the SQL string) for full-sized chunks to avoid the overhead of recompiling the statement inside a loop.
