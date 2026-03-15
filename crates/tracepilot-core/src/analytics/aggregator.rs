//! Core aggregation logic for analytics computation.
//!
//! Three public functions, each operating over `&[SessionAnalyticsInput]`:
//! - `compute_analytics` — dashboard-level aggregate stats
//! - `compute_tool_analysis` — per-tool usage breakdown
//! - `compute_code_impact` — file change aggregation

use std::collections::{BTreeMap, HashMap};

use chrono::{Datelike, Timelike};

use crate::health;

use super::types::*;

// ── Analytics Dashboard ───────────────────────────────────────────────

/// Compute aggregate analytics across all sessions.
///
/// Only requires `SessionSummary` data (no turns needed).
pub fn compute_analytics(sessions: &[SessionAnalyticsInput]) -> AnalyticsData {
    let total_sessions = sessions.len() as u32;

    // Accumulators
    let mut total_tokens: u64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut health_score_sum: f64 = 0.0;
    let mut tokens_by_day: BTreeMap<String, u64> = BTreeMap::new();
    let mut sessions_by_day: BTreeMap<String, u32> = BTreeMap::new();
    let mut model_tokens: HashMap<String, u64> = HashMap::new();
    let mut cost_by_day: BTreeMap<String, f64> = BTreeMap::new();
    let mut durations: Vec<u64> = Vec::new();
    let mut total_turns: u64 = 0;
    let mut total_tool_calls: u64 = 0;
    let mut total_tokens_from_turns: u64 = 0;
    let mut sessions_with_turns: u32 = 0;

    for input in sessions {
        let summary = &input.summary;

        // Health score
        let health = health::compute_health(
            summary.event_count,
            summary.shutdown_metrics.as_ref(),
        );
        health_score_sum += health.score;

        // Date key (UTC YYYY-MM-DD)
        let date_key = summary
            .updated_at
            .or(summary.created_at)
            .map(|dt| dt.format("%Y-%m-%d").to_string());

        if let Some(ref date) = date_key {
            *sessions_by_day.entry(date.clone()).or_insert(0) += 1;
        }

        // Shutdown metrics aggregation
        if let Some(ref metrics) = summary.shutdown_metrics {
            // Duration from session_start_time
            if let (Some(start_time), Some(updated)) = (metrics.session_start_time, summary.updated_at) {
                let start_ms = start_time;
                let end_ms = updated.timestamp_millis() as u64;
                if end_ms > start_ms {
                    durations.push(end_ms - start_ms);
                }
            }

            // Per-model metrics
            for (model_name, detail) in &metrics.model_metrics {
                // Tokens
                if let Some(ref usage) = detail.usage {
                    let input_t = usage.input_tokens.unwrap_or(0);
                    let output_t = usage.output_tokens.unwrap_or(0);
                    let cache_read = usage.cache_read_tokens.unwrap_or(0);
                    let cache_write = usage.cache_write_tokens.unwrap_or(0);
                    let session_model_tokens = input_t + output_t + cache_read + cache_write;
                    total_tokens += session_model_tokens;
                    *model_tokens.entry(model_name.clone()).or_insert(0) += session_model_tokens;

                    if let Some(ref date) = date_key {
                        *tokens_by_day.entry(date.clone()).or_insert(0) += session_model_tokens;
                    }

                    total_tokens_from_turns += session_model_tokens;
                }

                // Cost
                if let Some(ref requests) = detail.requests {
                    let cost = requests.cost.unwrap_or(0.0);
                    total_cost += cost;
                    if let Some(ref date) = date_key {
                        *cost_by_day.entry(date.clone()).or_insert(0.0) += cost;
                    }
                }
            }
        }

        // Turn-based metrics
        if let Some(turn_count) = summary.turn_count {
            let tc = turn_count as u64;
            total_turns += tc;
            if tc > 0 {
                sessions_with_turns += 1;
            }
        }

        // Tool call counts from turns if loaded
        if let Some(ref turns) = input.turns {
            for turn in turns {
                total_tool_calls += turn.tool_calls.len() as u64;
            }
        }
    }

    // Build sorted output vectors from BTreeMaps
    let token_usage_by_day: Vec<DayTokens> = tokens_by_day
        .into_iter()
        .map(|(date, tokens)| DayTokens { date, tokens })
        .collect();

    let sessions_per_day: Vec<DaySessions> = sessions_by_day
        .into_iter()
        .map(|(date, count)| DaySessions { date, count })
        .collect();

    let cost_by_day_vec: Vec<DayCost> = cost_by_day
        .into_iter()
        .map(|(date, cost)| DayCost { date, cost })
        .collect();

    // Model distribution with percentages
    let total_model_tokens: u64 = model_tokens.values().sum();
    let mut model_distribution: Vec<ModelDistEntry> = model_tokens
        .into_iter()
        .map(|(model, tokens)| {
            let percentage = if total_model_tokens > 0 {
                (tokens as f64 / total_model_tokens as f64) * 100.0
            } else {
                0.0
            };
            ModelDistEntry {
                model,
                tokens,
                percentage,
            }
        })
        .collect();
    model_distribution.sort_by(|a, b| b.tokens.cmp(&a.tokens));

    // Average health score
    let average_health_score = if total_sessions > 0 {
        health_score_sum / total_sessions as f64
    } else {
        0.0
    };

    // Duration statistics
    let session_duration_stats = compute_duration_stats(&durations);

    // Productivity metrics
    let avg_turns_per_session = if sessions_with_turns > 0 {
        total_turns as f64 / sessions_with_turns as f64
    } else {
        0.0
    };
    let avg_tool_calls_per_turn = if total_turns > 0 {
        total_tool_calls as f64 / total_turns as f64
    } else {
        0.0
    };
    let avg_tokens_per_turn = if total_turns > 0 {
        total_tokens_from_turns as f64 / total_turns as f64
    } else {
        0.0
    };

    AnalyticsData {
        total_sessions,
        total_tokens,
        total_cost,
        average_health_score,
        token_usage_by_day,
        sessions_per_day,
        model_distribution,
        cost_by_day: cost_by_day_vec,
        session_duration_stats,
        productivity_metrics: ProductivityMetrics {
            avg_turns_per_session,
            avg_tool_calls_per_turn,
            avg_tokens_per_turn,
        },
    }
}

