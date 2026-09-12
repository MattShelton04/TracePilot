//! The agent ledger is explanatory detail, never another source of model totals.

use super::common::write_session_with_tools;
use crate::index_db::IndexDb;
use serde_json::json;

#[test]
fn agent_shutdown_totals_reach_models_and_analytics_exactly_once() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = write_session_with_tools(
        tmp.path(),
        "a1111111-1111-1111-1111-111111111111",
        "org/usage",
        "2026-09-12T10:00:00Z",
    );
    let paid = json!({"requests":{"count":2},"totalNanoAiu":3_000_000_000u64,
        "usage":{"inputTokens":1000,"outputTokens":200,"cacheReadTokens":600,"cacheWriteTokens":400}});
    let free = json!({"requests":{"count":1},"totalNanoAiu":0,
        "usage":{"inputTokens":100,"outputTokens":20,"cacheReadTokens":0,"cacheWriteTokens":0}});
    let snapshot = json!({"type":"session.shutdown","timestamp":"2026-09-12T10:00:00Z","data":{
        "totalNanoAiu":3_000_000_000u64,
        "modelMetrics":{"luna":paid,"search":free},
        "agentMetrics":{
            "main":{"totalNanoAiu":1_000_000_000u64,"modelMetrics":{}},
            "worker":{"totalNanoAiu":2_000_000_000u64,"modelMetrics":{}},
            "search":{"totalNanoAiu":0,"modelMetrics":{}}
        }
    }});
    // Resumed but unchanged ledger: no file-size marker, and no double counting.
    let mut resumed = snapshot.clone();
    resumed["timestamp"] = json!("2026-09-12T10:01:00Z");
    std::fs::write(
        session.join("events.jsonl"),
        format!("{snapshot}\n{resumed}\n"),
    )
    .unwrap();
    db.upsert_session(&session).unwrap();
    let data = db.query_analytics(None, None, None, false).unwrap();
    assert_eq!(data.total_tokens, 1320);
    assert_eq!(data.total_nano_aiu, 3_000_000_000);
    assert_eq!(data.model_distribution.len(), 2);
    let luna = data
        .model_distribution
        .iter()
        .find(|m| m.model == "luna")
        .unwrap();
    assert_eq!(luna.input_tokens, 1000);
    assert_eq!(luna.cache_write_tokens, 400);
    assert_eq!(luna.total_nano_aiu, Some(3_000_000_000));
    let search = data
        .model_distribution
        .iter()
        .find(|m| m.model == "search")
        .unwrap();
    assert_eq!(search.total_nano_aiu, Some(0));
    let cache = data.cache_stats;
    assert_eq!(cache.total_cache_read_tokens, 600);
    assert_eq!(cache.non_cached_input_tokens, 500); // includes cache creation
    assert!((cache.cache_hit_rate - 600.0 / 1100.0 * 100.0).abs() < 1e-9);
}
