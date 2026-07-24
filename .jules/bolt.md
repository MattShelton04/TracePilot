## 2024-05-24 - Dynamic SQL Placeholder Generation
**Learning:** For dynamic SQL generation, pushing chunks directly with `push_str(", ?")` is faster than sequential scalar character pushes with `push()` inside a loop.
**Action:** Always prefer pre-allocating an exact capacity `String` and using `push_str` for chunked insertions over individual scalar pushes.
