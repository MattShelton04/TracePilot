#![allow(clippy::unwrap_used)]
//! WP13: API-equivalent estimates, never premium requests or AI Credits.

use tracepilot_core::provider::{CostBasis, SessionProvider, claude_code::ClaudeCodeProvider};
use tracepilot_test_support::claude::{OPUS, Transcript, Usage, text, write_session};
use tracepilot_test_support::claude_metrics;

fn metrics(t: &Transcript) -> tracepilot_core::ShutdownMetrics {
    let files = write_session(t, &[]);
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider.discover(&|| false).unwrap().remove(0);
    provider
        .load_snapshot(&locator, true, &|| false)
        .unwrap()
        .summary
        .shutdown_metrics
        .unwrap()
}

#[test]
fn snapshot_plus_tail_prices_only_new_calls() {
    let files = claude_metrics::snapshot_and_tail(true);
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let snapshot = provider.load_snapshot(&locator, true, &|| false).unwrap();
    let metrics = snapshot.summary.shutdown_metrics.unwrap();
    // Opus 5.5 tail: 16 uncached, 160 reads, 1600 1h writes, 18 output.
    let expected = 1.25 + (16.0 * 4.0 + 160.0 * 0.2 + 1600.0 * 8.0 + 18.0 * 20.0) / 1e6;
    assert!((metrics.cost_amount.unwrap() - expected).abs() < 1e-12);
    assert_eq!(metrics.cost_basis, Some(CostBasis::TracepilotEstimate));
    assert_eq!(
        metrics.coverage.unwrap().snapshot_cost.unwrap().amount,
        1.25
    );
    assert!(metrics.total_nano_aiu.is_none());
    assert!(metrics.total_premium_requests.is_none());
}

#[test]
fn generic_model_call_fallback_prices_the_same_ttl_split() {
    let files = claude_metrics::recorded_only();
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let loaded = provider.load_snapshot(&locator, true, &|| false).unwrap();
    let generic =
        tracepilot_core::summary::metrics_from_model_calls(&loaded.events.unwrap()).unwrap();
    assert!((generic.cost.unwrap().amount - 0.000203).abs() < 1e-12);
    assert_eq!(generic.cost, loaded.metrics.unwrap().cost);
}

#[test]
fn unknown_tail_does_not_hide_tokens_or_relabel_the_snapshot_as_current_cost() {
    let mut t = Transcript::main();
    let usage = Usage::new(10, 100, 20, 5);
    t.prompt("Before.");
    t.call("before", OPUS, vec![text("Done.")], usage, "end_turn");
    t.cost_state(&[(OPUS, usage, 0.42)]);
    t.prompt("Resume.");
    t.call(
        "tail",
        "claude-unpublished-9",
        vec![text("Working.")],
        usage,
        "end_turn",
    );
    let m = metrics(&t);
    assert!(m.cost_amount.is_none());
    assert!(m.cost_basis.is_none());
    assert_eq!(m.coverage.unwrap().snapshot_cost.unwrap().amount, 0.42);
    assert!(m.model_metrics.contains_key("claude-unpublished-9"));
}

#[test]
fn a_known_zero_cost_is_preserved_but_missing_usage_and_ttl_are_not_zero_costs() {
    use serde_json::json;
    use tracepilot_core::models::SessionEventType;
    use tracepilot_core::models::event_types::ModelCallData;
    use tracepilot_core::parsing::events::{RawEvent, TypedEventData};
    for (data, expected) in [
        (
            json!({"model":OPUS,"inputTokens":0,"outputTokens":0}),
            Some(0.0),
        ),
        (
            json!({"model":OPUS,"inputTokens":100,"outputTokens":1,"cacheWriteTokens":20}),
            None,
        ),
        (
            json!({"model":OPUS,"inputTokens":100,"cacheWriteTokens":20,"cacheWriteByTtl":{"3600":10},"outputTokens":1}),
            None,
        ),
        (json!({"model":OPUS,"inputTokens":100}), None),
        (
            json!({"model":"claude-opus-5-5-fast","inputTokens":100,"outputTokens":1}),
            None,
        ),
    ] {
        let raw: RawEvent =
            serde_json::from_value(json!({"type":"tracepilot.model_call","data":data})).unwrap();
        let typed_data =
            TypedEventData::ModelCall(serde_json::from_value(raw.data.clone()).unwrap());
        let events = [tracepilot_core::parsing::events::TypedEvent {
            raw,
            event_type: SessionEventType::ModelCall,
            typed_data,
        }];
        let m = tracepilot_core::summary::metrics_from_model_calls(&events).unwrap();
        assert_eq!(m.cost.map(|c| c.amount), expected);
    }
    // This type's optional fields must stay optional on the wire.
    assert!(ModelCallData::default().input_tokens.is_none());
}
