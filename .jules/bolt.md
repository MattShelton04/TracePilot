## 2024-05-11 - Rust Memory Allocation Optimizations
**Learning:** Avoid `String::push(char)` when building chunked strings like SQL placeholders. Instead use `String::push_str(&str)` for exact chunk copies, which outperforms pushing characters since `push(char)` incurs overhead encoding characters to UTF-8. Keep intermediate allocations for chunks that will be appended repeatedly (O(n) vs iteratively rebuilding O(n * m)).
**Action:** When working on Rust batch insert optimizations, verify `push_str(", ?")` is used instead of iterative character pushing for chunks.
