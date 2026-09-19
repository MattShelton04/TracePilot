use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::*;
use crate::parsing::events::TypedEvent;
use crate::testing::make_typed_event;

const MODEL: &str = "gpt-5.6-luna";

fn at(time: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&format!("2026-09-12T{time}Z"))
        .unwrap()
        .with_timezone(&Utc)
}

fn event(event_type: &str, time: &str, data: Value) -> TypedEvent {
    let mut event = make_typed_event(event_type, data);
    event.raw.timestamp = Some(at(time));
    event
}

fn start(model: &str) -> TypedEvent {
    event(
        "session.start",
        "00:00:00",
        json!({"copilotVersion": "1.0.83", "selectedModel": model, "reasoningEffort": "high"}),
    )
}

fn user(time: &str, interaction: &str) -> TypedEvent {
    event(
        "user.message",
        time,
        json!({"content": "hi", "interactionId": interaction}),
    )
}

fn turn_end(time: &str) -> TypedEvent {
    event("assistant.turn_end", time, json!({"turnId": "0"}))
}

fn tools(names: &[(&str, &str, bool)]) -> Value {
    Value::Array(
        names
            .iter()
            .map(|(name, hash, safe)| json!({"name": name, "schema_hash": hash, "safe": safe}))
            .collect(),
    )
}

fn default_tools() -> Value {
    tools(&[("view", "aaa", true), ("powershell", "bbb", true)])
}

fn baseline(effort: &str, tools: Value, messages: u64, hashes: &[&str]) -> Value {
    json!({
        "model": MODEL,
        "reasoning_effort": effort,
        "initiator": "agent",
        "tools": tools,
        "system_segments": [
            {"segment": "identity", "hash": "id1", "tokens": 700},
            {"segment": "environment_context", "hash": "env1", "tokens": 100}
        ],
        "conversation": {
            "message_count": messages,
            "points": hashes.iter().enumerate()
                .map(|(i, h)| json!({"index": i, "hash": h}))
                .collect::<Vec<_>>()
        },
        "cache_config": {"arm": "control"},
        "prompt_tokens": 20_003,
        "frontier_tokens": 20_000,
        "ttl_seconds": 1800,
    })
}

fn checkpoint(time: &str, nano: u64, expires: &str, ttl: u64, base: Option<Value>) -> TypedEvent {
    let mut data = json!({
        "totalNanoAiu": nano,
        "modelCacheState": [{
            "modelId": MODEL,
            "cacheExpiresAt": format!("2026-09-12T{expires}Z"),
            "cacheTtlSeconds": ttl
        }]
    });
    if let Some(base) = base {
        data["promptCacheBreakState"] = json!([{"conversation": "main", "models": {MODEL: base}}]);
    }
    event("session.usage_checkpoint", time, data)
}

fn no_registry(_: &str) -> Option<u64> {
    None
}

fn build(events: &[TypedEvent]) -> PromptCacheTimeline {
    build_prompt_cache_timeline(events, no_registry)
}

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
fn tool_changes_are_reported_with_unsafe_names_redacted() {
    let before = baseline("high", default_tools(), 2, &["a", "b"]);
    let after = baseline(
        "high",
        tools(&[
            ("view", "aaa", true),
            ("powershell", "ccc", true),
            ("web_fetch", "ddd", true),
            ("secret-mcp-tool", "eee", false),
        ]),
        4,
        &["a", "b", "c", "d"],
    );
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, Some(before)),
        user("00:01:00", "i2"),
        checkpoint("00:01:30", 0, "00:31:00", 1800, Some(after)),
    ];
    let timeline = build(&events);
    let changes = &timeline.windows[0].prefix_changes;
    assert_eq!(timeline.summary.likely_breaks, 1);
    let added = changes
        .iter()
        .find(|c| c.kind == PrefixChangeKind::Tools)
        .unwrap();
    assert_eq!(added.summary, "+2 tools");
    assert_eq!(added.details, vec!["+ web_fetch", "+ custom tool"]);
    assert!(!added.details.iter().any(|d| d.contains("secret")));
    let redefined = changes
        .iter()
        .find(|c| c.kind == PrefixChangeKind::ToolDefinition)
        .unwrap();
    assert_eq!(redefined.details, vec!["powershell"]);
}

#[test]
fn effort_change_is_detected_from_baselines() {
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
        user("00:01:00", "i2"),
        checkpoint(
            "00:01:30",
            0,
            "00:31:00",
            1800,
            Some(baseline("xhigh", default_tools(), 4, &["a", "b", "c", "d"])),
        ),
    ];
    let changes = &build(&events).windows[0].prefix_changes;
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].kind, PrefixChangeKind::Effort);
    assert_eq!(changes[0].summary, "Effort high → xhigh");
}

