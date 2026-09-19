//! Prefix-change detection across idle windows.

use serde_json::json;

use super::*;

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
fn compaction_while_idle_explains_the_history_rewrite() {
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
        event(
            "session.compaction_complete",
            "00:00:50",
            json!({"success": true}),
        ),
        user("00:01:00", "i2"),
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

#[test]
fn a_compaction_after_the_resume_is_not_blamed_for_it() {
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
    let timeline = build(&events);
    assert!(timeline.windows[0].prefix_changes.is_empty());
    assert_eq!(timeline.summary.likely_breaks, 0);
}

#[test]
fn per_request_cache_config_keys_are_ignored() {
    let mut before = baseline("high", default_tools(), 2, &["a", "b"]);
    before["cache_config"] = json!({"arm": "control", "incremental_input": true});
    let mut after = baseline("high", default_tools(), 4, &["a", "b", "c", "d"]);
    after["cache_config"] = json!({"arm": "control", "incremental_input": false});
    let events = vec![
        start(MODEL),
        user("00:00:01", "i1"),
        checkpoint("00:00:11", 0, "00:30:00", 1800, Some(before)),
        user("00:01:00", "i2"),
        checkpoint("00:01:30", 0, "00:31:00", 1800, Some(after)),
    ];
    assert!(build(&events).windows[0].prefix_changes.is_empty());
}
