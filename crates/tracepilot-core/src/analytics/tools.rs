//! Per-tool usage analysis computation.
//!
//! Contains [`compute_tool_analysis`] which produces tool usage breakdown
//! with success rates, durations, and an activity heatmap.

use std::collections::HashMap;

use chrono::{Datelike, Timelike};

use super::types::*;

/// Intermediate accumulator for per-tool statistics.
struct ToolAccumulator {
    call_count: u32,
    success_count: u32,
    failure_count: u32,
    total_duration_ms: f64,
    durations_counted: u32,
}

/// Compute tool usage analysis across all sessions.
///
/// PERF: CPU-bound — iterates all sessions × turns × tool_calls. Slowest of the
/// three analytics functions because it requires full turn reconstruction.
/// For 100+ sessions, this can take 100-500ms.
///
/// Requires `turns` to be loaded in each `SessionAnalyticsInput`.
/// Sessions without turns are silently skipped.
#[tracing::instrument(skip_all, fields(session_count = sessions.len()))]
pub fn compute_tool_analysis(sessions: &[SessionAnalyticsInput]) -> ToolAnalysisData {
    let mut tool_stats: HashMap<String, ToolAccumulator> = HashMap::new();
    // Heatmap: (day_of_week 0=Mon..6=Sun, hour 0..23) → count
    let mut heatmap: HashMap<(u32, u32), u32> = HashMap::new();

    let mut total_calls: u32 = 0;
    let mut total_success: u32 = 0;
    let mut total_failure: u32 = 0;
    let mut total_duration: f64 = 0.0;
    let mut total_with_duration: u32 = 0;

    for input in sessions {
        let turns = match &input.turns {
            Some(t) => t,
            None => continue,
        };

        for turn in turns {
            for tc in &turn.tool_calls {
                total_calls += 1;

                let acc = tool_stats.entry(tc.tool_name.clone()).or_insert(ToolAccumulator {
                    call_count: 0,
                    success_count: 0,
                    failure_count: 0,
                    total_duration_ms: 0.0,
                    durations_counted: 0,
                });

                acc.call_count += 1;

                match tc.success {
                    Some(true) => {
                        acc.success_count += 1;
                        total_success += 1;
                    }
                    Some(false) => {
                        acc.failure_count += 1;
                        total_failure += 1;
                    }
                    None => {
                        // Unknown status — count as neither success nor failure
                    }
                }

                if let Some(duration) = tc.duration_ms {
                    let d = duration as f64;
                    acc.total_duration_ms += d;
                    acc.durations_counted += 1;
                    total_duration += d;
                    total_with_duration += 1;
                }

                // Heatmap entry from tool call start time
                if let Some(started) = tc.started_at {
                    let day = started.weekday().num_days_from_monday(); // 0=Mon
                    let hour = started.hour();
                    *heatmap.entry((day, hour)).or_insert(0) += 1;
                }
            }
        }
    }

    // Build per-tool entries
    let mut tools: Vec<ToolUsageEntry> = tool_stats
        .into_iter()
        .map(|(name, acc)| {
            let total_determined = acc.success_count + acc.failure_count;
            let success_rate = if total_determined > 0 {
                acc.success_count as f64 / total_determined as f64
            } else {
                0.0
            };
            let avg_duration_ms = if acc.durations_counted > 0 {
                acc.total_duration_ms / acc.durations_counted as f64
            } else {
                0.0
            };
            ToolUsageEntry {
                name,
                call_count: acc.call_count,
                success_rate,
                avg_duration_ms,
                total_duration_ms: acc.total_duration_ms,
            }
        })
        .collect();
    tools.sort_by(|a, b| b.call_count.cmp(&a.call_count));

    // Most used tool
    let most_used_tool = tools
        .first()
        .map(|t| t.name.clone())
        .unwrap_or_else(|| "N/A".to_string());

    // Overall success rate (excluding unknown outcomes)
    let total_determined = total_success + total_failure;
    let success_rate = if total_determined > 0 {
        total_success as f64 / total_determined as f64
    } else {
        0.0
    };

    // Average duration
    let avg_duration_ms = if total_with_duration > 0 {
        total_duration / total_with_duration as f64
    } else {
        0.0
    };

    // Build full heatmap (7 days × 24 hours)
    let mut activity_heatmap: Vec<HeatmapEntry> = Vec::with_capacity(168);
    for day in 0..7 {
        for hour in 0..24 {
            let count = heatmap.get(&(day, hour)).copied().unwrap_or(0);
            activity_heatmap.push(HeatmapEntry { day, hour, count });
        }
    }

    ToolAnalysisData {
        total_calls,
        success_rate,
        avg_duration_ms,
        most_used_tool,
        tools,
        activity_heatmap,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_helpers::*;
    use chrono::{TimeZone, Utc};

    #[test]
    fn test_tool_analysis_empty() {
        let result = compute_tool_analysis(&[]);
        assert_eq!(result.total_calls, 0);
        assert_eq!(result.most_used_tool, "N/A");
        assert_eq!(result.activity_heatmap.len(), 168); // 7 × 24 always
    }

    #[test]
    fn test_tool_analysis_no_turns() {
        let sessions = vec![make_input("s1", "2026-01-15", "model", 1000, 0.5, 5)];
        let result = compute_tool_analysis(&sessions);
        assert_eq!(result.total_calls, 0); // turns is None, skipped
    }

    #[test]
    fn test_tool_analysis_basic() {
        let turns = vec![make_turn_with_tools(vec![
            make_tool_call("view", Some(true), Some(100), None),
            make_tool_call("edit", Some(true), Some(200), None),
            make_tool_call("view", Some(false), Some(50), None),
        ])];

        let mut input = make_input("s1", "2026-01-15", "model", 1000, 0.5, 5);
        input.turns = Some(turns);
        let result = compute_tool_analysis(&[input]);

        assert_eq!(result.total_calls, 3);
        assert_eq!(result.most_used_tool, "view");
        assert_eq!(result.tools.len(), 2);

        let view_tool = result.tools.iter().find(|t| t.name == "view").unwrap();
        assert_eq!(view_tool.call_count, 2);
        assert!((view_tool.success_rate - 0.5).abs() < f64::EPSILON); // 1 success, 1 failure
    }

    #[test]
    fn test_tool_analysis_heatmap() {
        // Monday 10:00 UTC
        let monday_10 = Utc.with_ymd_and_hms(2026, 1, 12, 10, 0, 0).unwrap(); // 2026-01-12 is Monday
        let turns = vec![make_turn_with_tools(vec![
            make_tool_call("view", Some(true), Some(100), Some(monday_10)),
            make_tool_call("edit", Some(true), Some(200), Some(monday_10)),
        ])];

        let mut input = make_input("s1", "2026-01-15", "model", 1000, 0.5, 5);
        input.turns = Some(turns);
        let result = compute_tool_analysis(&[input]);

        // Monday=0, hour=10 should have count=2
        let monday_10_entry = result
            .activity_heatmap
            .iter()
            .find(|e| e.day == 0 && e.hour == 10)
            .unwrap();
        assert_eq!(monday_10_entry.count, 2);
    }

    #[test]
    fn test_tool_analysis_unknown_success() {
        let turns = vec![make_turn_with_tools(vec![
            make_tool_call("view", None, None, None), // unknown success
        ])];

        let mut input = make_input("s1", "2026-01-15", "model", 1000, 0.5, 5);
        input.turns = Some(turns);
        let result = compute_tool_analysis(&[input]);

        assert_eq!(result.total_calls, 1);
        let view_tool = result.tools.iter().find(|t| t.name == "view").unwrap();
        assert_eq!(view_tool.success_rate, 0.0); // No determined outcomes
        // Overall rate should also be 0.0 (no determined outcomes), not count unknown as failure
        assert_eq!(result.success_rate, 0.0);
    }

    #[test]
    fn test_tool_analysis_overall_rate_excludes_unknown() {
        let turns = vec![make_turn_with_tools(vec![
            make_tool_call("edit", Some(true), Some(100), None),
            make_tool_call("view", None, Some(50), None), // unknown — should NOT count as failure
            make_tool_call("grep", Some(false), Some(200), None),
        ])];

        let mut input = make_input("s1", "2026-01-15", "model", 1000, 0.5, 5);
        input.turns = Some(turns);
        let result = compute_tool_analysis(&[input]);

        assert_eq!(result.total_calls, 3);
        // 1 success, 1 failure, 1 unknown → rate = 1/2 = 0.5 (not 1/3 ≈ 0.33)
        assert!((result.success_rate - 0.5).abs() < 0.01);
    }

    #[test]
    fn test_tool_analysis_multiple_sessions() {
        let turns1 = vec![make_turn_with_tools(vec![
            make_tool_call("view", Some(true), Some(100), None),
        ])];
        let turns2 = vec![make_turn_with_tools(vec![
            make_tool_call("view", Some(true), Some(200), None),
            make_tool_call("powershell", Some(true), Some(500), None),
        ])];

        let mut input1 = make_input("s1", "2026-01-15", "model", 1000, 0.5, 5);
        input1.turns = Some(turns1);
        let mut input2 = make_input("s2", "2026-01-16", "model", 2000, 1.0, 3);
        input2.turns = Some(turns2);

        let result = compute_tool_analysis(&[input1, input2]);
        assert_eq!(result.total_calls, 3);
        assert_eq!(result.most_used_tool, "view");

        let view_tool = result.tools.iter().find(|t| t.name == "view").unwrap();
        assert_eq!(view_tool.call_count, 2);
        assert!((view_tool.avg_duration_ms - 150.0).abs() < 0.01); // (100+200)/2
    }
}