#[test]
fn effort_change_is_detected_from_events_without_baselines() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, None),
        event(
            "session.model_change",
            "00:00:30",
            json!({"newModel": MODEL, "previousModel": MODEL, "reasoningEffort": "low"}),
        ),
        user("00:01:00", "i2"),
    ];
    let window = &build(&events).windows[0];
    assert_eq!(window.prefix_changes[0].summary, "Effort high → low");
    // Same model, so the predicted expiry still applies.
    assert_eq!(window.outcome, CacheWindowOutcome::Warm);
}

#[test]
fn compaction_between_baselines_explains_the_history_rewrite() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint(
            "00:00:11",
            0,
            "00:30:00",
            1800,
            Some(baseline("high", default_tools(), 4, &["a", "b", "c", "d"])),
        ),
        user("00:01:00", "i2"),
        event(
            "session.compaction_complete",
            "00:01:10",
            json!({"success": true}),
        ),
        checkpoint(
            "00:01:30",
            0,
            "00:31:00",
            1800,
            Some(baseline("high", default_tools(), 3, &["a", "x", "y"])),
        ),
    ];
    let changes = &build(&events).windows[0].prefix_changes;
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].kind, PrefixChangeKind::History);
    assert_eq!(
        changes[0].summary,
        "History rewritten at message 1 (compaction)"
    );
    assert_eq!(changes[0].details, vec!["compaction"]);
}

#[test]
fn history_rewrite_without_a_known_cause_is_still_reported() {
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint(
            "00:00:11",
            0,
            "00:30:00",
            1800,
            Some(baseline("high", default_tools(), 3, &["a", "b", "c"])),
        ),
        user("00:01:00", "i2"),
        checkpoint(
            "00:01:30",
            0,
            "00:31:00",
            1800,
            Some(baseline(
                "high",
                default_tools(),
                5,
                &["a", "B", "C", "d", "e"],
            )),
        ),
    ];
    let changes = &build(&events).windows[0].prefix_changes;
    assert_eq!(changes[0].summary, "History rewritten at message 1");
    assert!(changes[0].details.is_empty());
}

#[test]
fn appending_messages_is_not_a_prefix_change() {
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
        user("00:01:00", "i2"),
        checkpoint(
            "00:01:30",
            0,
            "00:31:00",
            1800,
            Some(baseline("high", default_tools(), 4, &["a", "b", "c", "d"])),
        ),
    ];
    assert!(build(&events).windows[0].prefix_changes.is_empty());
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
                    {"modelId": MODEL, "cacheExpiresAt": "2026-09-12T00:30:00Z", "cacheTtlSeconds": 1800},
                    {"modelId": "other", "cacheTtlSeconds": "not-a-number"}
                ]
            }),
        ),
        user("00:10:00", "i2"),
    ];
    assert!(matches!(
        events[2].typed_data,
        crate::parsing::events::TypedEventData::Other(_)
    ));
    let timeline = build(&events);
    assert_eq!(timeline.checkpoint_count, 1);
    assert_eq!(timeline.malformed_entry_count, 1);
    assert_eq!(timeline.windows[0].outcome, CacheWindowOutcome::Warm);
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
fn baseline_parser_keeps_conversations_and_ignores_unknown_fields() {
    let parsed = parse_baselines(&[json!({
        "conversation": "agent-x",
        "models": {MODEL: {"prompt_tokens": 12.0, "future_field": {"a": 1}}}
    })]);
    assert_eq!(parsed.malformed, 0);
    assert_eq!(parsed.baselines[0].conversation, "agent-x");
    assert_eq!(parsed.baselines[0].model, MODEL);
    assert_eq!(parsed.baselines[0].prompt_tokens, Some(12));
}

#[test]
fn median_uses_the_upper_middle_value() {
    assert_eq!(builder::median(&mut []), None);
    assert_eq!(builder::median(&mut [5]), Some(5));
    assert_eq!(builder::median(&mut [9, 1]), Some(9));
    assert_eq!(builder::median(&mut [3, 1, 2]), Some(2));
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

#[test]
fn cache_config_changes_list_the_changed_keys() {
    let before = baseline("high", default_tools(), 2, &["a", "b"]);
    let mut after = baseline("high", default_tools(), 4, &["a", "b", "c", "d"]);
    after["cache_config"] = json!({"arm": "treatment"});
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, Some(before)),
        user("00:01:00", "i2"),
        checkpoint("00:01:30", 0, "00:31:00", 1800, Some(after)),
    ];
    let change = &build(&events).windows[0].prefix_changes[0];
    assert_eq!(change.kind, PrefixChangeKind::CacheConfig);
    assert_eq!(change.details, vec![r#"arm: "control" → "treatment""#]);
}
