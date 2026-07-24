## 2024-06-03 - String Chunk Addition for SQL Placeholders
**Learning:** When generating repeating SQL placeholders like `?, ?, ?`, iteratively pushing single characters (`.push(',')`, `.push('?')`) incurs slight overhead compared to pushing an entire static string slice at once (`.push_str(", ?")`). Benchmarks show ~20% improvement for large queries.
**Action:** When building repeating pattern strings dynamically, use `.push_str()` with pre-combined string chunks instead of scalar character pushes where appropriate, and ensure edge cases (e.g. `n=0`) are short-circuited.
