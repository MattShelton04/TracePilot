use super::super::*;

#[test]
fn permission_events_attach_to_turn_with_audit_summaries() {
    let events = make_turn_events(vec![
        make_event(
            SessionEventType::PermissionRequested,
            TypedEventData::PermissionRequested(PermissionRequestedData {
                request_id: Some("req-1".to_string()),
                permission_request: None,
                prompt_request: Some(json!({
                    "kind": "commands",
                    "toolCallId": "tc-1",
                    "intention": "Run the validation command"
                })),
                resolved_by_hook: None,
            }),
            "evt-perm-req",
            "2026-05-04T08:00:10.000Z",
            None,
        ),
        make_event(
            SessionEventType::PermissionCompleted,
            TypedEventData::PermissionCompleted(PermissionCompletedData {
                request_id: Some("req-1".to_string()),
                tool_call_id: Some("tc-1".to_string()),
                result: Some(json!({ "kind": "approved-for-session" })),
            }),
            "evt-perm-done",
            "2026-05-04T08:00:11.000Z",
            None,
        ),
    ]);

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].session_events.len(), 2);
    assert_eq!(
        turns[0].session_events[0].event_type,
        "permission.requested"
    );
    assert_eq!(
        turns[0].session_events[0].summary,
        "Permission requested (commands): Run the validation command"
    );
    assert_eq!(
        turns[0].session_events[0].severity,
        SessionEventSeverity::Info
    );
    assert_eq!(
        turns[0].session_events[0].request_id.as_deref(),
        Some("req-1")
    );
    assert_eq!(
        turns[0].session_events[0].prompt_kind.as_deref(),
        Some("commands")
    );
    assert_eq!(
        turns[0].session_events[0].tool_call_id.as_deref(),
        Some("tc-1")
    );
    assert_eq!(
        turns[0].session_events[1].event_type,
        "permission.completed"
    );
    assert_eq!(
        turns[0].session_events[1].summary,
        "Permission result: approved-for-session"
    );
    assert_eq!(
        turns[0].session_events[1].severity,
        SessionEventSeverity::Info
    );
    assert_eq!(
        turns[0].session_events[1].request_id.as_deref(),
        Some("req-1")
    );
    assert_eq!(
        turns[0].session_events[1].result_kind.as_deref(),
        Some("approved-for-session")
    );
    assert_eq!(
        turns[0].session_events[1].tool_call_id.as_deref(),
        Some("tc-1")
    );
}

#[test]
fn rejected_permission_result_is_warning() {
    let events = make_turn_events(vec![make_event(
        SessionEventType::PermissionCompleted,
        TypedEventData::PermissionCompleted(PermissionCompletedData {
            request_id: Some("req-2".to_string()),
            tool_call_id: Some("tc-2".to_string()),
            result: Some(json!({
                "kind": "denied-interactively-by-user",
                "feedback": "Not now"
            })),
        }),
        "evt-perm-denied",
        "2026-05-04T08:00:11.000Z",
        None,
    )]);

    let turns = reconstruct_turns(&events);

    assert_eq!(
        turns[0].session_events[0].severity,
        SessionEventSeverity::Warning
    );
    assert_eq!(
        turns[0].session_events[0].summary,
        "Permission result: denied-interactively-by-user (Not now)"
    );
    assert_eq!(
        turns[0].session_events[0].result_kind.as_deref(),
        Some("denied-interactively-by-user")
    );
    assert_eq!(
        turns[0].session_events[0].request_id.as_deref(),
        Some("req-2")
    );
}

#[test]
fn external_tool_request_attaches_to_turn() {
    let events = make_turn_events(vec![make_event(
        SessionEventType::ExternalToolRequested,
        TypedEventData::ExternalToolRequested(ExternalToolRequestedData {
            request_id: Some("req-ext".to_string()),
            session_id: Some("session-1".to_string()),
            tool_call_id: Some("tc-ext".to_string()),
            tool_name: Some("external-ci".to_string()),
            arguments: None,
            traceparent: None,
            tracestate: None,
        }),
        "evt-ext",
        "2026-05-04T08:00:12.000Z",
        None,
    )]);

    let turns = reconstruct_turns(&events);

    assert_eq!(
        turns[0].session_events[0].event_type,
        "external_tool.requested"
    );
    assert_eq!(
        turns[0].session_events[0].summary,
        "External tool requested: external-ci"
    );
}
