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
    if n > 0 {
        s.push('?');
        for _ in 1..n {
            s.push_str(", ?");
        }
    }
    s
}

/// Build a complete `INSERT … VALUES (?,?),(…)` SQL string into a single
/// pre-allocated buffer, using sequential bind parameters.
///
/// Avoids all intermediate `String`/`Vec` allocations that a `.map().collect().join()`
/// chain produces (~600 per 50-row × 9-column batch).
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
    if num_rows == 0 || params_per_row == 0 {
        return sql_prefix.to_string();
    }

    let mut sql = String::with_capacity(
        sql_prefix.len() + 1 + num_rows * (params_per_row * 2 + 1) + num_rows - 1,
    );
    sql.push_str(sql_prefix);
    sql.push(' ');

    // PERF: push_str avoids bounds checking for each character compared to individual .push()
    let mut row_str = String::with_capacity(params_per_row * 2 + 1);
    row_str.push_str("(?");
    for _ in 1..params_per_row {
        row_str.push_str(",?");
    }
    row_str.push(')');

    sql.push_str(&row_str);
    for _ in 1..num_rows {
        sql.push(',');
        sql.push_str(&row_str);
    }
    sql
}
