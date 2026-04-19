//! Multi-row INSERT batching for SQLite child-table writes.
//!
//! Instead of executing N individual `INSERT ... VALUES (?)` statements,
//! this builds `INSERT ... VALUES (?,...),(?,...), ...` in chunks of 25,
//! reducing statement count from N to ⌈N/25⌉. Within an explicit
//! transaction (SAVEPOINT), the main win is fewer SQLite VM step() calls.

use crate::Result;
use rusqlite::ToSql;
use tracepilot_core::utils::sqlite::build_placeholder_sql;

/// Maximum rows per multi-row INSERT statement.
///
/// Empirically tuned via `cargo bench -p tracepilot-bench --bench batch_size`.
///
/// The motivating hot path is `search_writer::upsert_search_content`, which
/// inserts ~1 row per searchable event — so a 10 000-event session produces
/// ~5 000–8 000 rows in a single batch. Benchmarks at this real-world scale
/// (500–10 000 rows, 8-column `search_content` schema) show:
///
/// | chunk | 500 rows | 2 500 rows | 5 000 rows | 10 000 rows |
/// |-------|----------|------------|------------|-------------|
/// |    25 | 542 K/s  |   551 K/s  |   549 K/s  |   543 K/s   |
/// |    50 | 483 K/s  |   489 K/s  |   486 K/s  |   476 K/s   |
/// |   100 | 461 K/s  |   445 K/s  |   456 K/s  |   457 K/s   |
/// |  4000 | 442 K/s  |   419 K/s  |   434 K/s  |   425 K/s   |
///
/// Chunk = 25 is **+14 % faster** than 50 at 10 000 rows, and **+28 %** vs 4 000.
/// Very large chunks are *worse* because SQLite's statement parser/compiler
/// overhead grows super-linearly with bind-parameter count.
///
/// 25 × 9 = 225 bind params (widest child table) — well within SQLite's
/// `SQLITE_MAX_VARIABLE_NUMBER` of 32 766 (since 3.32).
const BATCH_CHUNK_SIZE: usize = 25;

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

    // All full-sized chunks share the same SQL shape — build it once.
    // Only the (optional) trailing partial chunk needs a different string.
    let full_sql = build_placeholder_sql(sql_prefix, BATCH_CHUNK_SIZE, params_per_row);

    for chunk in items.chunks(BATCH_CHUNK_SIZE) {
        let partial;
        let sql: &str = if chunk.len() == BATCH_CHUNK_SIZE {
            &full_sql
        } else {
            partial = build_placeholder_sql(sql_prefix, chunk.len(), params_per_row);
            &partial
        };

        let mut stmt = conn.prepare(sql)?;

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
    fn build_placeholder_sql_single_row_single_col() {
        let sql = build_placeholder_sql("INSERT INTO t (v) VALUES", 1, 1);
        assert_eq!(sql, "INSERT INTO t (v) VALUES (?1)");
    }

    #[test]
    fn build_placeholder_sql_multi_row_multi_col() {
        let sql = build_placeholder_sql("INSERT INTO t (a,b) VALUES", 2, 2);
        assert_eq!(sql, "INSERT INTO t (a,b) VALUES (?1,?2),(?3,?4)");
    }

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
