
## 2024-04-25 - Avoid integer formatting overhead in SQLite batch inserts
**Learning:** When dynamically generating large SQL placeholder strings in Rust for batch inserts with `rusqlite`, using indexed parameters (`?1`, `?2`) with `std::fmt::Write` creates significant integer formatting overhead. Benchmarks show that generating the placeholder string with `write!(&mut sql, "?{n}")` takes ~3 seconds for 100,000 iterations of 100 rows * 8 columns.
**Action:** Use anonymous sequential bindings (`?`) with simple byte pushes (e.g., `sql.push('?')`) rather than indexed parameters. This eliminates the integer formatting overhead and is ~20x faster (takes ~150ms for the same benchmark).
