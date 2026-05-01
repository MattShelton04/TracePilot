use crate::Result;
use rusqlite::{Connection, params_from_iter};
use std::collections::HashMap;

use tracepilot_core::analytics::types::*;

use super::super::helpers::*;

pub(super) fn query_tool_analysis(
    conn: &Connection,
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
) -> Result<ToolAnalysisData> {
    let (where_clause, bind_values) = build_date_repo_filter(from_date, to_date, repo, hide_empty);

    // Per-tool aggregation
    let sql = format!(
        "SELECT t.tool_name,
                    SUM(t.call_count), SUM(t.success_count), SUM(t.failure_count),
                    SUM(t.total_duration_ms), SUM(t.calls_with_duration)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id{}
             GROUP BY t.tool_name ORDER BY SUM(t.call_count) DESC",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
        ))
    })?;

    let mut tools: Vec<ToolUsageEntry> = Vec::new();
    let mut total_calls: u32 = 0;
    let mut total_success: u32 = 0;
    let mut total_failure: u32 = 0;
    let mut total_duration: f64 = 0.0;
    let mut total_with_duration: u32 = 0;

    for row in rows {
        let (name, calls, success, failure, dur, dur_count) = row?;
        let calls_u32 = u32::try_from(calls.max(0)).unwrap_or(u32::MAX);
        let success_u32 = u32::try_from(success.max(0)).unwrap_or(u32::MAX);
        let failure_u32 = u32::try_from(failure.max(0)).unwrap_or(u32::MAX);
        let dur_count_u32 = u32::try_from(dur_count.max(0)).unwrap_or(u32::MAX);
        total_calls = total_calls.saturating_add(calls_u32);
        total_success = total_success.saturating_add(success_u32);
        total_failure = total_failure.saturating_add(failure_u32);
        total_duration += dur.max(0) as f64;
        total_with_duration = total_with_duration.saturating_add(dur_count_u32);

        let determined = success_u32 + failure_u32;
        let success_rate = if determined > 0 {
            success_u32 as f64 / determined as f64
        } else {
            0.0
        };
        let avg_dur = if dur_count_u32 > 0 {
            dur.max(0) as f64 / dur_count_u32 as f64
        } else {
            0.0
        };

        tools.push(ToolUsageEntry {
            name,
            call_count: calls_u32,
            success_rate,
            avg_duration_ms: avg_dur,
            total_duration_ms: dur.max(0) as f64,
        });
    }

    let most_used_tool = tools
        .first()
        .map(|t| t.name.clone())
        .unwrap_or_else(|| "N/A".to_string());

    let overall_determined = total_success + total_failure;
    let success_rate = if overall_determined > 0 {
        total_success as f64 / overall_determined as f64
    } else {
        0.0
    };
    let avg_duration_ms = if total_with_duration > 0 {
        total_duration / total_with_duration as f64
    } else {
        0.0
    };

    // Activity heatmap — full 7×24 grid
    let hm_sql = format!(
        "SELECT a.day_of_week, a.hour, SUM(a.tool_call_count)
             FROM session_activity a
             JOIN sessions s ON s.id = a.session_id{}
             GROUP BY a.day_of_week, a.hour",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let mut hm_stmt = conn.prepare(&hm_sql)?;
    let hm_rows = hm_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, u32>(0)?,
            row.get::<_, u32>(1)?,
            row.get::<_, u32>(2)?,
        ))
    })?;
    let mut heatmap_data: HashMap<(u32, u32), u32> = HashMap::new();
    for row in hm_rows {
        let (day, hour, count) = row?;
        heatmap_data.insert((day, hour), count);
    }

    let mut activity_heatmap: Vec<HeatmapEntry> = Vec::with_capacity(168);
    for day in 0..7u32 {
        for hour in 0..24u32 {
            let count = heatmap_data.get(&(day, hour)).copied().unwrap_or(0);
            activity_heatmap.push(HeatmapEntry { day, hour, count });
        }
    }

    Ok(ToolAnalysisData {
        total_calls,
        success_rate,
        avg_duration_ms,
        most_used_tool,
        tools,
        activity_heatmap,
    })
}
