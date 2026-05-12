## 2024-05-12 - Initializing Bolt Journal
**Learning:** Found need to document critical performance learnings.
**Action:** Always document critical learnings.
## 2024-05-12 - Optimized dynamic SQL placeholder generation
**Learning:** Generating SQL placeholder strings (like `?, ?, ?`) dynamically using iterators (`.map(|_| "?").collect::<Vec<_>>().join(", ")`) creates numerous intermediate allocations.
**Action:** Use pre-allocated Strings with exact capacity and `.push_str()` instead of `.push()` to perform direct memory copies for significant performance gains.
