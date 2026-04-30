## 2025-05-01 - Optimized string manipulation for SQLite array parameters
**Learning:** Found a bottleneck in `build_placeholder_sql` used for batch inserts using string formatters with digits like `?1, ?2`. By rewriting it to use anonymous parameters `?, ?` and duplicating the repeated row snippet byte-wise, performance is vastly improved with fewer allocations.
**Action:** Always prefer anonymous SQLite bindings `?， ?` where appropriate instead of explicit indexed format parameters `?1` when generating SQL statements dynamically with strings.
