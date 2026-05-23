## 2024-05-24 - Optimize dynamic SQL placeholder string generation in Rust
**Learning:** When generating large SQL placeholder strings dynamically, using `.push_str()` with pre-calculated chunks directly onto a pre-allocated String avoids repeated memory allocation and iteration costs.
**Action:** Always pre-calculate the exact capacity using standard arithmetic and append chunk slices via `.push_str()` instead of iteratively pushing scalar characters like `.push(',')` and `.push('?')`. Check edge cases like `n=0` to prevent runtime panics.
