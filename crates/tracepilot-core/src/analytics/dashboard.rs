//! Dashboard-level aggregate analytics computation.
//!
//! Contains [`compute_analytics`] which produces the main analytics dashboard
//! data (tokens, cost, trends, productivity metrics, etc.).

use std::collections::{BTreeMap, HashMap};

use crate::health;

use super::types::*;

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
    let mut activity_by_day: BTreeMap<String, u32> = BTreeMap::new();
    // model key → (input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, premium_cost, request_count)
    let mut model_tokens: HashMap<String, (u64, u64, u64, u64, f64, u64)> = HashMap::new();
    let mut cost_by_day: BTreeMap<String, f64> = BTreeMap::new();
    let mut durations: Vec<u64> = Vec::new();
    let mut total_turns: u64 = 0;
    let mut total_tool_calls: u64 = 0;
    let mut total_tokens_from_turns: u64 = 0;
    let mut sessions_with_turns: u32 = 0;
    let mut total_premium_requests: f64 = 0.0;
    // Cache stats accumulators
    let mut total_cache_read_tokens: u64 = 0;
    let mut total_input_tokens: u64 = 0;
    // API duration sum + matched token sum for throughput
    // Only counting tokens from sessions that have positive API duration avoids
    // inflating the rate with tokens from sessions that have no duration data.
    let mut total_api_duration_ms: u64 = 0;
    let mut total_tokens_with_duration: u64 = 0;
    // Health distribution
    let mut healthy_count: u32 = 0;
    let mut attention_count: u32 = 0;
    let mut critical_count: u32 = 0;

    for input in sessions {
        let summary = &input.summary;

        // Health score
        let health = health::compute_health(
            summary.event_count,
            summary.shutdown_metrics.as_ref(),
            None,
            None,
        );
        health_score_sum += health.score;

        // Health distribution bucketing
        if health.score >= 0.8 {
            healthy_count += 1;
        } else if health.score >= 0.5 {
            attention_count += 1;
        } else {
            critical_count += 1;
        }

        // Date key (UTC YYYY-MM-DD)
        let date_key = summary.date_key();

        if let Some(ref _date) = date_key {
            // Count sessions for total_sessions, but activity_per_day comes from segments below
        }

        // Shutdown metrics aggregation
        if let Some(ref metrics) = summary.shutdown_metrics {
            // Premium requests
            if let Some(pr) = metrics.total_premium_requests {
                total_premium_requests += pr;
            }

            // Collect API duration for stats + throughput
            let session_api_duration_ms = metrics.total_api_duration_ms.unwrap_or(0);
            if session_api_duration_ms > 0 {
                durations.push(session_api_duration_ms);
                total_api_duration_ms += session_api_duration_ms;
            }

            // Per-model metrics
            let mut session_tokens: u64 = 0;
            for (model_name, detail) in &metrics.model_metrics {
                // Tokens
                if let Some(ref usage) = detail.usage {
                    let input_t = usage.input_tokens.unwrap_or(0);
                    let output_t = usage.output_tokens.unwrap_or(0);
                    let cache_read = usage.cache_read_tokens.unwrap_or(0);
                    let cache_write = usage.cache_write_tokens.unwrap_or(0);
                    // inputTokens already includes cacheReadTokens — don't add cache separately
                    let session_model_tokens = input_t + output_t;
                    total_tokens += session_model_tokens;
                    session_tokens += session_model_tokens;
                    let entry = model_tokens.entry(model_name.clone()).or_insert((0, 0, 0, 0, 0.0, 0));
                    entry.0 += input_t;
                    entry.1 += output_t;
                    entry.2 += cache_read;
                    entry.3 += cache_write;

                    // Accumulate global cache stats
                    total_cache_read_tokens += cache_read;
                    total_input_tokens += input_t;

                    total_tokens_from_turns += session_model_tokens;
                }

                // Cost (requests.cost = premium requests consumed by this model)
                if let Some(ref requests) = detail.requests {
                    let cost = requests.cost.unwrap_or(0.0);
                    total_cost += cost;
                    let req_count = requests.count.map(|c| c as u64).unwrap_or(0);
                    let entry = model_tokens.entry(model_name.clone()).or_insert((0, 0, 0, 0, 0.0, 0));
                    entry.4 += cost;
                    entry.5 += req_count;
                }
            }

            if let Some(ref segments) = metrics.session_segments {
                for seg in segments {
                    let end_date = seg.end_timestamp.split('T').next().unwrap_or(&seg.end_timestamp).to_string();
                    let start_date = seg.start_timestamp.split('T').next().unwrap_or(&seg.start_timestamp).to_string();
                    let mut seg_tokens: u64 = 0;
                    let mut seg_cost: f64 = 0.0;
                    if let Some(ref mm) = seg.model_metrics {
                        for detail in mm.values() {
                            if let Some(ref usage) = detail.usage {
                                seg_tokens += usage.input_tokens.unwrap_or(0) + usage.output_tokens.unwrap_or(0);
                            }
                            if let Some(ref req) = detail.requests {
                                seg_cost += req.cost.unwrap_or(0.0);
                            }
                        }
                    }
                    *tokens_by_day.entry(end_date.clone()).or_insert(0) += seg_tokens;
                    *cost_by_day.entry(end_date).or_insert(0.0) += seg_cost;
                    // Count activity by segment start date
                    *activity_by_day.entry(start_date).or_insert(0) += 1;
                }
            } else if let Some(ref date) = date_key {
                // Fallback for backwards compatibility
                *activity_by_day.entry(date.clone()).or_insert(0) += 1;
                let mut fallback_tokens = 0;
                let mut fallback_cost = 0.0;
                for detail in metrics.model_metrics.values() {
                    if let Some(ref usage) = detail.usage {
                        fallback_tokens += usage.input_tokens.unwrap_or(0) + usage.output_tokens.unwrap_or(0);
                    }
                    if let Some(ref req) = detail.requests {
                        fallback_cost += req.cost.unwrap_or(0.0);
                    }
                }
                if fallback_tokens > 0 {
                    *tokens_by_day.entry(date.clone()).or_insert(0) += fallback_tokens;
                }
                if fallback_cost > 0.0 {
                    *cost_by_day.entry(date.clone()).or_insert(0.0) += fallback_cost;
                }
            }

            // Only count tokens toward throughput when this session has API duration data
            if session_api_duration_ms > 0 {
                total_tokens_with_duration += session_tokens;
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

    let activity_per_day: Vec<DayActivity> = activity_by_day
        .into_iter()
        .map(|(date, count)| DayActivity { date, count })
        .collect();

    let cost_by_day_vec: Vec<DayCost> = cost_by_day
        .into_iter()
        .map(|(date, cost)| DayCost { date, cost })
        .collect();

    // Model distribution with percentages (inputTokens already includes cacheReadTokens)
    let total_model_tokens: u64 = model_tokens.values().map(|(i, o, _cr, _cw, _, _rc)| i + o).sum();
    let mut model_distribution: Vec<ModelDistEntry> = model_tokens
        .into_iter()
        .map(|(model, (input_t, output_t, cache_read, _cache_write, premium_req, request_count))| {
            let tokens = input_t + output_t;
            let percentage = if total_model_tokens > 0 {
                (tokens as f64 / total_model_tokens as f64) * 100.0
            } else {
                0.0
            };
            ModelDistEntry {
                model,
                tokens,
                percentage,
                input_tokens: input_t,
                output_tokens: output_t,
                cache_read_tokens: cache_read,
                premium_requests: premium_req,
                request_count,
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

    // API duration statistics
    let api_duration_stats = compute_duration_stats(&durations);

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
    let avg_tokens_per_api_second = if total_api_duration_ms > 0 {
        (total_tokens_with_duration as f64) / (total_api_duration_ms as f64 / 1000.0)
    } else {
        0.0
    };

    // Cache stats
    let cache_hit_rate = if total_input_tokens > 0 {
        (total_cache_read_tokens as f64 / total_input_tokens as f64) * 100.0
    } else {
        0.0
    };
    let cache_stats = CacheStats {
        total_cache_read_tokens,
        total_input_tokens,
        cache_hit_rate,
        non_cached_input_tokens: total_input_tokens.saturating_sub(total_cache_read_tokens),
    };

    AnalyticsData {
        total_sessions,
        total_tokens,
        total_cost,
        total_premium_requests,
        average_health_score,
        token_usage_by_day,
        activity_per_day,
        model_distribution,
        cost_by_day: cost_by_day_vec,
        api_duration_stats,
        productivity_metrics: ProductivityMetrics {
            avg_turns_per_session,
            avg_tool_calls_per_turn,
            avg_tokens_per_turn,
            avg_tokens_per_api_second,
        },
        cache_stats,
        health_distribution: HealthDistribution {
            healthy_count,
            attention_count,
            critical_count,
        },
        // Note: incident fields default to 0 in fallback path because SessionAnalyticsInput
        // does not carry incident counts. The SQL fast path (query_analytics) returns real values.
        // This is acceptable since the fallback only fires before first indexing.
        sessions_with_errors: 0,
        total_rate_limits: 0,
        total_compactions: 0,
        total_truncations: 0,
        incidents_by_day: Vec::new(),
    }
}

/// Compute API duration statistics from a list of per-session `total_api_duration_ms` values.
fn compute_duration_stats(durations: &[u64]) -> ApiDurationStats {
    if durations.is_empty() {
        return ApiDurationStats {
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

    ApiDurationStats {
        avg_ms,
        median_ms,
        p95_ms,
        min_ms: sorted[0],
        max_ms: sorted[n - 1],
        total_sessions_with_duration: n as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::test_helpers::*;

    // ── compute_analytics tests ──────────────────────────────────────

    #[test]
    fn test_analytics_empty_sessions() {
        let result = compute_analytics(&[]);
        assert_eq!(result.total_sessions, 0);
        assert_eq!(result.total_tokens, 0);
        assert_eq!(result.total_cost, 0.0);
        assert_eq!(result.average_health_score, 0.0);
        assert!(result.token_usage_by_day.is_empty());
        assert!(result.activity_per_day.is_empty());
        assert!(result.model_distribution.is_empty());
    }

    #[test]
    fn test_analytics_single_session() {
        let sessions = vec![make_input("s1", "2026-01-15", "claude-opus-4.6", 10000, 1.50, 8)];
        let result = compute_analytics(&sessions);

        assert_eq!(result.total_sessions, 1);
        assert_eq!(result.total_tokens, 10000);
        assert!((result.total_cost - 1.50).abs() < f64::EPSILON);
        assert_eq!(result.activity_per_day.len(), 1);
        assert_eq!(result.activity_per_day[0].date, "2026-01-15");
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
        assert_eq!(result.activity_per_day.len(), 2);

        // Jan 15: 2 activities (one per session, via fallback path)
        let jan15 = result.activity_per_day.iter().find(|d| d.date == "2026-01-15").unwrap();
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
        assert!(result.activity_per_day.is_empty()); // No shutdown metrics → no activity
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

        // All sessions have total_api_duration_ms = 5000ms from make_input helper
        let stats = &result.api_duration_stats;
        assert_eq!(stats.total_sessions_with_duration, 3);
        assert!((stats.avg_ms - 5_000.0).abs() < 0.1);
        assert!((stats.median_ms - 5_000.0).abs() < 0.1);
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
