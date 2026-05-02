use super::super::test_helpers::*;
use super::durations::compute_duration_stats;
use super::*;

// ── compute_analytics tests ──────────────────────────────────────

#[test]
fn test_analytics_empty_sessions() {
    let result = compute_analytics(&[]);
    assert_eq!(result.total_sessions, 0);
    assert_eq!(result.total_tokens, 0);
    assert_eq!(result.total_cost, 0.0);
    assert!(result.token_usage_by_day.is_empty());
    assert!(result.activity_per_day.is_empty());
    assert!(result.model_distribution.is_empty());
}

#[test]
fn test_analytics_single_session() {
    let sessions = vec![make_input(
        "s1",
        "2026-01-15",
        "claude-opus-4.6",
        10000,
        1.50,
        8,
    )];
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
    let jan15 = result
        .activity_per_day
        .iter()
        .find(|d| d.date == "2026-01-15")
        .unwrap();
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
