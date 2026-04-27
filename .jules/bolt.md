
## 2024-04-27 - Optimize batch INSERT placeholder generation
**Learning:** Generating dynamically sized SQL placeholder strings using `std::fmt::Write` with numbered parameters (`?1`) introduces significant integer formatting overhead. Using anonymous sequential bindings (`?`) and appending directly to the `String` with simple byte pushes (e.g., `String::push('?')`) avoids intermediate integer calculations and is drastically faster.
**Action:** When dynamically generating large SQL placeholder strings for batch inserts with `rusqlite`, use anonymous placeholders and bypass `format!` or integer writing. Pre-allocate the `String` optimally based on expected string length based on `params_per_row` and `num_rows`.
