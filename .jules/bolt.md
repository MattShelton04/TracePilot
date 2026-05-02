## 2024-05-02 - Eliminate Integer Formatting Overhead in Batch SQL Generation
**Learning:** Using sequential `?` bindings instead of indexed bindings (like `?1`, `?2`) in `rusqlite` batch inserts eliminates significant integer formatting overhead when constructing large parameterised SQL query strings.
**Action:** When creating batch insert queries, always use simple sequential bindings with `String::push('?')` rather than `std::fmt::Write` or `format_args!` to format indexed parameters.
