//! Headline totals under a date filter count only usage inside the range, so
//! they agree with the day charts. Sessions are still selected (and counted)
//! by their last-active day.

use tracepilot_core::analytics::types::AnalyticsData;
use tracepilot_core::analytics::{compute_analytics_in_range, load_full_sessions_filtered};
use tracepilot_core::provider::SessionSource;
use tracepilot_test_support::claude_metrics;

use super::segment_totals::{index_claude, shutdown, write_copilot};
use crate::index_db::IndexDb;

const NANO: u64 = 1_000_000_000;

fn resume(id: &str, at: &str) -> String {
    format!(r#"{{"type":"session.resume","data":{{}},"id":"{id}","timestamp":"{at}"}}"#)
}

/// One Copilot session resumed on three days: 100, 200 and 400 tokens, with
/// AI Credits and premium requests in the same 1:2:4 proportion.
fn three_day_session(root: &std::path::Path) -> std::path::PathBuf {
    let events = [
        shutdown("s1", "2026-03-01T10:00:00Z", 100, NANO, 1.0, ""),
        resume("r2", "2026-03-03T09:00:00Z"),
        shutdown("s2", "2026-03-03T10:00:00Z", 200, 2 * NANO, 2.0, ""),
        resume("r3", "2026-03-05T09:00:00Z"),
        shutdown("s3", "2026-03-05T10:00:00Z", 400, 4 * NANO, 4.0, ""),
    ];
    let events: Vec<&str> = events.iter().map(String::as_str).collect();
    write_copilot(
        root,
        "22222222-2222-4222-8222-222222222222",
        "2026-03-05T10:00:00Z",
        &events,
    )
}

fn chart_tokens(data: &AnalyticsData) -> u64 {
    data.token_usage_by_day.iter().map(|d| d.tokens).sum()
}

fn copilot_entry(data: &AnalyticsData) -> (u32, u64) {
    let entry = data
        .cost_by_source
        .iter()
        .find(|e| e.source == SessionSource::Copilot)
        .unwrap();
    (entry.sessions, entry.tokens)
}

#[test]
fn a_session_straddling_the_range_start_counts_only_its_in_range_segments() {
    let temp = tempfile::tempdir().unwrap();
    let path = three_day_session(temp.path());
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();

    let data = db
        .query_analytics(Some("2026-03-03"), Some("2026-03-05"), None, false, None)
        .unwrap();
    assert_eq!(data.total_sessions, 1);
    // The 2026-03-01 run is outside the range: 200 + 400, not 700.
    assert_eq!(data.total_tokens, 600);
    assert_eq!(data.total_tokens, chart_tokens(&data));
    assert_eq!(copilot_entry(&data), (1, 600));
    assert_eq!(data.total_nano_aiu, 6 * NANO);
    let day_aiu: u64 = data
        .model_usage_by_day
        .iter()
        .filter_map(|d| d.total_nano_aiu)
        .sum();
    assert_eq!(data.total_nano_aiu, day_aiu);
    assert_eq!(data.total_premium_requests, 6.0);
    let day_premium: f64 = data.cost_by_day.iter().map(|d| d.cost).sum();
    assert_eq!(data.total_premium_requests, day_premium);
    assert_eq!(data.total_cost, 6.0);
    assert_eq!(data.sessions_with_observed_ai_credits, 1);

    // The disk fallback applies the same rule.
    for (from, to) in [(Some("2026-03-03"), Some("2026-03-05")), (None, None)] {
        let inputs = load_full_sessions_filtered(temp.path(), from, to, None, false).unwrap();
        let fallback = serde_json::to_value(compute_analytics_in_range(&inputs, from, to)).unwrap();
        let indexed =
            serde_json::to_value(db.query_analytics(from, to, None, false, None).unwrap()).unwrap();
        for field in [
            "totalTokens",
            "totalCost",
            "totalPremiumRequests",
            "totalNanoAiu",
            "sessionsWithObservedAiCredits",
            "costBySource",
            "tokenUsageByDay",
            "costByDay",
            "productivityMetrics",
        ] {
            assert_eq!(indexed[field], fallback[field], "{field}: from={from:?}");
        }
    }

    // A range holding only the last run keeps the session and that run.
    let none = db
        .query_analytics(Some("2026-03-05"), Some("2026-03-05"), None, false, None)
        .unwrap();
    assert_eq!((none.total_sessions, none.total_tokens), (1, 400));
}

#[test]
fn all_time_totals_stay_the_lifetime_totals() {
    let temp = tempfile::tempdir().unwrap();
    let path = three_day_session(temp.path());
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    let lifetime: (i64, f64, f64, i64) = db
        .conn
        .query_row(
            "SELECT total_tokens, total_cost, total_premium_requests, total_nano_aiu FROM sessions",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    let data = db.query_analytics(None, None, None, false, None).unwrap();
    assert_eq!(
        (
            data.total_tokens as i64,
            data.total_cost,
            data.total_premium_requests,
            data.total_nano_aiu as i64
        ),
        lifetime
    );
    assert_eq!(lifetime.0, 700);
    assert_eq!(data.total_tokens, chart_tokens(&data));
    assert_eq!(copilot_entry(&data), (1, 700));
}

#[test]
fn sessions_without_dated_segments_keep_their_totals_on_their_last_active_day() {
    let temp = tempfile::tempdir().unwrap();
    // Never segmented: the index holds its row but no segments.
    let unsegmented = write_copilot(
        temp.path(),
        "c2",
        "2026-03-04T10:00:00Z",
        &[&shutdown("s1", "2026-03-04T10:00:00Z", 50, NANO, 1.0, "")],
    );
    // An undated shutdown cannot be placed on a day, so it stays with the
    // session; the dated one before the range is left out.
    let undated = r#"{"type":"session.shutdown","data":{"totalPremiumRequests":1.0,"totalNanoAiu":1000000000,"modelMetrics":{"gpt-5.5":{"requests":{"count":1,"cost":1.0},"usage":{"inputTokens":30}}}},"id":"u"}"#;
    let mixed = write_copilot(
        temp.path(),
        "c3",
        "2026-03-04T10:00:00Z",
        &[
            &shutdown("s1", "2026-03-01T10:00:00Z", 70, NANO, 1.0, ""),
            undated,
        ],
    );
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&unsegmented).unwrap();
    db.upsert_session(&mixed).unwrap();
    db.conn
        .execute("DELETE FROM session_segments WHERE session_id = 'c2'", [])
        .unwrap();

    let data = db
        .query_analytics(Some("2026-03-03"), Some("2026-03-05"), None, false, None)
        .unwrap();
    assert_eq!(data.total_sessions, 2);
    assert_eq!(data.total_tokens, 50 + 30);
    assert_eq!(copilot_entry(&data), (2, 80));
    assert_eq!(data.total_nano_aiu, 2 * NANO);
    assert_eq!(data.total_premium_requests, 2.0);
    // Neither has a dated segment in the range, so no day chart shows them.
    assert_eq!(chart_tokens(&data), 0);

    let all = db.query_analytics(None, None, None, false, None).unwrap();
    assert_eq!(all.total_tokens, 50 + 70 + 30);
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn claude_runs_before_the_range_leave_its_tokens_and_usd() {
    let db = index_claude(&claude_metrics::resumed_across_days(true));
    let usd_by_day = |data: &AnalyticsData| data.cost_usd_by_day.iter().map(|d| d.cost).sum();
    let claude = |data: &AnalyticsData| {
        let entry = data
            .cost_by_source
            .iter()
            .find(|e| e.source == SessionSource::ClaudeCode)
            .unwrap()
            .clone();
        (
            entry.sessions,
            entry.tokens,
            entry.cost_usd.unwrap(),
            entry.sessions_with_cost_usd,
        )
    };

    // Runs end on 09-20 (174 tokens, $0.50), 09-21 (785, $0.75) and 09-22
    // (1009 tokens, a priced tail).
    let all = db.query_analytics(None, None, None, false, None).unwrap();
    let (sessions, tokens, usd, priced) = claude(&all);
    let lifetime: (i64, f64) = db
        .conn
        .query_row("SELECT total_tokens, cost_usd FROM sessions", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!((sessions, tokens, priced), (1, 1968, 1));
    assert_eq!((all.total_tokens as i64, usd), lifetime);
    assert!(close(usd, usd_by_day(&all)));

    let ranged = db
        .query_analytics(Some("2026-09-21"), Some("2026-09-22"), None, false, None)
        .unwrap();
    let (sessions, tokens, usd, priced) = claude(&ranged);
    assert_eq!((sessions, tokens, priced), (1, 785 + 1009, 1));
    assert_eq!(ranged.total_tokens, 785 + 1009);
    assert_eq!(ranged.total_tokens, chart_tokens(&ranged));
    assert!(close(usd, lifetime.1 - 0.5), "{usd}");
    assert!(close(usd, usd_by_day(&ranged)), "{usd}");
}
