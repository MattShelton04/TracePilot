#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Per-run segments and per-model cost from `cost-state` snapshots.

use std::collections::HashMap;

use tracepilot_core::provider::{
    CostBasis, MetricsSegment, SessionMetrics, SessionProvider, claude_code::ClaudeCodeProvider,
};
use tracepilot_test_support::claude::{
    HAIKU, OPUS, SessionFiles, Transcript, Usage, text, write_session,
};
use tracepilot_test_support::claude_metrics;

fn metrics(files: &SessionFiles) -> SessionMetrics {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider.discover(&|| false).unwrap().remove(0);
    provider
        .load_snapshot(&locator, true, &|| false)
        .unwrap()
        .metrics
        .unwrap()
}

/// Inclusive input + output per model.
fn tokens(
    models: &HashMap<String, tracepilot_core::models::event_types::ModelMetricDetail>,
) -> HashMap<String, u64> {
    models
        .iter()
        .filter_map(|(model, detail)| {
            let usage = detail.usage.as_ref()?;
            let total = usage.input_tokens.unwrap() + usage.output_tokens.unwrap();
            Some((model.clone(), total))
        })
        .filter(|(_, total)| *total > 0)
        .collect()
}

fn segment_tokens(segments: &[MetricsSegment]) -> HashMap<String, u64> {
    let mut totals = HashMap::new();
    for segment in segments {
        for (model, total) in tokens(&segment.model_metrics) {
            *totals.entry(model).or_default() += total;
        }
    }
    totals
}

fn day(segment: &MetricsSegment) -> (String, String) {
    (
        segment.start.date_naive().to_string(),
        segment.end.date_naive().to_string(),
    )
}

#[test]
fn each_run_is_its_snapshot_minus_the_previous_one() {
    for tail in [false, true] {
        let metrics = metrics(&claude_metrics::resumed_across_days(tail));
        let segments = &metrics.segments;
        assert_eq!(segments.len(), if tail { 3 } else { 2 });

        let first = &segments[0];
        assert_eq!(day(first), ("2026-09-20".into(), "2026-09-20".into()));
        assert_eq!(
            tokens(&first.model_metrics),
            HashMap::from([(OPUS.into(), 113), (HAIKU.into(), 61)])
        );
        assert_eq!(first.requests, 1);
        // The side model has no recorded call, so no request count.
        assert!(first.model_metrics[HAIKU].requests.is_none());
        let cost = first.cost.unwrap();
        assert!((cost.amount - 0.5).abs() < 1e-9);
        assert_eq!(cost.basis, CostBasis::ProviderEstimate);
        assert_eq!(first.api_duration_ms, Some(60_000));
        assert!(!first.partial);

        // The unchanged side model is not repeated in the resumed run.
        let second = &segments[1];
        assert_eq!(day(second), ("2026-09-21".into(), "2026-09-21".into()));
        assert_eq!(
            tokens(&second.model_metrics),
            HashMap::from([(OPUS.into(), 785)])
        );
        assert!((second.cost.unwrap().amount - 0.75).abs() < 1e-9);
        assert_eq!(second.api_duration_ms, Some(0));

        if tail {
            let third = &segments[2];
            assert_eq!(day(third), ("2026-09-22".into(), "2026-09-22".into()));
            assert_eq!(
                tokens(&third.model_metrics),
                HashMap::from([(OPUS.into(), 1009)])
            );
            assert!(third.partial);
            assert_eq!(third.cost.unwrap().basis, CostBasis::TracepilotEstimate);
        }

        // Runs add up to the session totals, and so do their costs.
        assert_eq!(segment_tokens(segments), tokens(&metrics.model_metrics));
        let run_cost: f64 = segments.iter().map(|s| s.cost.unwrap().amount).sum();
        assert!((run_cost - metrics.cost.unwrap().amount).abs() < 1e-9);
        assert!((metrics.model_costs[HAIKU] - 0.1).abs() < 1e-9);
        let opus = metrics.model_costs[OPUS] - 1.15;
        assert_eq!(opus.abs() < 1e-9, !tail, "the tail is priced on top");
    }
}

#[test]
fn runs_add_up_to_totals_for_every_accounting_fixture() {
    let fixtures = [
        claude_metrics::snapshot_and_tail(false),
        claude_metrics::snapshot_and_tail(true),
        claude_metrics::recorded_only(),
    ];
    for files in &fixtures {
        let metrics = metrics(files);
        assert!(!metrics.segments.is_empty());
        assert_eq!(
            segment_tokens(&metrics.segments),
            tokens(&metrics.model_metrics)
        );
    }
}

#[test]
fn an_unpriced_tail_call_leaves_its_run_and_model_unpriced() {
    let mut t = Transcript::main();
    t.prompt("Start.");
    t.call(
        "first",
        OPUS,
        vec![text("Ready.")],
        Usage::new(1, 10, 100, 2),
        "end_turn",
    );
    t.cost_state(&[(OPUS, Usage::new(1, 10, 100, 2), 0.4)]);
    t.prompt("Try another model.");
    t.call(
        "other",
        "claude-unknown-9",
        vec![text("Hi.")],
        Usage::new(1, 0, 0, 1),
        "end_turn",
    );
    let metrics = metrics(&write_session(&t, &[]));
    assert_eq!(metrics.segments.len(), 2);
    assert!(metrics.segments[0].cost.is_some());
    assert!(metrics.segments[1].partial);
    assert!(metrics.segments[1].cost.is_none());
    assert!(metrics.cost.is_none());
    assert!((metrics.model_costs[OPUS] - 0.4).abs() < 1e-9);
    assert!(!metrics.model_costs.contains_key("claude-unknown-9"));
}

#[test]
fn a_call_on_a_model_the_snapshot_omits_still_counts_as_a_request() {
    let mut t = Transcript::main();
    t.prompt("Start.");
    t.call(
        "first",
        OPUS,
        vec![text("Ready.")],
        Usage::new(1, 10, 100, 2),
        "end_turn",
    );
    t.call(
        "aside",
        HAIKU,
        vec![text("Aside.")],
        Usage::new(5, 50, 0, 6),
        "end_turn",
    );
    t.cost_state(&[(OPUS, Usage::new(1, 10, 100, 2), 0.4)]);
    let metrics = metrics(&write_session(&t, &[]));

    let [run] = metrics.segments.as_slice() else {
        panic!("one run expected, got {}", metrics.segments.len());
    };
    assert_eq!(run.requests, 2);
    let haiku = &run.model_metrics[HAIKU];
    assert_eq!(haiku.requests.as_ref().and_then(|r| r.count), Some(1));
    // The snapshot has no usage for it, so the run adds none.
    assert!(haiku.usage.is_none());
    assert_eq!(
        segment_tokens(&metrics.segments),
        HashMap::from([(OPUS.into(), 113)])
    );
}
