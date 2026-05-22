## 2024-05-22 - Optimize String placeholder generation with push_str
**Learning:** Using `push_str(",?")` inside a loop for generating SQL placeholders is faster than multiple single character `push()` calls, as it uses optimized memory copy instead of iterating character by character.
**Action:** When repeatedly appending strings in loops to pre-allocated capacity, prefer `push_str()` over individual char pushes to maximize throughput.
