//! Multi-row INSERT batching for SQLite child-table writes.
//!
//! Replaces chunked multi-statement inserts with `json_each` bulk inserts.
//! This bypasses `SQLITE_MAX_VARIABLE_NUMBER` limits entirely and eliminates
//! Rust-side loop execution overhead.

use crate::Result;
use serde_json::Value as JsonValue;

/// Execute a bulk INSERT using SQLite's `json_each` extension.
///
/// Converts the items to a JSON array of arrays, and uses a single SQL statement.
/// `sql_prefix` is everything up to the SELECT part, e.g.
/// `"INSERT INTO t (a, b) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)"`.
pub(crate) fn json_each_insert<T>(
    conn: &rusqlite::Connection,
    sql: &str,
    items: &[T],
    to_json_values: impl Fn(&T) -> Vec<JsonValue>,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let json_arr: Vec<JsonValue> = items
        .iter()
        .map(|item| JsonValue::Array(to_json_values(item)))
        .collect();

    let json_str = serde_json::to_string(&json_arr).expect("Failed to serialize array to JSON");

    let mut stmt = conn.prepare(sql)?;
    stmt.execute([json_str])?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    #[test]
    fn empty_items_is_noop() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a TEXT, b INTEGER)")
            .unwrap();
        let items: Vec<(String, i64)> = vec![];
        json_each_insert(
            &conn,
            "INSERT INTO t (a, b) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)",
            &items,
            |_| unreachable!(),
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn inserts_items() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (v INTEGER)").unwrap();
        let items: Vec<i64> = (0..100).collect();
        json_each_insert(
            &conn,
            "INSERT INTO t (v) SELECT json_extract(value, '$[0]') FROM json_each(?)",
            &items,
            |&v| vec![json!(v)],
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 100);
    }

    #[test]
    fn handles_multi_column_with_nulls() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a TEXT, b TEXT)")
            .unwrap();
        let items = vec![
            (String::from("x"), Some(String::from("y"))),
            (String::from("z"), None),
        ];
        json_each_insert(
            &conn,
            "INSERT INTO t (a, b) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)",
            &items,
            |(a, b)| {
                vec![
                    json!(a),
                    match b {
                        Some(s) => json!(s),
                        None => JsonValue::Null,
                    },
                ]
            },
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let null_count: i64 = conn
            .query_row("SELECT count(*) FROM t WHERE b IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(null_count, 1);
    }
}
