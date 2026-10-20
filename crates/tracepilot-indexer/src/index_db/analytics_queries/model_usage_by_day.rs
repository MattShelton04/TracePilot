//! Per-day model usage for the cost trend, kept per source so AI Credits
//! are never estimated from another source's usage.

use std::collections::{BTreeMap, HashMap};

use crate::Result;
use rusqlite::{Connection, params_from_iter};

use tracepilot_core::analytics::types::DayModelUsage;
use tracepilot_core::models::event_types::ModelMetricDetail;
use tracepilot_core::provider::SessionSource;

use super::super::helpers::*;

/// Date, model and source.
type UsageKey = (String, String, SessionSource);

/// A stored source name; rows from a source this build does not know are
/// left out rather than counted as another source's.
fn source(name: &str) -> Option<SessionSource> {
    SessionSource::from_stored(name)
}

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

/// The two `(where_clause, bind_values)` filters over the `sessions s` alias
/// that the model-day series needs, plus the requested range.
pub(super) struct DayFilters<'a> {
    /// Repository, source and hide-empty filters without a session date
    /// guard. Runs are bounded by `from_date`/`to_date` on `m.end_timestamp`.
    pub runs: (&'a str, &'a [String]),
    /// The full session filter, including the last-activity date guard. A
    /// session without runs has no end day of its own, so it is bucketed on
    /// and bounded by its last-activity day, like the headline totals.
    pub sessions: (&'a str, &'a [String]),
    pub from_date: Option<&'a str>,
    pub to_date: Option<&'a str>,
}

pub(super) fn query_model_usage_by_day(
    conn: &Connection,
    filters: DayFilters<'_>,
) -> Result<Vec<DayModelUsage>> {
    let mut totals: BTreeMap<UsageKey, DayModelUsageTotals> = BTreeMap::new();
    // AI Credits each session already has on a day, to find what is left.
    let mut counted_nano: HashMap<String, u64> = HashMap::new();

    let (run_where, run_values) = filters.runs;
    let (segment_where, segment_values) = append_segment_date_filter(
        run_where,
        run_values,
        filters.from_date,
        filters.to_date,
        "m.end_timestamp",
    );
    let segment_sql = format!(
        "SELECT date(m.end_timestamp) as d, m.model_metrics_json, s.source, s.id
             FROM session_segments m
             JOIN sessions s ON s.id = m.session_id
             {} AND d IS NOT NULL AND m.model_metrics_json IS NOT NULL
             ORDER BY d",
        segment_where
    );
    let refs = to_refs(&segment_values);
    let mut stmt = conn.prepare(&segment_sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (date, json, source_name, session_id) = row?;
        let Some(source) = source(&source_name) else {
            continue;
        };
        let model_metrics: HashMap<String, ModelMetricDetail> = serde_json::from_str(&json)?;
        let counted = counted_nano.entry(session_id).or_default();
        for (model, detail) in model_metrics {
            *counted += add_model_usage(&mut totals, (date.clone(), model, source), &detail);
        }
    }

    // Sessions without runs: lifetime model usage on the last-activity day.
    let (where_clause, bind_values) = filters.sessions;
    let fallback_sql = format!(
        "SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    m.model_name,
                    s.source,
                    s.id,
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
             GROUP BY d, m.model_name, s.source, s.id
             ORDER BY d, m.model_name, s.source",
        where_clause
    );
    let refs = to_refs(bind_values);
    let mut stmt = conn.prepare(&fallback_sql)?;
    let fallback_rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            (
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ),
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
            row.get::<_, i64>(14)?,
            row.get::<_, i64>(15)?,
        ))
    })?;
    for row in fallback_rows {
        let (
            (date, model, source_name, session_id),
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
        let Some(source) = source(&source_name) else {
            continue;
        };
        let entry = totals.entry((date, model, source)).or_default();
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
        *counted_nano.entry(session_id).or_default() += total_nano_aiu.max(0) as u64;
        entry.unobserved_input_tokens += unobserved_input.max(0) as u64;
        entry.unobserved_output_tokens += unobserved_output.max(0) as u64;
        entry.unobserved_cache_read_tokens += unobserved_cache_read.max(0) as u64;
        entry.unobserved_cache_write_tokens += unobserved_cache_write.max(0) as u64;
    }

    add_unattributed_ai_credits(conn, &filters, &counted_nano, &mut totals)?;

    Ok(totals
        .into_iter()
        .map(|((date, model, source), totals)| DayModelUsage {
            date,
            model,
            source,
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

/// AI Credits a selected session holds beyond what its runs and model rows
/// put on a day: the run still going in a session whose usage checkpoint is
/// newer than its last shutdown, or an undated shutdown. The headline counts
/// them on the session's last-active day inside the range
/// ([`IN_RANGE_NANO_AIU`]), so they go there too, under the session's current
/// model and with no tokens, since none were recorded for them.
fn add_unattributed_ai_credits(
    conn: &Connection,
    filters: &DayFilters<'_>,
    counted_nano: &HashMap<String, u64>,
    totals: &mut BTreeMap<UsageKey, DayModelUsageTotals>,
) -> Result<()> {
    let (where_clause, bind_values) = filters.sessions;
    let (usage_join, values) = out_of_range_join(
        where_clause,
        bind_values,
        filters.from_date,
        filters.to_date,
        false,
    );
    let sql = format!(
        "SELECT s.id, date(COALESCE(s.updated_at, s.created_at)) AS d, s.source,
                COALESCE(s.current_model,
                    (SELECT mm.model_name FROM session_model_metrics mm
                     WHERE mm.session_id = s.id
                     ORDER BY COALESCE(mm.total_nano_aiu, 0) DESC, mm.model_name LIMIT 1),
                    'unknown'),
                {IN_RANGE_NANO_AIU}
         FROM sessions s{usage_join}{where_clause}
         AND d IS NOT NULL AND s.total_nano_aiu IS NOT NULL"
    );
    let refs = to_refs(&values);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;
    for row in rows {
        let (session_id, date, source_name, model, in_range) = row?;
        let counted = counted_nano.get(&session_id).copied().unwrap_or(0);
        let left = (in_range.max(0) as u64).saturating_sub(counted);
        let Some(source) = source(&source_name).filter(|_| left > 0) else {
            continue;
        };
        let entry = totals.entry((date, model, source)).or_default();
        entry.total_nano_aiu += left;
        entry.has_observed_ai_credits = true;
    }
    Ok(())
}

/// Adds one model's usage on a day; returns the AI Credits it counted.
fn add_model_usage(
    totals: &mut BTreeMap<UsageKey, DayModelUsageTotals>,
    key: UsageKey,
    detail: &ModelMetricDetail,
) -> u64 {
    let Some(usage) = detail.usage.as_ref() else {
        return 0;
    };
    let entry = totals.entry(key).or_default();
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
        total_nano_aiu
    } else {
        entry.unobserved_input_tokens += usage.input_tokens.unwrap_or(0);
        entry.unobserved_output_tokens += usage.output_tokens.unwrap_or(0);
        entry.unobserved_cache_read_tokens += usage.cache_read_tokens.unwrap_or(0);
        entry.unobserved_cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);
        0
    }
}
