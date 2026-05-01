use crate::Result;
use rusqlite::{Connection, params_from_iter, types::ToSql};
use tracepilot_core::analytics::types::ModelDistEntry;

/// Raw row type returned by model-distribution queries before the `i64` sentinel
/// for `has_reasoning` is converted to `bool`.
type ModelDistRawRow = (String, i64, i64, i64, i64, f64, i64, i64, bool);

pub(in crate::index_db) fn query_model_distribution(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<ModelDistEntry>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, f64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
        ))
    })?;
    let mut entries: Vec<ModelDistRawRow> = Vec::new();
    let mut grand_total: i64 = 0;
    for row in rows {
        let (
            model,
            tokens,
            input_t,
            output_t,
            cache_read,
            cost,
            request_count,
            reasoning_sum,
            has_reasoning,
        ) = row?;
        grand_total += tokens;
        entries.push((
            model,
            tokens,
            input_t,
            output_t,
            cache_read,
            cost,
            request_count,
            reasoning_sum,
            has_reasoning != 0,
        ));
    }
    Ok(entries
        .into_iter()
        .map(
            |(
                model,
                tokens,
                input_t,
                output_t,
                cache_read,
                cost,
                request_count,
                reasoning_sum,
                has_reasoning,
            )| {
                let percentage = if grand_total > 0 {
                    (tokens as f64 / grand_total as f64) * 100.0
                } else {
                    0.0
                };
                ModelDistEntry {
                    model,
                    tokens: tokens as u64,
                    percentage,
                    input_tokens: input_t as u64,
                    output_tokens: output_t as u64,
                    cache_read_tokens: cache_read as u64,
                    premium_requests: cost,
                    request_count: request_count as u64,
                    reasoning_tokens: if has_reasoning {
                        Some(reasoning_sum as u64)
                    } else {
                        None
                    },
                }
            },
        )
        .collect())
}
