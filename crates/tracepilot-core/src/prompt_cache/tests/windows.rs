//! Window boundaries, expiry classification and summaries.

use serde_json::json;

use super::*;

#[test]
fn warm_resume_is_predicted_and_linked_to_the_prompt() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        turn_end("00:00:10"),
        checkpoint("00:00:11", 1_000, "00:30:05", 1800, None),
        user("00:10:00", "i2"),
        turn_end("00:10:30"),
        checkpoint("00:10:31", 1_600, "00:40:25", 1800, None),
    ];
    let timeline = build(&events);

    assert_eq!(timeline.source, PromptCacheSource::Checkpoints);
    assert_eq!(timeline.checkpoint_count, 2);
    assert_eq!(timeline.windows.len(), 2);
    let window = &timeline.windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::Warm);
    assert_eq!(window.confidence, CacheConfidence::Predicted);
    assert_eq!(window.idle_start, "2026-09-12T00:00:11.000Z");
    assert_eq!(
        window.resume_at.as_deref(),
        Some("2026-09-12T00:10:00.000Z")
    );
    assert_eq!(window.idle_seconds, Some(589));
    assert_eq!(
        window.expires_at.as_deref(),
        Some("2026-09-12T00:30:05.000Z")
    );
    assert_eq!(window.ttl_seconds, Some(1800));
    assert_eq!(window.resume_offset_seconds, Some(-1205));
    assert_eq!(window.resume_event_index, Some(4));
    assert_eq!(window.resume_interaction_id.as_deref(), Some("i2"));
    assert_eq!(window.interaction_nano_aiu, Some(600));
    assert_eq!(window.model.as_deref(), Some(MODEL));

    let pending = &timeline.windows[1];
    assert_eq!(pending.outcome, CacheWindowOutcome::Pending);
    assert_eq!(pending.resume_at, None);
    assert_eq!(
        pending.expires_at.as_deref(),
        Some("2026-09-12T00:40:25.000Z")
    );

    assert_eq!(timeline.summary.resumed_windows, 1);
    assert_eq!(timeline.summary.warm, 1);
    assert_eq!(timeline.summary.median_idle_seconds, Some(589));
    assert_eq!(
        timeline.observed_ttls,
        vec![ObservedCacheTtl {
            model: MODEL.into(),
            ttl_seconds: 1800,
            count: 2
        }]
    );
}

#[test]
fn resume_exactly_at_expiry_is_expired_and_counts_resent_tokens() {
    let base = baseline("high", default_tools(), 4, &["a", "b", "c", "d"]);
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, Some(base)),
        user("00:30:00", "i2"),
    ];
    let timeline = build(&events);
    let window = &timeline.windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::Expired);
    assert_eq!(window.resume_offset_seconds, Some(0));
    assert_eq!(window.prefix_tokens, Some(20_000));
    assert_eq!(timeline.summary.expired, 1);
    assert_eq!(timeline.summary.resent_prefix_tokens, 20_000);
}

#[test]
fn shutdown_without_resume_ends_the_window() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        event(
            "session.shutdown",
            "00:05:00",
            json!({"shutdownType": "routine"}),
        ),
    ];
    let window = &build(&events).windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::SessionEnded);
    assert_eq!(window.confidence, CacheConfidence::Predicted);
}

#[test]
fn a_resume_after_restart_is_still_classified() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        event("session.shutdown", "00:05:00", json!({})),
        event(
            "session.resume",
            "00:20:00",
            json!({"selectedModel": MODEL}),
        ),
        user("00:20:05", "i2"),
    ];
    let window = &build(&events).windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::Warm);
}

#[test]
fn switching_to_a_model_without_cache_state_is_a_model_change() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint(
            "00:00:11",
            0,
            "00:30:00",
            1800,
            Some(baseline("high", default_tools(), 2, &["a", "b"])),
        ),
        event(
            "session.model_change",
            "00:02:00",
            json!({"newModel": "claude-sonnet-5", "previousModel": MODEL}),
        ),
        user("00:03:00", "i2"),
    ];
    let timeline = build(&events);
    let window = &timeline.windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::ModelChanged);
    assert_eq!(window.model.as_deref(), Some("claude-sonnet-5"));
    assert_eq!(window.expires_at, None);
    assert_eq!(
        window.prefix_changes[0].summary,
        "Model changed gpt-5.6-luna → claude-sonnet-5"
    );
    assert_eq!(timeline.summary.model_changed, 1);
    assert_eq!(timeline.summary.resent_prefix_tokens, 20_000);
}

