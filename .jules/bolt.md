## YYYY-MM-DD - [Dynamic batch SQL placeholders]
**Learning:** `build_placeholder_sql` generates numbered bind parameters (`?1, ?2`) dynamically for batch inserts, which imposes significant memory allocation overhead.
**Action:** Use anonymous sequential bindings (`?`) and `String::push('?')` instead to optimize large `rusqlite` batch inserts.
