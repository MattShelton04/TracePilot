//! Attaching recorded reuse to a window without overstating the link.

use crate::prompt_cache::{
    CacheComparison, CacheConfidence, CacheWindow, CacheWindowOutcome, attach_observations,
};
use crate::session_store::{AttributionStatus, BillingItemsStatus, RequestInitiator, StoreRequest};

fn window(
    index: usize,
    idle_start: &str,
    resume_at: &str,
    outcome: CacheWindowOutcome,
) -> CacheWindow {
    CacheWindow {
        index,
        idle_start: idle_start.to_string(),
        resume_at: Some(resume_at.to_string()),
        idle_seconds: Some(60),
        model: Some("gpt-5.6-luna".to_string()),
        expires_at: None,
        ttl_seconds: None,
        outcome,
        confidence: CacheConfidence::Predicted,
        resume_offset_seconds: None,
        resume_event_index: None,
        resume_interaction_id: None,
        resume_source: None,
        prefix_tokens: None,
        interaction_nano_aiu: None,
        prefix_changes: Vec::new(),
    }
}

fn request(source_row_id: i64, recorded_at: &str, cache_read_tokens: Option<u64>) -> StoreRequest {
    StoreRequest {
        source_row_id,
        session_id: "s1".to_string(),
        turn_index: None,
        agent_id: None,
        parent_tool_call_id: None,
        model: "gpt-5.6-luna".to_string(),
        input_tokens: Some(1000),
        output_tokens: Some(100),
        cache_read_tokens,
        cache_write_tokens: Some(0),
        reasoning_tokens: None,
        total_nano_aiu: None,
        request_multiplier: None,
        duration_ms: None,
        time_to_first_token_ms: None,
        output_ttft_ms: None,
        inter_token_latency_ms: None,
        initiator: Some(RequestInitiator::User),
        api_endpoint: None,
        reasoning_effort: None,
        finish_reason: None,
        content_filter_triggered: None,
        copilot_usage_model: None,
        billing_items: Vec::new(),
        billing_items_status: BillingItemsStatus::Absent,
        recorded_at: Some(recorded_at.to_string()),
        invalid_fields: Vec::new(),
        row_fingerprint: String::new(),
    }
}

#[test]
fn the_first_root_request_after_a_resume_supplies_the_observation() {
    let windows = vec![window(
        0,
        "2026-09-20T10:00:00Z",
        "2026-09-20T10:05:00Z",
        CacheWindowOutcome::Warm,
    )];
    // A multi-request turn: the first request is the one that resumed the
    // window, and the later tool-call round trips must not stand in for it.
    let requests = vec![
        request(1, "2026-09-20T10:05:01Z", Some(12_000)),
        request(2, "2026-09-20T10:05:09Z", Some(50)),
    ];

    let observations = attach_observations(&windows, &requests);
    assert_eq!(observations.len(), 1);
    assert_eq!(observations[0].source_row_id, 1);
    assert_eq!(observations[0].cache_read_tokens, Some(12_000));
    // Order, interval and model agree, but nothing identifies the pair, so
    // the claim stays below `Exact`.
    assert_eq!(observations[0].attribution, AttributionStatus::Validated);
    assert!(observations[0].attribution.is_reliable());
    assert_eq!(observations[0].comparison, CacheComparison::Agrees);
}

#[test]
fn a_prediction_and_an_observation_can_disagree_without_either_being_rewritten() {
    let windows = vec![window(
        0,
        "2026-09-20T10:00:00Z",
        "2026-09-20T11:00:00Z",
        CacheWindowOutcome::Expired,
    )];
    let requests = vec![request(1, "2026-09-20T11:00:02Z", Some(12_000))];

    let observations = attach_observations(&windows, &requests);
    assert_eq!(observations[0].comparison, CacheComparison::Differs);
    // The window's own prediction is untouched: reuse by a later request is
    // not evidence the expiry prediction was wrong.
    assert_eq!(windows[0].outcome, CacheWindowOutcome::Expired);
    assert_eq!(windows[0].confidence, CacheConfidence::Predicted);
}

