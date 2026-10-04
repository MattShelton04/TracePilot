//! Per-day, per-model token and AI Credit usage for the analytics dashboard,
//! from `session_segments` model metrics.

use std::collections::BTreeMap;

use crate::Result;
use rusqlite::{Connection, params_from_iter};

use tracepilot_core::analytics::types::*;
use tracepilot_core::models::event_types::ModelMetricDetail;

use super::super::helpers::*;

#[derive(Default)]
struct DayModelUsageTotals {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    reasoning_tokens_sum: u64,
    has_reasoning_tokens: bool,
    total_nano_aiu: u64,
    has_observed_ai_credits: bool,
    unobserved_input_tokens: u64,
    unobserved_output_tokens: u64,
    unobserved_cache_read_tokens: u64,
    unobserved_cache_write_tokens: u64,
}

pub(super) fn query_model_usage_by_day(
    conn: &Connection,
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<DayModelUsage>> {
    let mut totals: BTreeMap<(String, String), DayModelUsageTotals> = BTreeMap::new();

    let (segment_where, segment_values) = append_segment_date_filter(
        where_clause,
        bind_values,
        from_date,
        to_date,
        "m.end_timestamp",
    );
    let segment_sql = format!(
        "SELECT date(m.end_timestamp) as d, m.model_metrics_json
             FROM session_segments m
             JOIN sessions s ON s.id = m.session_id
             {} AND d IS NOT NULL AND m.model_metrics_json IS NOT NULL
             ORDER BY d",
        segment_where
    );
    let refs = to_refs(&segment_values);
    let mut stmt = conn.prepare(&segment_sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (date, json) = row?;
        let model_metrics: std::collections::HashMap<String, ModelMetricDetail> =
            serde_json::from_str(&json)?;
        for (model, detail) in model_metrics {
            add_model_usage(&mut totals, &date, &model, &detail);
        }
    }

    let fallback_sql = format!(
        "SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    m.model_name,
                    COALESCE(SUM(m.input_tokens), 0),
                    COALESCE(SUM(m.output_tokens), 0),
                    COALESCE(SUM(m.cache_read_tokens), 0),
                    COALESCE(SUM(m.cache_write_tokens), 0),
                    COALESCE(SUM(COALESCE(m.reasoning_tokens, 0)), 0),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END),
                    COALESCE(SUM(COALESCE(m.total_nano_aiu, 0)), 0),
                    MAX(CASE WHEN m.total_nano_aiu IS NOT NULL THEN 1 ELSE 0 END),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.input_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.output_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_read_tokens ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN m.total_nano_aiu IS NULL THEN m.cache_write_tokens ELSE 0 END), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}
             AND d IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM session_segments seg WHERE seg.session_id = s.id
             )
             GROUP BY d, m.model_name
             ORDER BY d, m.model_name",
        where_clause
    );
    let refs = to_refs(bind_values);
    let mut stmt = conn.prepare(&fallback_sql)?;
    let fallback_rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
            row.get::<_, i64>(9)?,
            row.get::<_, i64>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, i64>(12)?,
            row.get::<_, i64>(13)?,
        ))
    })?;
    for row in fallback_rows {
        let (
            date,
            model,
            input,
            output,
            cache_read,
            cache_write,
            reasoning,
            has_reasoning,
            total_nano_aiu,
            has_observed,
            unobserved_input,
            unobserved_output,
            unobserved_cache_read,
            unobserved_cache_write,
        ) = row?;
        let entry = totals.entry((date.clone(), model.clone())).or_default();
        entry.input_tokens += input.max(0) as u64;
        entry.output_tokens += output.max(0) as u64;
        entry.cache_read_tokens += cache_read.max(0) as u64;
        entry.cache_write_tokens += cache_write.max(0) as u64;
        if has_reasoning != 0 {
            entry.reasoning_tokens_sum += reasoning.max(0) as u64;
            entry.has_reasoning_tokens = true;
        }
        entry.total_nano_aiu += total_nano_aiu.max(0) as u64;
        entry.has_observed_ai_credits |= has_observed != 0;
        entry.unobserved_input_tokens += unobserved_input.max(0) as u64;
        entry.unobserved_output_tokens += unobserved_output.max(0) as u64;
        entry.unobserved_cache_read_tokens += unobserved_cache_read.max(0) as u64;
        entry.unobserved_cache_write_tokens += unobserved_cache_write.max(0) as u64;
    }

    Ok(totals
        .into_iter()
        .map(|((date, model), totals)| DayModelUsage {
            date,
            model,
            input_tokens: totals.input_tokens,
            output_tokens: totals.output_tokens,
            cache_read_tokens: totals.cache_read_tokens,
            cache_write_tokens: totals.cache_write_tokens,
            reasoning_tokens: if totals.has_reasoning_tokens {
                Some(totals.reasoning_tokens_sum)
            } else {
                None
            },
            total_nano_aiu: totals
                .has_observed_ai_credits
                .then_some(totals.total_nano_aiu),
            unobserved_input_tokens: totals.unobserved_input_tokens,
            unobserved_output_tokens: totals.unobserved_output_tokens,
            unobserved_cache_read_tokens: totals.unobserved_cache_read_tokens,
            unobserved_cache_write_tokens: totals.unobserved_cache_write_tokens,
        })
        .collect())
}

fn add_model_usage(
    totals: &mut BTreeMap<(String, String), DayModelUsageTotals>,
    date: &str,
    model: &str,
    detail: &ModelMetricDetail,
) {
    let Some(usage) = detail.usage.as_ref() else {
        return;
    };
    let entry = totals
        .entry((date.to_string(), model.to_string()))
        .or_default();
    entry.input_tokens += usage.input_tokens.unwrap_or(0);
    entry.output_tokens += usage.output_tokens.unwrap_or(0);
    entry.cache_read_tokens += usage.cache_read_tokens.unwrap_or(0);
    entry.cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);
    if let Some(reasoning_tokens) = usage.reasoning_tokens {
        entry.reasoning_tokens_sum += reasoning_tokens;
        entry.has_reasoning_tokens = true;
    }
    if let Some(total_nano_aiu) = detail.total_nano_aiu {
        entry.total_nano_aiu += total_nano_aiu;
        entry.has_observed_ai_credits = true;
    } else {
        entry.unobserved_input_tokens += usage.input_tokens.unwrap_or(0);
        entry.unobserved_output_tokens += usage.output_tokens.unwrap_or(0);
        entry.unobserved_cache_read_tokens += usage.cache_read_tokens.unwrap_or(0);
        entry.unobserved_cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);
    }
}
