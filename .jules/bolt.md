## 2024-05-23 - Fast SQL Placeholder Generation
**Learning:** Generating dynamic SQL placeholder strings character-by-character (e.g. `push(',')`, `push('?')` or conditionals within loops) causes unnecessary overhead. Using `.push_str(", ?")` enables direct, optimized memory copies of the pre-allocated byte slice and avoids looping overhead.
**Action:** When pre-allocating memory for batch operations, extract the first iteration before the loop (checking for edge cases like `n=0`) and use chunk slice additions via `push_str()` instead of scalar character additions.