#[test]
fn concurrent_workers_and_compaction_never_attach_to_a_root_window() {
    let windows = vec![window(
        0,
        "2026-09-20T10:00:00Z",
        "2026-09-20T10:05:00Z",
        CacheWindowOutcome::Warm,
    )];
    let mut worker = request(1, "2026-09-20T10:05:01Z", Some(9_000));
    worker.agent_id = Some("agent-1".to_string());
    worker.initiator = Some(RequestInitiator::SubAgent);
    let mut compaction = request(2, "2026-09-20T10:05:02Z", Some(148_059));
    compaction.initiator = Some(RequestInitiator::Compaction);

    assert!(attach_observations(&windows, &[worker, compaction]).is_empty());
}

#[test]
fn a_request_from_a_later_exchange_is_not_pulled_back() {
    let windows = vec![
        window(
            0,
            "2026-09-20T10:00:00Z",
            "2026-09-20T10:05:00Z",
            CacheWindowOutcome::Warm,
        ),
        window(
            1,
            "2026-09-20T10:06:00Z",
            "2026-09-20T10:30:00Z",
            CacheWindowOutcome::Expired,
        ),
    ];
    // Only the second window has a request inside its interval.
    let requests = vec![request(1, "2026-09-20T10:30:05Z", Some(0))];

    let observations = attach_observations(&windows, &requests);
    assert_eq!(observations.len(), 1);
    assert_eq!(observations[0].window_index, 1);
}

#[test]
fn a_model_change_across_the_window_blocks_the_association() {
    let windows = vec![window(
        0,
        "2026-09-20T10:00:00Z",
        "2026-09-20T10:05:00Z",
        CacheWindowOutcome::Warm,
    )];
    let mut other_model = request(1, "2026-09-20T10:05:01Z", Some(12_000));
    other_model.model = "some-other-model".to_string();

    assert!(attach_observations(&windows, &[other_model]).is_empty());
}

#[test]
fn an_unorderable_tie_leaves_the_window_without_an_observation() {
    let windows = vec![window(
        0,
        "2026-09-20T10:00:00Z",
        "2026-09-20T10:05:00Z",
        CacheWindowOutcome::Warm,
    )];
    // Identical timestamps mean "the first request" is not well defined, so
    // no observation is better than an arbitrary one.
    let requests = vec![
        request(1, "2026-09-20T10:05:01Z", Some(12_000)),
        request(2, "2026-09-20T10:05:01Z", Some(0)),
    ];

    assert!(attach_observations(&windows, &requests).is_empty());
}

#[test]
fn an_absent_cache_counter_is_not_comparable() {
    let windows = vec![window(
        0,
        "2026-09-20T10:00:00Z",
        "2026-09-20T10:05:00Z",
        CacheWindowOutcome::Warm,
    )];
    let observations = attach_observations(&windows, &[request(1, "2026-09-20T10:05:01Z", None)]);
    assert_eq!(observations[0].comparison, CacheComparison::NotComparable);
}

#[test]
fn a_pending_window_has_nothing_to_compare_against() {
    let mut pending = window(
        0,
        "2026-09-20T10:00:00Z",
        "2026-09-20T10:05:00Z",
        CacheWindowOutcome::Pending,
    );
    pending.confidence = CacheConfidence::Unavailable;
    let observations = attach_observations(
        &[pending],
        &[request(1, "2026-09-20T10:05:01Z", Some(12_000))],
    );
    assert_eq!(observations[0].comparison, CacheComparison::NotComparable);
}

#[test]
fn a_window_that_never_resumed_gets_no_observation() {
    let mut unresolved = window(
        0,
        "2026-09-20T10:00:00Z",
        "2026-09-20T10:05:00Z",
        CacheWindowOutcome::Pending,
    );
    unresolved.resume_at = None;
    assert!(
        attach_observations(
            &[unresolved],
            &[request(1, "2026-09-20T10:05:01Z", Some(1))]
        )
        .is_empty()
    );
}
