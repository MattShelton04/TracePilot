
## 2024-11-20 - Fast SQL Placeholder Generation for SQLite Batch Inserts
**Learning:** Generating string placeholders for multi-row `INSERT` queries (e.g., `(?, ?), (?, ?)`) using Iterator `.map()`, `format!()`, and `.join(",")` incurs heavy performance penalties due to thousands of intermediate `String` and `Vec` allocations per batch chunk.
**Action:** When dynamically generating large SQL queries or parameter strings in Rust, pre-allocate a `String` with an estimated capacity using `String::with_capacity()` and append to it directly using `std::fmt::Write::write!`. This drastically minimizes memory fragmentation and CPU overhead, yielding 2x-3x speedups in string building benchmarks.
