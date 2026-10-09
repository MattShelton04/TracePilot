//! Public provider totals reach the durable index, without Copilot billing.

use std::sync::Arc;

use tracepilot_core::provider::{SessionProvider, SessionSource, claude_code::ClaudeCodeProvider};
use tracepilot_test_support::claude::{HAIKU, OPUS};
use tracepilot_test_support::claude_metrics;

use crate::index_db::{IndexDb, session_writer};

#[test]
fn claude_summary_metrics_and_partial_status_reach_index_consumers() {
    for tail in [false, true] {
        let files = claude_metrics::snapshot_and_tail(tail);
        let provider: Arc<dyn SessionProvider> =
            Arc::new(ClaudeCodeProvider::new(files.root.path()));
        let locator = provider.discover(&|| false).unwrap().remove(0);
        let db = IndexDb::open_or_create(&files.root.path().join("index.db")).unwrap();
        let prepared = session_writer::prepare_snapshot(&provider, &locator, &|| false).unwrap();
        assert!(
            prepared
                .summary
                .shutdown_metrics
                .as_ref()
                .unwrap()
                .coverage
                .as_ref()
                .unwrap()
                .partial
        );
        db.write_prepared_session(&prepared).unwrap();
        let list = db.list_sessions(None, None, None, false).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].summary.as_deref(), Some("First human prompt."));
        assert_eq!(list[0].metrics_partial, Some(true));
        let totals: (i64,Option<f64>,Option<f64>,Option<i64>) = db.conn.query_row(
            "SELECT total_tokens,total_cost,total_premium_requests,total_nano_aiu FROM sessions",
            [],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        // 2220 + 24 + 555 + 6 = 2805; covered-only: 444 + 6 + 555 + 6 = 1011.
        assert_eq!(totals, (if tail { 2805 } else { 1011 }, None, None, None));
        for (model, input, output, count) in [
            (
                OPUS,
                if tail { 2220 } else { 444 },
                if tail { 24 } else { 6 },
                if tail { 4 } else { 2 },
            ),
            (HAIKU, 555, 6, 0),
        ] {
            let usage: (i64,i64,i64,Option<f64>) = db.conn.query_row(
                "SELECT input_tokens,output_tokens,request_count,cost FROM session_model_metrics WHERE model_name=?1",
                [model],|r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
            assert_eq!(usage, (input, output, count, None));
        }
        assert!(!db.session_is_stale(provider.as_ref(), &locator));
        // The existing dashboard must tolerate absent Copilot-only charges.
        let dashboard = db.query_analytics(None, None, None, false, None).unwrap();
        assert_eq!(dashboard.total_tokens, if tail { 2805 } else { 1011 });
        assert_eq!(dashboard.model_distribution.len(), 2);
        // Per-day charts need segments: one per run, plus the tail.
        let day_tokens: u64 = dashboard.token_usage_by_day.iter().map(|d| d.tokens).sum();
        assert_eq!(day_tokens, if tail { 2805 } else { 1011 });
        assert_eq!(dashboard.activity_per_day.len(), 1);
        assert_eq!(
            dashboard.activity_per_day[0].count,
            if tail { 2 } else { 1 }
        );
        assert_eq!(dashboard.model_usage_by_day.len(), 2);
        // Pre-C5 unchanged Claude rows must be refreshed; Copilot stays at v17.
        db.conn
            .execute("UPDATE sessions SET analytics_version=17", [])
            .unwrap();
        assert!(db.session_is_stale(provider.as_ref(), &locator));
        // Pre-segment Claude rows (v20) are refreshed too.
        db.write_prepared_session(&prepared).unwrap();
        db.conn
            .execute("UPDATE sessions SET analytics_version=20", [])
            .unwrap();
        assert!(db.session_is_stale(provider.as_ref(), &locator));
    }
}

fn close(actual: Option<f64>, expected: f64) -> bool {
    actual.is_some_and(|actual| (actual - expected).abs() < 1e-9)
}