/// Compute duration statistics from a sorted list of durations.
fn compute_duration_stats(durations: &[u64]) -> SessionDurationStats {
    if durations.is_empty() {
        return SessionDurationStats {
            avg_ms: 0.0,
            median_ms: 0.0,
            p95_ms: 0.0,
            min_ms: 0,
            max_ms: 0,
            total_sessions_with_duration: 0,
        };
    }

    let mut sorted = durations.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let sum: u64 = sorted.iter().sum();

    let avg_ms = sum as f64 / n as f64;
    let median_ms = if n % 2 == 0 {
        (sorted[n / 2 - 1] + sorted[n / 2]) as f64 / 2.0
    } else {
        sorted[n / 2] as f64
    };
    let p95_idx = ((n as f64 * 0.95).ceil() as usize).min(n) - 1;
    let p95_ms = sorted[p95_idx] as f64;

    SessionDurationStats {
        avg_ms,
        median_ms,
        p95_ms,
        min_ms: sorted[0],
        max_ms: sorted[n - 1],
        total_sessions_with_duration: n as u32,
    }
}

// ── Tool Analysis ─────────────────────────────────────────────────────

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
/// Requires `turns` to be loaded in each `SessionAnalyticsInput`.
/// Sessions without turns are silently skipped.
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

// ── Code Impact ───────────────────────────────────────────────────────

