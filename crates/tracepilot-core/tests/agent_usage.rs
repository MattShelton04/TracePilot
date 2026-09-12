use serde_json::{Value, json};
use std::io::Write;
use tracepilot_core::parsing::events::{extract_combined_shutdown_data, parse_typed_events};

fn metrics(data: Vec<Value>) -> tracepilot_core::models::event_types::ShutdownData {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    for (i, payload) in data.into_iter().enumerate() {
        writeln!(file, "{}", json!({"type":"session.shutdown", "timestamp":format!("2026-09-12T10:00:{i:02}Z"), "data":payload})).unwrap();
    }
    let parsed = parse_typed_events(file.path()).unwrap();
    assert!(parsed.diagnostics.deserialization_failures.is_empty());
    extract_combined_shutdown_data(&parsed.events).unwrap().0
}

fn agent(credits: Value, input: u64, output: u64) -> Value {
    json!({"totalApiDurationMs":500,"totalNanoAiu":credits,"modelMetrics":{
        "gpt-5.6-luna":{"requests":{"count":1,"cost":0}, "totalNanoAiu":credits,
        "usage":{"inputTokens":input,"outputTokens":output,"cacheReadTokens":400,"cacheWriteTokens":100,"reasoningTokens":3},
        "tokenDetails":{"input":{"tokenCount":input-500},"cache_read":{"tokenCount":400},"cache_write":{"tokenCount":100},"output":{"tokenCount":output}}}
    }})
}

#[test]
fn decimal_agent_billing_and_explicit_zero_survive_normalization() {
    let data = metrics(vec![json!({"totalNanoAiu":600_000_000, "agentMetrics":{
        "main":agent(json!(600_000_000.0),600,10), "free-worker":agent(json!(0.0),900,20)
    }})]);
    let snapshot = data.agent_usage.unwrap();
    assert!(!snapshot.has_invalid_fields);
    assert_eq!(snapshot.agents["main"].total_nano_aiu, Some(600_000_000.0));
    assert_eq!(snapshot.agents["free-worker"].total_nano_aiu, Some(0.0));
    let model = &snapshot.agents["main"].model_metrics["gpt-5.6-luna"];
    assert_eq!(model.total_nano_aiu, Some(600_000_000.0));
    assert_eq!(model.usage.as_ref().unwrap().reasoning_tokens, Some(3));
    assert_eq!(snapshot.event_index, 0);
    assert_eq!(snapshot.timestamp, data.metrics_timestamp);
}

#[test]
fn resumed_agent_ledger_uses_latest_snapshot_without_double_counting() {
    // agentMetrics also identifies cumulative accounting when log-size stat fails.
    let data = metrics(vec![
        json!({"totalNanoAiu":30,"agentMetrics":{"main":agent(json!(10.0),600,10),"worker":agent(json!(20.0),700,20)}}),
        json!({"totalNanoAiu":40,"agentMetrics":{"main":agent(json!(20.0),800,15),"worker":agent(json!(20.0),700,20)}}),
    ]);
    assert_eq!(data.total_nano_aiu, Some(40));
    let snapshot = data.agent_usage.unwrap();
    assert_eq!(snapshot.event_index, 1);
    assert_eq!(
        snapshot
            .agents
            .values()
            .map(|a| a.total_nano_aiu.unwrap())
            .sum::<f64>(),
        40.0
    );
}

#[test]
fn later_missing_map_keeps_old_agent_snapshot_and_exposes_its_timestamp() {
    let data = metrics(vec![
        json!({"eventsFileSizeBytes":10,"totalNanoAiu":10,"agentMetrics":{"main":agent(json!(10.0),600,10)}}),
        json!({"eventsFileSizeBytes":20,"totalNanoAiu":20}),
    ]);
    assert_eq!(data.total_nano_aiu, Some(20));
    let snapshot = data.agent_usage.unwrap();
    assert_eq!(snapshot.agents["main"].total_nano_aiu, Some(10.0));
    assert!(snapshot.timestamp < data.metrics_timestamp);
}

