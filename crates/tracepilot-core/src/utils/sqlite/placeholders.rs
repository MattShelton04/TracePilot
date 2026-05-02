/// Build a `?, ?, …` placeholder string for SQL `IN (…)` / `NOT IN (…)` clauses.
///
/// Uses a single pre-allocated buffer, avoiding the intermediate `Vec<&str>` + `String`
/// that `.map(|_| "?").collect::<Vec<_>>().join(", ")` would produce.
///
/// # Example
/// ```
/// use tracepilot_core::utils::sqlite::build_in_placeholders;
/// assert_eq!(build_in_placeholders(3), "?, ?, ?");
/// assert_eq!(build_in_placeholders(1), "?");
/// ```
#[must_use]
pub fn build_in_placeholders(n: usize) -> String {
    debug_assert!(
        n > 0,
        "build_in_placeholders requires n > 0; n=0 produces empty string that makes IN () invalid SQL"
    );
    // Each element is "?" (1 char) + ", " (2 chars) except the last → n*3 max.
    let mut s = String::with_capacity(n * 3);
    for i in 0..n {
        if i > 0 {
            s.push_str(", ");
        }
        s.push('?');
    }
    s
}

/// Build a complete `INSERT … VALUES (?,?),(…)` SQL string into a single
/// pre-allocated buffer, using sequential bind parameters.
///
/// Avoids all intermediate `String`/`Vec` allocations that a `.map().collect().join()`
/// chain produces (~600 per 50-row × 9-column batch). Uses sequential bindings (`?`)
/// rather than indexed bindings (`?1`, `?2`) to eliminate integer formatting overhead.
///
/// # Arguments
/// * `sql_prefix` — everything up to and including the `VALUES` keyword,
///   e.g. `"INSERT INTO t (a, b) VALUES"`
/// * `num_rows` — number of row tuples to generate
/// * `params_per_row` — number of bind parameters per tuple
///
/// # Example
/// ```
/// use tracepilot_core::utils::sqlite::build_placeholder_sql;
/// assert_eq!(
///     build_placeholder_sql("INSERT INTO t (a,b) VALUES", 2, 2),
///     "INSERT INTO t (a,b) VALUES (?,?),(?,?)",
/// );
/// ```
#[must_use]
pub fn build_placeholder_sql(sql_prefix: &str, num_rows: usize, params_per_row: usize) -> String {
    debug_assert!(num_rows > 0, "build_placeholder_sql requires num_rows > 0");
    debug_assert!(
        params_per_row > 0,
        "build_placeholder_sql requires params_per_row > 0"
    );
    // Each row is `(` + `?,` * (params - 1) + `?` + `)` + `,` separator
    // Length per row tuple (excluding the trailing comma) is 1 + (params_per_row * 2 - 1) + 1 = params_per_row * 2 + 1
    // Total added capacity is num_rows * (params_per_row * 2 + 1) + num_rows - 1
    let row_len = params_per_row * 2 + 1;
    let mut sql = String::with_capacity(
        sql_prefix.len() + 1 + num_rows * row_len + num_rows.saturating_sub(1),
    );
    sql.push_str(sql_prefix);
    sql.push(' ');
    for i in 0..num_rows {
        if i > 0 {
            sql.push(',');
        }
        sql.push('(');
        for j in 0..params_per_row {
            if j > 0 {
                sql.push(',');
            }
            sql.push('?');
        }
        sql.push(')');
    }
    sql
}
