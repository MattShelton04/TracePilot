//! Multi-row INSERT batching for SQLite child-table writes.
//!
//! Instead of executing N individual `INSERT ... VALUES (?)` statements,
//! this builds `INSERT ... VALUES (?,...),(?,...), ...` in chunks of 50,
//! reducing statement count from N to ⌈N/50⌉. Within an explicit
//! transaction (SAVEPOINT), the main win is fewer SQLite VM step() calls.

use crate::Result;
use rusqlite::types::Value;

/// Maximum rows per multi-row INSERT statement.
///
/// With 9 columns (the widest child table), 50 × 9 = 450 bind parameters,
/// well within SQLite's `SQLITE_MAX_VARIABLE_NUMBER` (32 766 since 3.32).
const BATCH_CHUNK_SIZE: usize = 50;

/// Execute a multi-row INSERT in chunks of up to [`BATCH_CHUNK_SIZE`] rows.
///
/// `sql_prefix` is everything up to (but not including) the first VALUES
/// tuple, e.g. `"INSERT INTO t (a, b) VALUES"`.
///
/// Uses `prepare()` — **not** `prepare_cached()` — because the SQL string
/// varies by chunk size (the last chunk is typically smaller).
pub(crate) fn batched_insert<T>(
    conn: &rusqlite::Connection,
    sql_prefix: &str,
    params_per_row: usize,
    items: &[T],
    to_values: impl Fn(&T) -> Vec<Value>,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    for chunk in items.chunks(BATCH_CHUNK_SIZE) {
        let placeholders: String = (0..chunk.len())
            .map(|i| {
                let start = i * params_per_row + 1;
                let p: String = (start..start + params_per_row)
                    .map(|n| format!("?{n}"))
                    .collect::<Vec<_>>()
                    .join(",");
                format!("({p})")
            })
            .collect::<Vec<_>>()
            .join(",");

        let sql = format!("{sql_prefix} {placeholders}");
        let mut stmt = conn.prepare(&sql)?;

        let values: Vec<Value> = chunk.iter().flat_map(&to_values).collect();
        stmt.execute(rusqlite::params_from_iter(values.iter()))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn empty_items_is_noop() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a TEXT, b INTEGER)").unwrap();
        let items: Vec<(String, i64)> = vec![];
        batched_insert(
            &conn,
            "INSERT INTO t (a, b) VALUES",
            2,
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
    fn inserts_exact_chunk_boundary() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (v INTEGER)").unwrap();
        // Insert exactly BATCH_CHUNK_SIZE items
        let items: Vec<i64> = (0..BATCH_CHUNK_SIZE as i64).collect();
        batched_insert(&conn, "INSERT INTO t (v) VALUES", 1, &items, |&v| {
            vec![Value::Integer(v)]
        })
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, BATCH_CHUNK_SIZE as i64);
    }

    #[test]
    fn inserts_across_chunk_boundary() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (v INTEGER)").unwrap();
        let n = BATCH_CHUNK_SIZE as i64 + 7;
        let items: Vec<i64> = (0..n).collect();
        batched_insert(&conn, "INSERT INTO t (v) VALUES", 1, &items, |&v| {
            vec![Value::Integer(v)]
        })
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, n);
    }

    #[test]
    fn handles_multi_column_with_nulls() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a TEXT, b TEXT)").unwrap();
        let items = vec![
            (String::from("x"), Some(String::from("y"))),
            (String::from("z"), None),
        ];
        batched_insert(
            &conn,
            "INSERT INTO t (a, b) VALUES",
            2,
            &items,
            |(a, b)| {
                vec![
                    Value::Text(a.clone()),
                    match b {
                        Some(s) => Value::Text(s.clone()),
                        None => Value::Null,
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