#[test]
fn missing_break_state_keeps_the_predicted_expiry() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        user("00:40:00", "i2"),
    ];
    let timeline = build(&events);
    assert_eq!(timeline.baseline_count, 0);
    let window = &timeline.windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::Expired);
    assert_eq!(window.confidence, CacheConfidence::Predicted);
    assert!(window.prefix_changes.is_empty());
    assert_eq!(window.prefix_tokens, None);
}

#[test]
fn malformed_entries_are_skipped_and_counted() {
    let mut bad = checkpoint("00:00:11", 0, "00:30:00", 1800, None);
    bad.raw.data["promptCacheBreakState"] = json!([
        "not an object",
        {"conversation": "main"},
        {"conversation": "main", "models": {MODEL: 42}}
    ]);
    let (typed, _) = crate::parsing::events::typed_data_from_raw(&bad.event_type, &bad.raw.data);
    bad.typed_data = typed;
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        bad,
        user("00:10:00", "i2"),
    ];
    let timeline = build(&events);
    assert_eq!(timeline.malformed_entry_count, 3);
    assert_eq!(timeline.windows[0].outcome, CacheWindowOutcome::Warm);
}

#[test]
fn a_checkpoint_that_fails_typed_parsing_is_read_leniently() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        event(
            "session.usage_checkpoint",
            "00:00:11",
            json!({
                "totalNanoAiu": 5,
                "modelCacheState": [
                    {"modelId": MODEL, "cacheExpiresAt": "2026-09-12T00:30:00Z", "cacheTtlSeconds": "1800"},
                    {"cacheTtlSeconds": 60}
                ]
            }),
        ),
        user("00:10:00", "i2"),
        event(
            "session.usage_checkpoint",
            "00:10:30",
            json!({"modelCacheState": "not an array"}),
        ),
    ];
    assert!(matches!(
        events[2].typed_data,
        crate::parsing::events::TypedEventData::Other(_)
    ));
    let timeline = build(&events);
    assert_eq!(timeline.checkpoint_count, 2);
    // Only the entry without a model id is unreadable.
    assert_eq!(timeline.malformed_entry_count, 1);
    let window = &timeline.windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::Warm);
    assert_eq!(window.ttl_seconds, Some(1800));
    // A missing cumulative total must not turn into a huge delta.
    assert_eq!(window.interaction_nano_aiu, None);
}

#[test]
fn agent_wakes_stay_out_of_reply_figures() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        event(
            "assistant.turn_start",
            "00:45:00",
            json!({"turnId": "3", "interactionId": "i1"}),
        ),
        checkpoint("00:45:30", 0, "01:15:00", 1800, None),
        user("00:50:00", "i2"),
    ];
    let summary = build(&events).summary;
    assert_eq!(summary.agent_resumes, 1);
    assert_eq!(summary.resumed_windows, 1);
    assert_eq!(summary.expired, 0);
    assert_eq!(summary.warm, 1);
    assert_eq!(summary.median_idle_seconds, Some(270));
}

#[test]
fn an_expiry_before_its_checkpoint_is_not_ttl_evidence() {
    let data = json!({
        "totalNanoAiu": 0,
        "modelCacheState": [
            {"modelId": MODEL, "cacheExpiresAt": "2026-09-12T00:30:00Z", "cacheTtlSeconds": 1800},
            {"modelId": "gpt-5-mini", "cacheExpiresAt": "2026-09-12T00:00:00Z", "cacheTtlSeconds": 86400}
        ]
    });
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        event("session.usage_checkpoint", "00:05:00", data),
    ];
    let ttls = build(&events).observed_ttls;
    assert_eq!(ttls.len(), 1);
    assert_eq!(ttls[0].model, MODEL);
}