#[test]
fn malformed_agent_fields_do_not_discard_healthy_usage() {
    let mut broken = agent(json!(-1), 600, 10);
    broken["totalApiDurationMs"] = json!("invalid");
    broken["modelMetrics"]["gpt-5.6-luna"]["usage"]["inputTokens"] = json!(2.5);
    let data = metrics(vec![json!({"agentMetrics":{
        "bad":broken,"good":agent(json!(50.0),800,30),"bad-shape":[]
    }})]);
    let snapshot = data.agent_usage.unwrap();
    assert!(snapshot.has_invalid_fields);
    assert_eq!(snapshot.agents["bad"].total_nano_aiu, None);
    assert_eq!(snapshot.agents["bad"].total_api_duration_ms, None);
    assert_eq!(snapshot.agents["good"].total_nano_aiu, Some(50.0));
}

#[test]
fn legacy_logs_keep_usage_unavailable_and_segment_totals_unchanged() {
    let data = metrics(vec![json!({"totalNanoAiu":20}), json!({"totalNanoAiu":30})]);
    assert!(data.agent_usage.is_none());
    assert_eq!(data.total_nano_aiu, Some(50));
}

#[test]
fn malformed_latest_ledger_does_not_masquerade_as_previous_good_data() {
    let data = metrics(vec![
        json!({"eventsFileSizeBytes":10,"agentMetrics":{"main":agent(json!(10.0),600,10)}}),
        json!({"eventsFileSizeBytes":20,"agentMetrics":[]}),
    ]);
    let snapshot = data.agent_usage.unwrap();
    assert!(snapshot.has_invalid_fields);
    assert!(snapshot.agents.is_empty());
    assert_eq!(snapshot.timestamp, data.metrics_timestamp);
}

#[test]
fn child_shutdown_does_not_replace_root_usage_or_timestamp() {
    let mut file = tempfile::NamedTempFile::new().unwrap();
    writeln!(file, "{}", json!({"type":"session.shutdown","timestamp":"2026-09-12T10:00:00Z","data":{"totalNanoAiu":10,"agentMetrics":{"main":agent(json!(10.0),600,10)}}})).unwrap();
    writeln!(file, "{}", json!({"type":"session.shutdown","agentId":"child","timestamp":"2026-09-12T10:01:00Z","data":{"totalNanoAiu":99,"agentMetrics":{"main":agent(json!(99.0),600,10)}}})).unwrap();
    let parsed = parse_typed_events(file.path()).unwrap();
    let (data, count) = extract_combined_shutdown_data(&parsed.events).unwrap();
    assert_eq!(count, 1);
    assert_eq!(data.total_nano_aiu, Some(10));
    assert_eq!(
        data.agent_usage.as_ref().unwrap().timestamp,
        data.metrics_timestamp
    );
}

#[test]
fn latest_ledger_replaces_reset_counters_without_resurrecting_removed_agents() {
    let data = metrics(vec![
        json!({"agentMetrics":{"main":agent(json!(100.0),600,10),"old-worker":agent(json!(200.0),700,20)}}),
        json!({"agentMetrics":{"main":agent(json!(10.0),600,10)}}),
    ]);
    let snapshot = data.agent_usage.unwrap();
    assert_eq!(snapshot.agents.len(), 1);
    assert_eq!(snapshot.agents["main"].total_nano_aiu, Some(10.0));
}

#[test]
fn cumulative_then_legacy_then_upgrade_retains_each_accounting_history() {
    let first = json!({"totalNanoAiu":100,"agentMetrics":{"main":agent(json!(100.0),600,10)}});
    let legacy = json!({"totalNanoAiu":20});
    let downgraded = metrics(vec![first.clone(), legacy.clone()]);
    assert_eq!(downgraded.total_nano_aiu, Some(120));
    assert!(downgraded.agent_usage.unwrap().timestamp < downgraded.metrics_timestamp);
    let upgraded = metrics(vec![
        first,
        legacy,
        json!({"totalNanoAiu":30,"agentMetrics":{"main":agent(json!(30.0),600,10)}}),
    ]);
    // The upgrade restores the last legacy segment (20), not the earlier 100.
    assert_eq!(upgraded.total_nano_aiu, Some(130));
    assert_eq!(
        upgraded.agent_usage.unwrap().agents["main"].total_nano_aiu,
        Some(30.0)
    );
}
