//! Per-model usage under a date filter follows the headline rule: each
//! session's lifetime model usage minus its segments outside the range. The
//! AI Credit estimate, token composition and model shares are built from it.

use tracepilot_core::analytics::types::AnalyticsData;
use tracepilot_core::analytics::{compute_analytics_in_range, load_full_sessions_active_in_range};
use tracepilot_core::provider::SessionSource;
use tracepilot_test_support::claude_metrics;

use super::segment_totals::{index_claude, write_copilot};
use crate::index_db::IndexDb;

/// A shutdown with no AI Credit telemetry, so the dashboard estimates it.
fn unbilled_shutdown(id: &str, at: &str, input: u64, cache_read: u64) -> String {
    format!(
        r#"{{"type":"session.shutdown","data":{{"shutdownType":"routine","totalPremiumRequests":1,"modelMetrics":{{"gpt-5.5":{{"requests":{{"count":1,"cost":1}},"usage":{{"inputTokens":{input},"outputTokens":0,"cacheReadTokens":{cache_read},"cacheWriteTokens":0}}}}}}}},"id":"{id}","timestamp":"{at}"}}"#
    )
}

fn resume(id: &str, at: &str) -> String {
    format!(r#"{{"type":"session.resume","data":{{}},"id":"{id}","timestamp":"{at}"}}"#)
}

fn model_tokens(data: &AnalyticsData) -> (u64, u64, u64) {
    data.model_distribution.iter().fold((0, 0, 0), |acc, m| {
        (
            acc.0 + m.input_tokens + m.output_tokens,
            acc.1 + m.unobserved_input_tokens,
            acc.2 + m.cache_read_tokens,
        )
    })
}

#[test]
fn model_usage_counts_only_in_range_segments_like_the_headline() {
    let temp = tempfile::tempdir().unwrap();
    // Runs ending 03-01, 03-03 and 03-05 with 100, 200 and 400 tokens.
    let events = [
        unbilled_shutdown("s1", "2026-03-01T10:00:00Z", 100, 10),
        resume("r2", "2026-03-03T09:00:00Z"),
        unbilled_shutdown("s2", "2026-03-03T10:00:00Z", 200, 20),
        resume("r3", "2026-03-05T09:00:00Z"),
        unbilled_shutdown("s3", "2026-03-05T10:00:00Z", 400, 40),
    ];
    let events: Vec<&str> = events.iter().map(String::as_str).collect();
    let path = write_copilot(
        temp.path(),
        "33333333-3333-4333-8333-333333333333",
        "2026-03-05T10:00:00Z",
        &events,
    );
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();

    for (from, to, tokens, runs) in [
        (Some("2026-03-03"), Some("2026-03-05"), 600, 2),
        (None, None, 700, 3),
    ] {
        let data = db.query_analytics(from, to, None, false, None).unwrap();
        let day_tokens: u64 = data.token_usage_by_day.iter().map(|d| d.tokens).sum();
        let day_model_tokens: u64 = data
            .model_usage_by_day
            .iter()
            .map(|d| d.input_tokens + d.output_tokens)
            .sum();
        assert_eq!(data.total_tokens, tokens, "from={from:?}");
        assert_eq!(day_tokens, tokens, "from={from:?}");
        assert_eq!(day_model_tokens, tokens, "from={from:?}");
        // Tokens, the unobserved share the AI Credit estimate prices, and
        // the cache split all follow the range.
        assert_eq!(
            model_tokens(&data),
            (tokens, tokens, tokens / 10),
            "from={from:?}"
        );
        assert_eq!(data.cache_stats.total_input_tokens, tokens, "from={from:?}");
        assert_eq!(data.cache_stats.total_cache_read_tokens, tokens / 10);
        let model = &data.model_distribution[0];
        assert_eq!(model.request_count, runs, "from={from:?}");
        assert_eq!(model.premium_requests, runs as f64, "from={from:?}");

        let inputs =
            load_full_sessions_active_in_range(temp.path(), from, to, None, false).unwrap();
        let fallback = serde_json::to_value(compute_analytics_in_range(&inputs, from, to)).unwrap();
        let indexed = serde_json::to_value(&data).unwrap();
        for field in ["modelDistribution", "cacheStats", "totalTokens"] {
            assert_eq!(indexed[field], fallback[field], "{field}: from={from:?}");
        }
    }
}

#[test]
fn claude_model_rows_follow_the_range_and_drop_runs_before_it() {
    let db = index_claude(&claude_metrics::resumed_across_days(true));
    let ranged = db
        .query_analytics(Some("2026-09-21"), Some("2026-09-22"), None, false, None)
        .unwrap();
    assert_eq!(model_tokens(&ranged).0, ranged.total_tokens);
    assert_eq!(ranged.total_tokens, 785 + 1009);
    // Haiku was used only on 09-20, so it has no row in the range.
    assert_eq!(ranged.model_distribution.len(), 1);
    let opus = &ranged.model_distribution[0];
    assert_eq!(opus.source, SessionSource::ClaudeCode);
    // Segments carry no per-model USD, so the share of a model that also ran
    // outside the range is unknown rather than its whole-session figure.
    assert_eq!((opus.cost_usd, opus.cost_usd_partial), (None, false));

    let all = db.query_analytics(None, None, None, false, None).unwrap();
    assert_eq!(model_tokens(&all).0, all.total_tokens);
    assert_eq!(all.model_distribution.len(), 2);
    assert!(all.model_distribution.iter().all(|m| m.cost_usd.is_some()));
}