#[test]
fn resumed_claude_runs_land_on_their_own_days_with_usd() {
    let files = claude_metrics::resumed_across_days(true);
    let provider: Arc<dyn SessionProvider> = Arc::new(ClaudeCodeProvider::new(files.root.path()));
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let db = IndexDb::open_or_create(&files.root.path().join("index.db")).unwrap();
    let prepared = session_writer::prepare_snapshot(&provider, &locator, &|| false).unwrap();
    db.write_prepared_session(&prepared).unwrap();

    // Run 1 and 2 are snapshot differences; run 3 is the priced tail.
    let mut stmt = db
        .conn
        .prepare(
            "SELECT date(end_timestamp), total_tokens, total_requests, cost_usd
             FROM session_segments ORDER BY end_timestamp",
        )
        .unwrap();
    let segments: Vec<(String, i64, i64, Option<f64>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let days: Vec<_> = segments.iter().map(|s| (s.0.as_str(), s.1, s.2)).collect();
    assert_eq!(
        days,
        [
            ("2026-09-20", 174, 1),
            ("2026-09-21", 785, 1),
            ("2026-09-22", 1009, 1)
        ]
    );
    assert!(close(segments[0].3, 0.5) && close(segments[1].3, 0.75));
    let tail_cost = segments[2].3.expect("the tail is priced");

    let session_cost: Option<f64> = db
        .conn
        .query_row("SELECT cost_usd FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert!(close(session_cost, 1.25 + tail_cost));
    for (model, expected) in [(OPUS, 1.15 + tail_cost), (HAIKU, 0.1)] {
        let cost: Option<f64> = db
            .conn
            .query_row(
                "SELECT cost_usd FROM session_model_metrics WHERE model_name=?1",
                [model],
                |r| r.get(0),
            )
            .unwrap();
        assert!(close(cost, expected), "{model}: {cost:?}");
    }

    let dashboard = db.query_analytics(None, None, None, false, None).unwrap();
    let tokens: Vec<_> = dashboard
        .token_usage_by_day
        .iter()
        .map(|d| (d.date.as_str(), d.tokens))
        .collect();
    assert_eq!(
        tokens,
        [
            ("2026-09-20", 174),
            ("2026-09-21", 785),
            ("2026-09-22", 1009)
        ]
    );
    let usd: Vec<_> = dashboard.cost_usd_by_day.iter().map(|d| d.cost).collect();
    assert_eq!(usd.len(), 3);
    assert!(close(Some(usd[0]), 0.5) && close(Some(usd[1]), 0.75));
    assert_eq!(dashboard.cost_by_source.len(), 1);
    let claude = &dashboard.cost_by_source[0];
    assert_eq!(
        (
            claude.source,
            claude.sessions,
            claude.tokens,
            claude.sessions_with_cost_usd
        ),
        (SessionSource::ClaudeCode, 1, 1968, 1)
    );
    assert!(close(claude.cost_usd, 1.25 + tail_cost));
    for entry in &dashboard.model_distribution {
        assert_eq!(entry.source, SessionSource::ClaudeCode);
        assert!(entry.cost_usd.is_some() && !entry.cost_usd_partial);
    }
    assert!(
        dashboard
            .model_usage_by_day
            .iter()
            .all(|d| d.source == SessionSource::ClaudeCode)
    );

    // Sessions are filtered by their last-active day; within the window,
    // runs before it are clamped out.
    let filtered = db
        .query_analytics(Some("2026-09-21"), Some("2026-09-22"), None, false, None)
        .unwrap();
    let tokens: Vec<_> = filtered
        .token_usage_by_day
        .iter()
        .map(|d| d.tokens)
        .collect();
    assert_eq!(tokens, [785, 1009]);
    let usd: Vec<_> = filtered.cost_usd_by_day.iter().map(|d| d.cost).collect();
    assert!(usd.len() == 2 && close(Some(usd[0]), 0.75));

    // Rows indexed before per-run segments (v21) are refreshed.
    db.conn
        .execute("UPDATE sessions SET analytics_version=21", [])
        .unwrap();
    assert!(db.session_is_stale(provider.as_ref(), &locator));
}