/// Compute code impact analysis across all sessions.
///
/// Only requires `SessionSummary` data (no turns needed).
pub fn compute_code_impact(sessions: &[SessionAnalyticsInput]) -> CodeImpactData {
    let mut total_lines_added: u64 = 0;
    let mut total_lines_removed: u64 = 0;
    let mut file_counts: HashMap<String, u32> = HashMap::new(); // path → modification count
    let mut ext_counts: HashMap<String, u32> = HashMap::new();
    let mut changes_by_day: BTreeMap<String, (u64, u64)> = BTreeMap::new(); // date → (add, del)

    for input in sessions {
        let summary = &input.summary;
        let metrics = match &summary.shutdown_metrics {
            Some(m) => m,
            None => continue,
        };
        let code_changes = match &metrics.code_changes {
            Some(cc) => cc,
            None => continue,
        };

        let added = code_changes.lines_added.unwrap_or(0);
        let removed = code_changes.lines_removed.unwrap_or(0);
        total_lines_added += added;
        total_lines_removed += removed;

        // Date key (UTC)
        let date_key = summary
            .updated_at
            .or(summary.created_at)
            .map(|dt| dt.format("%Y-%m-%d").to_string());

        if let Some(ref date) = date_key {
            let entry = changes_by_day.entry(date.clone()).or_insert((0, 0));
            entry.0 += added;
            entry.1 += removed;
        }

        // File tracking
        if let Some(ref files) = code_changes.files_modified {
            for file in files {
                *file_counts.entry(file.clone()).or_insert(0) += 1;

                // Extension tracking
                let ext = std::path::Path::new(file)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("(no ext)")
                    .to_string();
                *ext_counts.entry(ext).or_insert(0) += 1;
            }
        }
    }

    let total_files: u32 = file_counts.len() as u32;

    // File type breakdown with percentages
    let total_ext_count: u32 = ext_counts.values().sum();
    let mut file_type_breakdown: Vec<FileTypeEntry> = ext_counts
        .into_iter()
        .map(|(extension, count)| {
            let percentage = if total_ext_count > 0 {
                (count as f64 / total_ext_count as f64) * 100.0
            } else {
                0.0
            };
            FileTypeEntry {
                extension,
                count,
                percentage,
            }
        })
        .collect();
    file_type_breakdown.sort_by(|a, b| b.count.cmp(&a.count));

    // Most modified files (by frequency, since we don't have per-file line counts)
    let mut most_modified_files: Vec<ModifiedFileEntry> = file_counts
        .into_iter()
        .map(|(path, count)| ModifiedFileEntry {
            path,
            additions: count as u64, // modification count
            deletions: 0,            // not available per-file
        })
        .collect();
    most_modified_files.sort_by(|a, b| b.additions.cmp(&a.additions));
    most_modified_files.truncate(20); // Top 20

    // Changes by day
    let changes_by_day_vec: Vec<DayChanges> = changes_by_day
        .into_iter()
        .map(|(date, (additions, deletions))| DayChanges {
            date,
            additions,
            deletions,
        })
        .collect();

    let net_change = total_lines_added as i64 - total_lines_removed as i64;

    CodeImpactData {
        files_modified: total_files,
        lines_added: total_lines_added,
        lines_removed: total_lines_removed,
        net_change,
        file_type_breakdown,
        most_modified_files,
        changes_by_day: changes_by_day_vec,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::conversation::ConversationTurn;
    use crate::models::event_types::{CodeChanges, ModelMetricDetail, RequestMetrics, UsageMetrics};
    use crate::models::session_summary::{SessionSummary, ShutdownMetrics};
    use chrono::{TimeZone, Utc};
    use std::collections::HashMap;

    /// Helper to create a minimal SessionAnalyticsInput.
    fn make_input(
        id: &str,
        date: &str,
        model: &str,
        tokens: u64,
        cost: f64,
        turns: u32,
    ) -> SessionAnalyticsInput {
        let dt = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        let updated = Utc.from_utc_datetime(&dt);

        let mut model_metrics = HashMap::new();
        model_metrics.insert(
            model.to_string(),
            ModelMetricDetail {
                requests: Some(RequestMetrics {
                    count: Some(turns as u64),
                    cost: Some(cost),
                }),
                usage: Some(UsageMetrics {
                    input_tokens: Some(tokens / 2),
                    output_tokens: Some(tokens / 2),
                    cache_read_tokens: Some(0),
                    cache_write_tokens: Some(0),
                }),
            },
        );

        SessionAnalyticsInput {
            summary: SessionSummary {
                id: id.to_string(),
                summary: Some(format!("Session {}", id)),
                repository: Some("test/repo".to_string()),
                branch: Some("main".to_string()),
                cwd: None,
                host_type: Some("vscode".to_string()),
                created_at: Some(updated),
                updated_at: Some(updated),
                event_count: Some(100),
                has_events: true,
                has_session_db: false,
                has_plan: false,
                has_checkpoints: false,
                checkpoint_count: None,
                turn_count: Some(turns as usize),
                shutdown_metrics: Some(ShutdownMetrics {
                    shutdown_type: Some("normal".to_string()),
                    total_premium_requests: Some(turns as f64),
                    total_api_duration_ms: Some(5000),
                    session_start_time: Some(updated.timestamp_millis() as u64 - 300_000),
                    current_model: Some(model.to_string()),
                    code_changes: Some(CodeChanges {
                        lines_added: Some(50),
                        lines_removed: Some(10),
                        files_modified: Some(vec![
                            "src/main.rs".to_string(),
                            "src/lib.rs".to_string(),
                        ]),
                    }),
                    model_metrics,
                }),
            },
            turns: None,
        }
    }

    fn make_input_with_code(
        id: &str,
        date: &str,
        added: u64,
        removed: u64,
        files: Vec<&str>,
    ) -> SessionAnalyticsInput {
        let mut input = make_input(id, date, "claude-opus-4.6", 1000, 0.5, 5);
        if let Some(ref mut metrics) = input.summary.shutdown_metrics {
            metrics.code_changes = Some(CodeChanges {
                lines_added: Some(added),
                lines_removed: Some(removed),
                files_modified: Some(files.into_iter().map(String::from).collect()),
            });
        }
        input
    }

    // ── compute_analytics tests ──────────────────────────────────────

    #[test]
    fn test_analytics_empty_sessions() {
        let result = compute_analytics(&[]);
        assert_eq!(result.total_sessions, 0);
        assert_eq!(result.total_tokens, 0);
        assert_eq!(result.total_cost, 0.0);
        assert_eq!(result.average_health_score, 0.0);
        assert!(result.token_usage_by_day.is_empty());
        assert!(result.sessions_per_day.is_empty());
        assert!(result.model_distribution.is_empty());
    }

    #[test]
    fn test_analytics_single_session() {
        let sessions = vec![make_input("s1", "2026-01-15", "claude-opus-4.6", 10000, 1.50, 8)];
        let result = compute_analytics(&sessions);

        assert_eq!(result.total_sessions, 1);
        assert_eq!(result.total_tokens, 10000);
        assert!((result.total_cost - 1.50).abs() < f64::EPSILON);
        assert_eq!(result.sessions_per_day.len(), 1);
        assert_eq!(result.sessions_per_day[0].date, "2026-01-15");
        assert_eq!(result.model_distribution.len(), 1);
        assert_eq!(result.model_distribution[0].model, "claude-opus-4.6");
        assert!((result.model_distribution[0].percentage - 100.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_analytics_multiple_sessions_different_days() {
        let sessions = vec![
            make_input("s1", "2026-01-15", "claude-opus-4.6", 5000, 0.80, 4),
            make_input("s2", "2026-01-15", "gpt-5.4", 3000, 0.50, 3),
            make_input("s3", "2026-01-16", "claude-opus-4.6", 7000, 1.20, 6),
        ];
        let result = compute_analytics(&sessions);

        assert_eq!(result.total_sessions, 3);
        assert_eq!(result.total_tokens, 15000);
        assert!((result.total_cost - 2.50).abs() < 0.001);
        assert_eq!(result.sessions_per_day.len(), 2);

        // Jan 15: 2 sessions
        let jan15 = result.sessions_per_day.iter().find(|d| d.date == "2026-01-15").unwrap();
        assert_eq!(jan15.count, 2);
    }

    #[test]
    fn test_analytics_missing_shutdown_metrics() {
        let mut input = make_input("s1", "2026-01-15", "claude-opus-4.6", 5000, 1.0, 5);
        input.summary.shutdown_metrics = None;
        let result = compute_analytics(&[input]);

        assert_eq!(result.total_sessions, 1);
        assert_eq!(result.total_tokens, 0); // No metrics to aggregate
        assert_eq!(result.total_cost, 0.0);
        assert_eq!(result.sessions_per_day.len(), 1); // Session still counted by day
    }

    #[test]
    fn test_analytics_multiple_models() {
        let sessions = vec![
            make_input("s1", "2026-01-15", "claude-opus-4.6", 8000, 1.0, 5),
            make_input("s2", "2026-01-15", "gpt-5.4", 4000, 0.5, 3),
            make_input("s3", "2026-01-15", "claude-opus-4.6", 6000, 0.8, 4),
        ];
        let result = compute_analytics(&sessions);

        assert_eq!(result.model_distribution.len(), 2);
        // claude-opus-4.6 should be first (more tokens)
        assert_eq!(result.model_distribution[0].model, "claude-opus-4.6");
        assert_eq!(result.model_distribution[0].tokens, 14000);
    }

    #[test]
    fn test_analytics_duration_stats() {
        let sessions = vec![
            make_input("s1", "2026-01-15", "model", 1000, 0.1, 2),
            make_input("s2", "2026-01-15", "model", 2000, 0.2, 3),
            make_input("s3", "2026-01-15", "model", 3000, 0.3, 4),
        ];
        let result = compute_analytics(&sessions);

        // All sessions have 300s (300000ms) duration from make_input helper
        let stats = &result.session_duration_stats;
        assert_eq!(stats.total_sessions_with_duration, 3);
        assert!((stats.avg_ms - 300_000.0).abs() < 0.1);
        assert!((stats.median_ms - 300_000.0).abs() < 0.1);
    }

    #[test]
    fn test_analytics_productivity_metrics() {
        let sessions = vec![
            make_input("s1", "2026-01-15", "model", 10000, 1.0, 10),
            make_input("s2", "2026-01-15", "model", 5000, 0.5, 5),
        ];
        let result = compute_analytics(&sessions);

        // 15 total turns across 2 sessions with turns
        assert!((result.productivity_metrics.avg_turns_per_session - 7.5).abs() < 0.01);
    }

    // ── compute_tool_analysis tests ──────────────────────────────────

    fn make_tool_call(
        name: &str,
        success: Option<bool>,
        duration_ms: Option<u64>,
        started_at: Option<chrono::DateTime<Utc>>,
    ) -> crate::models::conversation::TurnToolCall {
        crate::models::conversation::TurnToolCall {
            tool_call_id: Some("tc1".to_string()),
            parent_tool_call_id: None,
            tool_name: name.to_string(),
            arguments: None,
            success,
            error: None,
            started_at,
            completed_at: None,
            duration_ms,
            mcp_server_name: None,
            mcp_tool_name: None,
            is_complete: true,
        }
    }

    fn make_turn_with_tools(
        tool_calls: Vec<crate::models::conversation::TurnToolCall>,
    ) -> ConversationTurn {
        ConversationTurn {
            turn_index: 0,
            turn_id: None,
            interaction_id: None,
            user_message: Some("test".to_string()),
            assistant_messages: vec!["response".to_string()],
            model: Some("model".to_string()),
            timestamp: None,
            end_timestamp: None,
            tool_calls,
            duration_ms: None,
            is_complete: true,
        }
    }

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

    // ── compute_code_impact tests ────────────────────────────────────

    #[test]
    fn test_code_impact_empty() {
        let result = compute_code_impact(&[]);
        assert_eq!(result.files_modified, 0);
        assert_eq!(result.lines_added, 0);
        assert_eq!(result.lines_removed, 0);
        assert_eq!(result.net_change, 0);
    }

    #[test]
    fn test_code_impact_single_session() {
        let sessions = vec![make_input_with_code(
            "s1", "2026-01-15", 100, 30,
            vec!["src/main.rs", "src/lib.rs", "README.md"],
        )];
        let result = compute_code_impact(&sessions);

        assert_eq!(result.files_modified, 3);
        assert_eq!(result.lines_added, 100);
        assert_eq!(result.lines_removed, 30);
        assert_eq!(result.net_change, 70);
    }

    #[test]
    fn test_code_impact_file_type_breakdown() {
        let sessions = vec![make_input_with_code(
            "s1", "2026-01-15", 100, 30,
            vec!["src/main.rs", "src/lib.rs", "src/app.ts", "README.md"],
        )];
        let result = compute_code_impact(&sessions);

        assert_eq!(result.file_type_breakdown.len(), 3); // rs, ts, md
        let rs = result.file_type_breakdown.iter().find(|e| e.extension == "rs").unwrap();
        assert_eq!(rs.count, 2);
    }

    #[test]
    fn test_code_impact_multiple_sessions_same_files() {
        let sessions = vec![
            make_input_with_code("s1", "2026-01-15", 50, 10, vec!["src/main.rs"]),
            make_input_with_code("s2", "2026-01-16", 80, 20, vec!["src/main.rs", "src/lib.rs"]),
        ];
        let result = compute_code_impact(&sessions);

        assert_eq!(result.files_modified, 2); // unique files
        assert_eq!(result.lines_added, 130);
        assert_eq!(result.lines_removed, 30);

        // main.rs modified in 2 sessions (most modified)
        assert_eq!(result.most_modified_files[0].path, "src/main.rs");
        assert_eq!(result.most_modified_files[0].additions, 2); // 2 modifications
    }

    #[test]
    fn test_code_impact_negative_net_change() {
        let sessions = vec![make_input_with_code(
            "s1", "2026-01-15", 10, 100,
            vec!["src/main.rs"],
        )];
        let result = compute_code_impact(&sessions);
        assert_eq!(result.net_change, -90);
    }

    #[test]
    fn test_code_impact_no_shutdown_metrics() {
        let mut input = make_input("s1", "2026-01-15", "model", 1000, 0.5, 5);
        input.summary.shutdown_metrics = None;
        let result = compute_code_impact(&[input]);

        assert_eq!(result.files_modified, 0);
        assert_eq!(result.lines_added, 0);
    }

    #[test]
    fn test_code_impact_changes_by_day() {
        let sessions = vec![
            make_input_with_code("s1", "2026-01-15", 50, 10, vec!["a.rs"]),
            make_input_with_code("s2", "2026-01-15", 30, 5, vec!["b.rs"]),
            make_input_with_code("s3", "2026-01-16", 80, 20, vec!["c.rs"]),
        ];
        let result = compute_code_impact(&sessions);

        assert_eq!(result.changes_by_day.len(), 2);
        let jan15 = result.changes_by_day.iter().find(|d| d.date == "2026-01-15").unwrap();
        assert_eq!(jan15.additions, 80);
        assert_eq!(jan15.deletions, 15);
    }

    #[test]
    fn test_code_impact_no_extension_files() {
        let sessions = vec![make_input_with_code(
            "s1", "2026-01-15", 10, 5,
            vec!["Makefile", "Dockerfile", ".gitignore"],
        )];
        let result = compute_code_impact(&sessions);

        // Files without extension should be grouped under "(no ext)"
        let no_ext = result.file_type_breakdown.iter().find(|e| e.extension == "(no ext)").unwrap();
        assert_eq!(no_ext.count, 3);
    }

    // ── Duration stats helper tests ──────────────────────────────────

    #[test]
    fn test_duration_stats_empty() {
        let stats = compute_duration_stats(&[]);
        assert_eq!(stats.total_sessions_with_duration, 0);
        assert_eq!(stats.avg_ms, 0.0);
    }

    #[test]
    fn test_duration_stats_single() {
        let stats = compute_duration_stats(&[1000]);
        assert_eq!(stats.total_sessions_with_duration, 1);
        assert!((stats.avg_ms - 1000.0).abs() < f64::EPSILON);
        assert!((stats.median_ms - 1000.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_duration_stats_multiple() {
        let stats = compute_duration_stats(&[100, 200, 300, 400, 500]);
        assert_eq!(stats.total_sessions_with_duration, 5);
        assert!((stats.avg_ms - 300.0).abs() < f64::EPSILON);
        assert!((stats.median_ms - 300.0).abs() < f64::EPSILON);
        assert_eq!(stats.min_ms, 100);
        assert_eq!(stats.max_ms, 500);
    }

    #[test]
    fn test_duration_stats_p95() {
        // 20 values: 100, 200, ..., 2000
        let durations: Vec<u64> = (1..=20).map(|i| i * 100).collect();
        let stats = compute_duration_stats(&durations);
        // p95 index = ceil(20 * 0.95) - 1 = 18 (0-indexed), value = 1900
        assert!((stats.p95_ms - 1900.0).abs() < f64::EPSILON);
    }
}