#[test]
fn pre_checkpoint_sessions_use_turn_gaps_and_the_registry() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        turn_end("00:00:10"),
        user("00:05:00", "i2"),
        turn_end("00:05:30"),
        user("01:00:00", "i3"),
    ];
    let unavailable = build(&events);
    assert_eq!(unavailable.source, PromptCacheSource::TurnGaps);
    assert_eq!(unavailable.windows.len(), 2);
    assert!(unavailable.windows.iter().all(|w| {
        w.confidence == CacheConfidence::Unavailable && w.outcome == CacheWindowOutcome::Unknown
    }));

    let estimated = build_prompt_cache_timeline(&events, |model| (model == MODEL).then_some(1800));
    let [first, second] = estimated.windows.as_slice() else {
        panic!("expected two windows");
    };
    assert_eq!(first.confidence, CacheConfidence::Estimated);
    assert_eq!(first.outcome, CacheWindowOutcome::Warm);
    assert_eq!(first.idle_start, "2026-09-12T00:00:10.000Z");
    assert_eq!(
        first.expires_at.as_deref(),
        Some("2026-09-12T00:30:10.000Z")
    );
    assert_eq!(second.outcome, CacheWindowOutcome::Expired);
}

#[test]
fn queued_prompts_in_one_interaction_are_not_windows() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        turn_end("00:00:10"),
        user("00:00:11", "i1"),
    ];
    assert!(build(&events).windows.is_empty());
}

#[test]
fn zero_ttl_means_no_prompt_cache() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:00:11", 0, None),
        user("02:00:00", "i2"),
    ];
    let timeline = build(&events);
    let window = &timeline.windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::NoCache);
    assert_eq!(window.expires_at, None);
    assert_eq!(timeline.summary.expired, 0);
    assert_eq!(timeline.summary.no_cache, 1);
}

#[test]
fn small_clock_skew_is_clamped() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        user("00:00:10", "i2"),
    ];
    assert_eq!(build(&events).windows[0].idle_seconds, Some(0));
}

#[test]
fn subagent_prompts_do_not_resume_the_main_cache() {
    let mut child = user("00:05:00", "child");
    child.raw.agent_id = Some("agent-1".into());
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        child,
        user("00:10:00", "i2"),
    ];
    let window = &build(&events).windows[0];
    assert_eq!(
        window.resume_at.as_deref(),
        Some("2026-09-12T00:10:00.000Z")
    );
    assert_eq!(window.resume_event_index, Some(4));
}

#[test]
fn a_later_checkpoint_supersedes_an_unanswered_one() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        checkpoint("00:04:00", 0, "00:34:00", 1800, None),
        user("00:31:00", "i2"),
    ];
    let timeline = build(&events);
    assert_eq!(timeline.windows.len(), 1);
    assert_eq!(timeline.windows[0].idle_start, "2026-09-12T00:04:00.000Z");
    assert_eq!(timeline.windows[0].outcome, CacheWindowOutcome::Warm);
}

#[test]
fn system_resumes_record_their_source() {
    let mut notification = user("00:10:00", "i2");
    notification.raw.data["source"] = json!("system");
    let (typed, _) = crate::parsing::events::typed_data_from_raw(
        &notification.event_type,
        &notification.raw.data,
    );
    notification.typed_data = typed;
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        notification,
    ];
    assert_eq!(
        build(&events).windows[0].resume_source.as_deref(),
        Some("system")
    );
}

#[test]
fn sessions_without_model_calls_have_nothing() {
    let timeline = build(&[start(MODEL), user("00:00:01", "i1")]);
    assert_eq!(timeline.source, PromptCacheSource::None);
    assert!(timeline.windows.is_empty());
    assert_eq!(timeline.summary, PromptCacheSummary::default());
}

#[test]
fn median_uses_the_upper_middle_value() {
    assert_eq!(super::super::outcome::median(&mut []), None);
    assert_eq!(super::super::outcome::median(&mut [5]), Some(5));
    assert_eq!(super::super::outcome::median(&mut [9, 1]), Some(9));
    assert_eq!(super::super::outcome::median(&mut [3, 1, 2]), Some(2));
}

#[test]
fn an_agent_wake_without_a_prompt_resumes_the_window() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 100, "00:30:00", 1800, None),
        event(
            "assistant.turn_start",
            "00:45:00",
            json!({"turnId": "3", "interactionId": "i1"}),
        ),
        checkpoint("00:45:30", 400, "01:15:00", 1800, None),
    ];
    let timeline = build(&events);
    let window = &timeline.windows[0];
    assert_eq!(window.outcome, CacheWindowOutcome::Expired);
    assert_eq!(window.resume_source.as_deref(), Some("agent"));
    assert_eq!(window.resume_event_index, Some(3));
    assert_eq!(window.interaction_nano_aiu, Some(300));
    assert_eq!(timeline.windows.len(), 2);
}
