use rusqlite::types::ToSql;

/// Build a WHERE clause for date range + repo filtering on the sessions table.
///
/// Returns `(where_clause, bind_values)` where `where_clause` starts with
/// `" WHERE 1=1"` and may include additional AND conditions.
///
/// Uses anonymous `?` placeholders (consistent with the other helpers in this
/// module). Callers pass
/// the returned `bind_values` through `to_refs` + `params_from_iter`.
pub(in crate::index_db) fn build_date_repo_filter(
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
) -> (String, Vec<String>) {
    let mut clause = String::from(" WHERE 1=1");
    let mut values: Vec<String> = Vec::new();

    if hide_empty {
        clause.push_str(" AND s.turn_count IS NOT NULL AND s.turn_count > 0");
    }

    if let Some(from) = from_date {
        values.push(from.to_string());
        clause.push_str(
            " AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL))",
        );
    }
    if let Some(to) = to_date {
        values.push(to.to_string());
        clause.push_str(
            " AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL))",
        );
    }
    if let Some(repo) = repo {
        values.push(repo.to_string());
        clause.push_str(" AND s.repository = ?");
    }

    (clause, values)
}

/// Append timestamp-range conditions for a specific column to an existing WHERE clause.
///
/// Per-day aggregation queries join `session_segments` and group by segment
/// timestamps (e.g. `m.end_timestamp`).  Without this extra filter the
/// session-level date guard (`build_date_repo_filter`) only restricts *which
/// sessions* appear, but a session updated on the last day of the range can
/// have segments on days well outside the window — those segment dates then
/// leak into the chart as spurious data points.
///
/// This function appends `AND date(<col>) >= ?` / `AND date(<col>) <= ?`
/// conditions and the matching bind values so the segment timestamps are
/// clamped to the same window as the session filter.
pub(in crate::index_db) fn append_segment_date_filter(
    clause: &str,
    values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
    col: &str,
) -> (String, Vec<String>) {
    let mut new_clause = clause.to_string();
    let mut new_values = values.to_vec();

    if let Some(from) = from_date {
        new_values.push(from.to_string());
        new_clause.push_str(&format!(" AND date({col}) >= ?"));
    }
    if let Some(to) = to_date {
        new_values.push(to.to_string());
        new_clause.push_str(&format!(" AND date({col}) <= ?"));
    }

    (new_clause, new_values)
}

/// Build an equality filter (e.g., `col = ?`).
/// Returns the SQL fragment and appends the parameter to the provided vector.
///
/// This is a pure function with no side effects other than appending to `params`.
pub(in crate::index_db) fn build_eq_filter<T: ToSql + 'static>(
    column: &str,
    value: T,
    params: &mut Vec<Box<dyn ToSql>>,
) -> String {
    params.push(Box::new(value));
    format!(" AND {} = ?", column)
}
