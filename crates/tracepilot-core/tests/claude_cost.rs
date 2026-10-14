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
fn native_missing_usage_stays_unpriced_with_and_without_a_snapshot() {
    use serde_json::json;
    for snapshot in [false, true] {
        for usage in [
            json!(null),
            json!({"input_tokens":10}),
            json!({"output_tokens":5}),
        ] {
            let mut t = Transcript::main();
            t.prompt("Start.");
            if snapshot {
                t.cost_state(&[(OPUS, Usage::new(10, 100, 20, 5), 0.42)]);
            }
            t.record(
                "assistant",
                json!({"message":{"id":"unfinished", "model":OPUS,
                "role":"assistant", "content":[text("Still working.")], "usage":usage}}),
            );
            let m = metrics(&t);
            assert!(
                m.cost_amount.is_none(),
                "missing native usage must not mean zero cost"
            );
            assert_eq!(
                m.coverage.unwrap().snapshot_cost.map(|c| c.amount),
                snapshot.then_some(0.42)
            );
            let files = write_session(&t, &[]);
            let provider = ClaudeCodeProvider::new(files.root.path());
            let locator = provider.discover(&|| false).unwrap().remove(0);
            let events = provider.load_events(&locator, &|| false).unwrap().unwrap();
            assert!(
                tracepilot_core::summary::metrics_from_model_calls(&events)
                    .unwrap()
                    .cost
                    .is_none()
            );
        }
    }
}

#[test]
fn historical_haiku_native_alias_is_priced() {
    let mut t = Transcript::main();
    t.prompt("Check.");
    t.call(
        "haiku",
        "claude-3-5-haiku-20241022",
        vec![text("Done.")],
        Usage::new(10, 0, 0, 5),
        "end_turn",
    );
    assert!((metrics(&t).cost_amount.unwrap() - 0.000028).abs() < 1e-12);
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

fn session_metrics(t: &Transcript) -> tracepilot_core::provider::SessionMetrics {
    let files = write_session(t, &[]);
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider.discover(&|| false).unwrap().remove(0);
    provider
        .load_snapshot(&locator, true, &|| false)
        .unwrap()
        .metrics
        .unwrap()
}

/// Opus 5.5 at 4 / 0.2 / 8 (1h writes) / 20 USD per million.
fn opus_usd(u: Usage) -> f64 {
    (u.input as f64 * 4.0
        + u.cache_read as f64 * 0.2
        + u.cache_write_1h as f64 * 8.0
        + u.output as f64 * 20.0)
        / 1e6
}

#[test]
fn a_run_that_never_wrote_a_snapshot_is_priced_on_top_of_a_later_one() {
    // A desktop run is closed without writing `cost-state`. A later resume
    // makes no call and writes zero totals that start when it started.
    let usage = Usage::new(10, 1000, 200, 50);
    let mut t = Transcript::main();
    t.prompt("Work.");
    t.call("closed", OPUS, vec![text("Done.")], usage, "end_turn");
    t.idle(3600);
    t.cost_state_since(3600, &[]);
    let m = session_metrics(&t);
    let cost = m.cost.unwrap();
    assert!((cost.amount - opus_usd(usage)).abs() < 1e-12);
    assert_eq!(cost.basis, CostBasis::TracepilotEstimate);
    assert_eq!(m.coverage.as_ref().unwrap().tail_calls, 1);
    let tokens = m.model_metrics[OPUS].usage.as_ref().unwrap();
    assert_eq!(tokens.output_tokens, Some(50));
    assert!((m.model_costs[OPUS] - opus_usd(usage)).abs() < 1e-12);
    let [segment] = m.segments.as_slice() else {
        panic!("one run: {:?}", m.segments);
    };
    assert!(segment.partial);
    assert!((segment.cost.unwrap().amount - opus_usd(usage)).abs() < 1e-12);
}

#[test]
fn a_resumed_run_counts_its_own_calls_once_and_the_closed_run_once() {
    let closed = Usage::new(10, 1000, 200, 50);
    let resumed = Usage::new(20, 2000, 300, 70);
    let mut t = Transcript::main();
    t.prompt("Work.");
    t.call("closed", OPUS, vec![text("Done.")], closed, "end_turn");
    t.idle(3600);
    t.prompt("Again.");
    t.call("resumed", OPUS, vec![text("Done.")], resumed, "end_turn");
    t.cost_state_since(3600, &[(OPUS, resumed, 0.5)]);
    let m = session_metrics(&t);
    assert!((m.cost.unwrap().amount - (0.5 + opus_usd(closed))).abs() < 1e-12);
    let coverage = m.coverage.unwrap();
    assert_eq!((coverage.recorded_calls, coverage.tail_calls), (2, 1));
    let tokens = m.model_metrics[OPUS].usage.as_ref().unwrap();
    assert_eq!(tokens.output_tokens, Some(120));
    assert_eq!(m.segments.len(), 2);
    assert!(m.segments[0].partial && !m.segments[1].partial);
    assert!((m.segments[1].cost.unwrap().amount - 0.5).abs() < 1e-12);
}

#[test]
fn a_snapshot_started_before_the_session_covers_every_call() {
    let usage = Usage::new(10, 1000, 200, 50);
    let mut t = Transcript::main();
    t.prompt("Work.");
    t.call("covered", OPUS, vec![text("Done.")], usage, "end_turn");
    t.cost_state_since(0, &[(OPUS, usage, 0.42)]);
    let m = session_metrics(&t);
    assert_eq!(m.cost.unwrap().amount, 0.42);
    assert_eq!(m.coverage.unwrap().tail_calls, 0);
}

#[test]
fn calls_join_the_snapshots_1m_context_name_for_their_model() {
    let opus_1m = format!("{OPUS}[1m]");
    let usage = Usage::new(10, 1000, 200, 50);
    let mut t = Transcript::main();
    t.prompt("Work.");
    t.call("covered", OPUS, vec![text("Done.")], usage, "end_turn");
    t.cost_state(&[(&opus_1m, usage, 0.42)]);
    t.prompt("More.");
    t.call("tail", OPUS, vec![text("Done.")], usage, "end_turn");
    let m = session_metrics(&t);
    assert!(
        !m.model_metrics.contains_key(OPUS),
        "{:?}",
        m.model_metrics.keys()
    );
    let row = &m.model_metrics[&opus_1m];
    assert_eq!(row.requests.as_ref().unwrap().count, Some(2));
    assert_eq!(row.usage.as_ref().unwrap().output_tokens, Some(100));
    assert!((m.model_costs[&opus_1m] - (0.42 + opus_usd(usage))).abs() < 1e-12);
    assert!(!m.model_costs.contains_key(OPUS));
    for segment in &m.segments {
        assert_eq!(
            segment.model_metrics.keys().collect::<Vec<_>>(),
            [&opus_1m],
            "{segment:?}"
        );
    }
}

#[test]
fn uncovered_calls_without_final_usage_mark_a_lower_bound() {
    let usage = Usage::new(10, 1000, 200, 50);
    let mut t = Transcript::main();
    t.prompt("Work.");
    t.call("finished", OPUS, vec![text("Done.")], usage, "end_turn");
    t.call("streaming", OPUS, vec![text("Still")], usage, None);
    let coverage = session_metrics(&t).coverage.unwrap();
    assert_eq!(
        (coverage.tail_calls, coverage.unfinished_tail_calls),
        (2, 1)
    );
}
