//! Public provider totals reach the durable index, without Copilot billing.

use std::sync::Arc;

use tracepilot_core::provider::{SessionProvider, claude_code::ClaudeCodeProvider};
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
        // Per-day charts need a segment; Claude totals land on the last update day.
        let day_tokens: u64 = dashboard.token_usage_by_day.iter().map(|d| d.tokens).sum();
        assert_eq!(day_tokens, if tail { 2805 } else { 1011 });
        assert_eq!(dashboard.activity_per_day.len(), 1);
        assert_eq!(dashboard.activity_per_day[0].count, 1);
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
