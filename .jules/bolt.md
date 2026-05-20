## 2024-05-20 - Optimize SQL Placeholders chunk addition
**Learning:** Using `push_str()` with pre-combined string chunks instead of scalar character-by-character `push()` calls leverages direct memory copy of byte slices in pre-allocated Strings, reducing CPU instructions.
**Action:** Always prefer `push_str(", ?")` over sequentially calling `push(',')`, `push(' ')`, `push('?')` or equivalent logic in Rust loop bodies, while ensuring edge cases like `n=0` are explicitly handled when extracting the first character push outside the loop.
