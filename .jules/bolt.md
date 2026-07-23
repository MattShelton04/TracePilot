## 2024-11-20 - Memory-Efficient SQL Placeholders
**Learning:** When dynamically generating large SQL placeholder strings in Rust for batch inserts, use chunk slice additions via `.push_str()` (e.g., `.push_str(", ?")`) directly onto a pre-allocated string instead of scalar character-by-character pushes (`.push(',')`, `.push('?')`). `push_str` performs a direct, optimized memory copy of the pre-allocated byte slice.
**Action:** Explicitly check and short-circuit edge cases like `n=0` before loops, extract the first chunk, and use `.push_str()` for the rest.
