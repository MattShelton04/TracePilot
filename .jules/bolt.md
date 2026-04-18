## 2024-05-14 - Rust rusqlite batch insert optimal patterns
**Learning:** When dynamically generating large SQL placeholder strings in Rust for batch inserts (e.g. `(?,?),(?,?)`), using a functional `.map().collect().join()` chain causes excessive intermediate memory allocations (`String` and `Vec`).
**Action:** Instead, pre-allocate a `String` with an estimated capacity (`String::with_capacity()`) and use `std::fmt::Write` (`write!`) to append directly to the buffer.
