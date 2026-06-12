## 2024-05-13 - Optimize SQL Placeholder Generation
**Learning:** Using `push_str(", ?")` performs direct optimized memory copy of the byte slice, avoiding multiple scalar character pushes (`.push(,)`, `.push(?)`). Also, pre-building chunks once and appending that exact string multiple times is O(num_rows) and outperforms iteratively re-generating.
**Action:** Apply `push_str` with byte slices in string generation, while keeping chunk pre-building for repeating rows.
