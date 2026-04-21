//! Multi-row INSERT batching for SQLite child-table writes.
//!
//! Instead of executing N individual `INSERT ... VALUES (?)` statements,
//! this builds `INSERT ... VALUES (?,...),(?,...), ...` in chunks of 100,
//! reducing statement count from N to ⌈N/100⌉. Within an explicit
//! transaction (SAVEPOINT), the main win is fewer SQLite VM step() calls.

use crate::Result;
use rusqlite::ToSql;
use tracepilot_core::utils::sqlite::build_placeholder_sql;

/// Maximum rows per multi-row INSERT statement.
///
/// Empirically tuned via `cargo bench -p tracepilot-bench --bench batch_size`.
///
/// The motivating hot path is `search_writer::upsert_search_content`, which
/// inserts ~1 row per searchable event (each row fires an FTS5 trigger) — so
/// a 10 000-event session produces ~5 000–8 000 rows in a single batch.
/// Benchmarks at this real-world scale (500–10 000 rows, 8-column
/// `search_content` schema **with FTS5 trigger**) show:
///
/// | chunk | 500 rows | 5 000 rows | 10 000 rows |
/// |-------|----------|------------|-------------|
/// |    25 | 164 K/s  |   143 K/s  |   135 K/s   |
/// |    50 | 187 K/s  |   156 K/s  |   147 K/s   |
/// |   100 | 189 K/s  |   165 K/s  |   157 K/s   |
/// |   500 | 199 K/s  |   181 K/s  |   177 K/s   |
/// |  1000 | 196 K/s  |   168 K/s  |   184 K/s   |
///
/// chunk=100 is **+16 % faster than 25** and **+7 % faster than 50**
/// consistently across all row counts, with good stability. Very large chunks
/// (500+) show diminishing returns and higher variance.
///
/// The FTS5 trigger fires per-row regardless of chunk size, so the dominant
/// cost is fixed per-row overhead — larger chunks amortize the per-statement
/// `prepare()` cost more effectively than was apparent in a trigger-free schema.
///
/// The session_writer analytics tables (model_metrics, tool_calls, etc.) always
/// write <25 rows even for large sessions, so they always take the partial-chunk
/// path and are unaffected by this constant.
///
/// 100 × 9 = 900 bind params (widest child table) — well within SQLite's
/// `SQLITE_MAX_VARIABLE_NUMBER` of 32 766 (since 3.32).
const BATCH_CHUNK_SIZE: usize = 100;

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
    mut to_params: F,
) -> Result<()>
where
    F: for<'b> FnMut(&'a T, &'b mut Vec<&'a dyn ToSql>),
{
    if items.is_empty() {
        return Ok(());
    }

    // Cache the prepared statement for full chunks.
    // Re-preparing the same 100-row statement inside the loop is a major bottleneck
    // when writing thousands of rows. Caching it here bypasses `sqlite3_prepare_v2`
    // for everything except the final partial chunk.
    let mut full_stmt_cache: Option<rusqlite::Statement<'_>> = None;

    for chunk in items.chunks(BATCH_CHUNK_SIZE) {
        if chunk.len() == BATCH_CHUNK_SIZE {
            if full_stmt_cache.is_none() {
                let sql = build_placeholder_sql(sql_prefix, BATCH_CHUNK_SIZE, params_per_row);
                full_stmt_cache = Some(conn.prepare(&sql)?);
            }
            let stmt = full_stmt_cache.as_mut().unwrap();

            let mut params: Vec<&'a dyn ToSql> = Vec::with_capacity(chunk.len() * params_per_row);
            for item in chunk {
                to_params(item, &mut params);
            }

            stmt.execute(rusqlite::params_from_iter(params))?;
        } else {
            // Partial chunk logic remains dynamic to avoid polluting SQLite's statement cache
            let sql = build_placeholder_sql(sql_prefix, chunk.len(), params_per_row);
            let mut stmt = conn.prepare(&sql)?;

            let mut params: Vec<&'a dyn ToSql> = Vec::with_capacity(chunk.len() * params_per_row);
            for item in chunk {
                to_params(item, &mut params);
            }

            stmt.execute(rusqlite::params_from_iter(params))?;
        }
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
