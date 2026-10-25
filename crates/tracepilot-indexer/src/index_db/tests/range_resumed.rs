//! A date range counts the sessions with activity in it, including those
//! resumed after it (last active later). Such a session counts only its runs
//! that ended in the range, so the headline totals add up to the day charts,
//! in the index and in the disk fallback alike.

use tracepilot_core::analytics::types::AnalyticsData;
use tracepilot_core::analytics::{compute_analytics_in_range, load_full_sessions_active_in_range};
use tracepilot_core::provider::SessionSource;
use tracepilot_test_support::claude_metrics;

use super::range_totals::{chart_tokens, three_day_session};
use super::segment_totals::index_claude;
use crate::index_db::IndexDb;

const NANO: u64 = 1_000_000_000;

fn day_nano(data: &AnalyticsData) -> u64 {
    data.model_usage_by_day
        .iter()
        .filter_map(|d| d.total_nano_aiu)
        .sum()
}

fn source_entry(data: &AnalyticsData, source: SessionSource) -> Option<(u32, u64)> {
    data.cost_by_source
        .iter()
        .find(|e| e.source == source)
        .map(|e| (e.sessions, e.tokens))
}

#[test]
fn a_session_resumed_after_the_range_counts_its_runs_in_it() {
    // Runs end on 03-01, 03-03 and 03-05 with 100, 200 and 400 tokens, AI
    // Credits and premium requests in the same 1:2:4 proportion; the
    // session was last active on 03-05.
    let temp = tempfile::tempdir().unwrap();
    let path = three_day_session(temp.path());
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();

    for (from, to, sessions, tokens) in [
        // Resumed after the range: the runs in it alone.
        (Some("2026-03-01"), Some("2026-03-03"), 1, 300),
        (Some("2026-03-01"), Some("2026-03-01"), 1, 100),
        // Runs on both sides of the range, last active after it.
        (Some("2026-03-02"), Some("2026-03-04"), 1, 200),
        // Spanning the range start, last active in it: as before.
        (Some("2026-03-03"), Some("2026-03-05"), 1, 600),
        // Nothing ended in the range, and it was last active after it.
        (Some("2026-03-04"), Some("2026-03-04"), 0, 0),
        // Presets send no end date, so nothing is after the range.
        (Some("2026-03-03"), None, 1, 600),
        (Some("2026-03-06"), None, 0, 0),
        // All Time: the lifetime totals.
        (None, None, 1, 700),
    ] {
        let at = format!("from={from:?} to={to:?}");
        let data = db.query_analytics(from, to, None, false, None).unwrap();
        let units = tokens / 100;
        assert_eq!(data.total_sessions, sessions, "{at}");
        assert_eq!(data.total_tokens, tokens, "{at}");
        assert_eq!(chart_tokens(&data), tokens, "{at}");
        assert_eq!(data.total_nano_aiu, units * NANO, "{at}");
        assert_eq!(day_nano(&data), data.total_nano_aiu, "{at}");
        assert_eq!(data.total_premium_requests, units as f64, "{at}");
        let day_premium: f64 = data.cost_by_day.iter().map(|d| d.cost).sum();
        assert_eq!(day_premium, data.total_premium_requests, "{at}");
        assert_eq!(data.total_cost, units as f64, "{at}");
        assert_eq!(data.sessions_with_observed_ai_credits, sessions, "{at}");
        let expected_entry = (sessions > 0).then_some((sessions, tokens));
        assert_eq!(
            source_entry(&data, SessionSource::Copilot),
            expected_entry,
            "{at}"
        );
        let model_tokens: u64 = data.model_distribution.iter().map(|m| m.tokens).sum();
        assert_eq!(model_tokens, tokens, "{at}");
        assert_eq!(data.cache_stats.total_input_tokens, tokens, "{at}");

        // The disk fallback selects and counts the same way.
        let inputs =
            load_full_sessions_active_in_range(temp.path(), from, to, None, false).unwrap();
        let fallback = serde_json::to_value(compute_analytics_in_range(&inputs, from, to)).unwrap();
        let indexed = serde_json::to_value(&data).unwrap();
        for field in [
            "totalSessions",
            "totalTokens",
            "totalCost",
            "totalPremiumRequests",
            "totalNanoAiu",
            "sessionsWithObservedAiCredits",
            "costBySource",
            "modelDistribution",
            "cacheStats",
            "tokenUsageByDay",
            "costByDay",
            "activityPerDay",
            "modelUsageByDay",
            "productivityMetrics",
            "apiDurationStats",
        ] {
            assert_eq!(indexed[field], fallback[field], "{field}: {at}");
        }
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn a_claude_session_resumed_after_the_range_keeps_its_runs_usd() {
    // Runs end on 09-20 (174 tokens, $0.50, two models), 09-21 (785, $0.75)
    // and 09-22 (1009 tokens, a priced tail); last active on 09-22.
    let db = index_claude(&claude_metrics::resumed_across_days(true));
    let usd_by_day =
        |data: &AnalyticsData| -> f64 { data.cost_usd_by_day.iter().map(|d| d.cost).sum() };

    for (to, tokens, usd) in [("2026-09-21", 174 + 785, 1.25), ("2026-09-20", 174, 0.5)] {
        let data = db
            .query_analytics(Some("2026-09-20"), Some(to), None, false, None)
            .unwrap();
        assert_eq!(data.total_sessions, 1, "to={to}");
        assert_eq!(data.total_tokens, tokens, "to={to}");
        assert_eq!(chart_tokens(&data), tokens, "to={to}");
        let entry = data
            .cost_by_source
            .iter()
            .find(|e| e.source == SessionSource::ClaudeCode)
            .unwrap();
        assert_eq!((entry.sessions, entry.tokens), (1, tokens), "to={to}");
        // Every run in the range is priced, so its USD is known.
        assert_eq!(entry.sessions_with_cost_usd, 1, "to={to}");
        let entry_usd = entry.cost_usd.unwrap();
        assert!(close(entry_usd, usd), "to={to}: {entry_usd}");
        assert!(close(entry_usd, usd_by_day(&data)), "to={to}");
        // Segments carry no per-model USD: each model's share is unknown.
        let model_tokens: u64 = data.model_distribution.iter().map(|m| m.tokens).sum();
        assert_eq!(model_tokens, tokens, "to={to}");
        assert!(
            data.model_distribution
                .iter()
                .all(|m| m.cost_usd.is_none() && !m.cost_usd_partial),
            "to={to}"
        );
    }
}

#[test]
fn a_session_resumed_after_the_range_adds_no_compactions_from_its_last_day() {
    // Compactions are whole-session counts on the last-active day, as in
    // the incidents series, so a range before that day leaves them out.
    let temp = tempfile::tempdir().unwrap();
    let path = three_day_session(temp.path());
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    db.conn
        .execute(
            "UPDATE sessions SET compaction_count = 2, truncation_count = 1",
            [],
        )
        .unwrap();

    let early = db
        .query_analytics(Some("2026-03-01"), Some("2026-03-03"), None, false, None)
        .unwrap();
    assert_eq!(early.total_sessions, 1);
    assert_eq!((early.total_compactions, early.total_truncations), (0, 0));
    let chart: u64 = early.incidents_by_day.iter().map(|d| d.compactions).sum();
    assert_eq!(chart, 0);

    let late = db
        .query_analytics(Some("2026-03-04"), Some("2026-03-05"), None, false, None)
        .unwrap();
    assert_eq!((late.total_compactions, late.total_truncations), (2, 1));
}
