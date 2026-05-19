## 2024-05-19 - Fast SQL Placeholder Generation
**Learning:** Scalar character pushes (`.push(',')`, `.push('?')`) in a loop introduce unnecessary per-character bounds checking and memory access overhead. Using `.push_str(", ?")` performs a direct, optimized memory copy.
**Action:** Extract the first element push before the loop and use `.push_str` for multi-character chunks in string-building loops.
