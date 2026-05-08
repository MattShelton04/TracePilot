use crate::Result;
use rusqlite::{Connection, params_from_iter, types::ToSql};

pub(in crate::index_db) fn to_refs(values: &[String]) -> Vec<&dyn ToSql> {
    values.iter().map(|v| v as &dyn ToSql).collect()
}

pub(in crate::index_db) fn execute_query_map<T, F, P>(
    conn: &Connection,
    sql: &str,
    params: P,
    mut mapper: F,
) -> Result<Vec<T>>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    P: IntoIterator,
    P::Item: ToSql,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(params), |row| mapper(row))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(in crate::index_db) fn query_durations(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<u64>> {
    execute_query_map(conn, sql, refs.iter().copied(), |row| {
        Ok(row.get::<_, i64>(0)? as u64)
    })
}
