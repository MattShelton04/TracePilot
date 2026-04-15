//! Multi-row INSERT batching for SQLite child-table writes.
//!
//! Instead of executing N individual `INSERT ... VALUES (?)` statements,
//! this builds `INSERT ... VALUES (?,...),(?,...), ...` in chunks of 50,
//! reducing statement count from N to ⌈N/50⌉. Within an explicit
//! transaction (SAVEPOINT), the main win is fewer SQLite VM step() calls.

use crate::Result;
use rusqlite::ToSql;

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
/// The `to_params` closure is called once per row to append borrowed parameters
/// to the provided vector. This avoids cloning strings — params are borrowed
/// from the source data.
///
/// # Example
///
/// ```ignore
/// batched_insert(
///     &conn,
///     "INSERT INTO t (id, name) VALUES",
///     2,
///     &rows,
///     |row, params| {
///         params.push(&row.id);
///         params.push(&row.name);
///     },
/// )?;
/// ```
///
/// Uses `prepare()` — **not** `prepare_cached()` — because the SQL string
/// varies by chunk size (the last chunk is typically smaller).
pub(crate) fn batched_insert<'a, T, F>(
    conn: &rusqlite::Connection,
    sql_prefix: &str,
    params_per_row: usize,
    items: &'a [T],
    to_params: F,
) -> Result<()>
where
    F: for<'b> Fn(&'a T, &'b mut Vec<&'a dyn ToSql>),
{
    if items.is_empty() {
        return Ok(());
    }

    use std::fmt::Write;

    for chunk in items.chunks(BATCH_CHUNK_SIZE) {
        // Pre-allocate a String to avoid excessive allocations in `.map().join()`.
        // Estimated capacity: prefix + space + (len * params * 6 chars) + (len * 3 chars)
        let mut sql = String::with_capacity(
            sql_prefix.len() + 1 + chunk.len() * params_per_row * 6 + chunk.len() * 3,
        );
        sql.push_str(sql_prefix);
        sql.push(' ');

        for i in 0..chunk.len() {
            if i > 0 {
                sql.push(',');
            }
            sql.push('(');
            let start = i * params_per_row + 1;
            for n in start..start + params_per_row {
                if n > start {
                    sql.push(',');
                }
                write!(&mut sql, "?{n}").unwrap();
            }
            sql.push(')');
        }

        let mut stmt = conn.prepare(&sql)?;

        let mut params: Vec<&'a dyn ToSql> = Vec::with_capacity(chunk.len() * params_per_row);
        for item in chunk {
            to_params(item, &mut params);
        }

        stmt.execute(rusqlite::params_from_iter(params))?;
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
        conn.execute_batch("CREATE TABLE t (a TEXT, b INTEGER)")
            .unwrap();
        let items: Vec<(String, i64)> = vec![];
        batched_insert(
            &conn,
            "INSERT INTO t (a, b) VALUES",
            2,
            &items,
            |_, _| unreachable!(),
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
        batched_insert(&conn, "INSERT INTO t (v) VALUES", 1, &items, |v, params| {
            params.push(v);
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
        batched_insert(&conn, "INSERT INTO t (v) VALUES", 1, &items, |v, params| {
            params.push(v);
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
        conn.execute_batch("CREATE TABLE t (a TEXT, b TEXT)")
            .unwrap();
        let items = vec![
            (String::from("x"), Some(String::from("y"))),
            (String::from("z"), None),
        ];
        batched_insert(
            &conn,
            "INSERT INTO t (a, b) VALUES",
            2,
            &items,
            |(a, b), params| {
                params.push(a as &dyn ToSql);
                match b {
                    Some(s) => params.push(s as &dyn ToSql),
                    None => params.push(&rusqlite::types::Null),
                }
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
