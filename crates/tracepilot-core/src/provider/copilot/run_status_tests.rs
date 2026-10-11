use std::path::Path;

use serde_json::{Value, json};

use super::run_status;
use crate::provider::RunStatus::{self, Busy, Waiting};

fn event(kind: &str, data: Value) -> Value {
    json!({ "type": kind, "data": data, "id": "e", "timestamp": "2026-01-01T00:00:00.000Z" })
}

fn write(path: &Path, events: &[Value]) {
    let mut text = String::new();
    for event in events {
        text.push_str(&event.to_string());
        text.push('\n');
    }
    std::fs::write(path, text).unwrap();
}

fn status_of(events: &[Value]) -> Option<RunStatus> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    write(&path, events);
    run_status(&path)
}

fn start() -> Value {
    event("session.start", json!({ "sessionId": "s" }))
}
fn user() -> Value {
    event("user.message", json!({ "content": "synthetic" }))
}
fn turn_start() -> Value {
    event("assistant.turn_start", json!({ "turnId": "0" }))
}
fn turn_end() -> Value {
    event("assistant.turn_end", json!({ "turnId": "0" }))
}
fn reply() -> Value {
    event(
        "assistant.message",
        json!({ "messageId": "m", "content": "done", "toolRequests": [] }),
    )
}
fn calls(id: &str, name: &str) -> Value {
    event(
        "assistant.message",
        json!({ "messageId": "m", "content": "", "toolRequests": [{ "toolCallId": id, "name": name }] }),
    )
}
fn tool_start(id: &str, name: &str) -> Value {
    event(
        "tool.execution_start",
        json!({ "toolCallId": id, "toolName": name, "arguments": {} }),
    )
}
fn tool_done(id: &str) -> Value {
    event(
        "tool.execution_complete",
        json!({ "toolCallId": id, "success": true }),
    )
}

/// One finished exchange: a prompt, a tool turn, and a final reply.
fn finished_exchange() -> Vec<Value> {
    vec![
        start(),
        user(),
        turn_start(),
        calls("t1", "view"),
        tool_start("t1", "view"),
        tool_done("t1"),
        turn_end(),
        turn_start(),
        reply(),
        turn_end(),
    ]
}

#[test]
fn final_reply_waits_for_the_user() {
    assert_eq!(status_of(&finished_exchange()), Some(Waiting));
}

#[test]
fn informational_events_after_the_reply_keep_waiting() {
    let mut events = finished_exchange();
    events.extend([
        event("session.usage_checkpoint", json!({})),
        event("session.compaction_complete", json!({ "success": true })),
        event(
            "hook.start",
            json!({ "hookInvocationId": "h", "hookType": "sessionEnd" }),
        ),
        event(
            "hook.end",
            json!({ "hookInvocationId": "h", "success": true }),
        ),
        event("session.some_future_event", json!({})),
    ]);
    assert_eq!(status_of(&events), Some(Waiting));
}

#[test]
fn a_turn_that_requested_tools_is_still_busy() {
    let events = [
        start(),
        user(),
        turn_start(),
        calls("t1", "powershell"),
        tool_start("t1", "powershell"),
        tool_done("t1"),
        turn_end(),
    ];
    assert_eq!(status_of(&events), Some(Busy));
}

#[test]
fn running_a_tool_is_busy() {
    let events = [
        start(),
        user(),
        turn_start(),
        calls("t1", "powershell"),
        tool_start("t1", "powershell"),
        event(
            "hook.start",
            json!({ "hookInvocationId": "h", "hookType": "preToolUse" }),
        ),
        event(
            "hook.end",
            json!({ "hookInvocationId": "h", "success": true }),
        ),
    ];
    assert_eq!(status_of(&events), Some(Busy));
}

#[test]
fn a_new_prompt_after_a_reply_is_busy() {
    let mut events = finished_exchange();
    events.push(event("system.message", json!({ "content": "synthetic" })));
    assert_eq!(status_of(&events), Some(Busy));
    events.push(user());
    assert_eq!(status_of(&events), Some(Busy));
}

#[test]
fn background_work_after_the_reply_is_busy() {
    let mut events = finished_exchange();
    events.push(event(
        "assistant.message",
        json!({ "messageId": "s", "content": "", "toolRequests": [], "parentToolCallId": "bg" }),
    ));
    assert_eq!(status_of(&events), Some(Busy));

    let mut events = finished_exchange();
    events.push(event(
        "system.notification",
        json!({ "content": "synthetic", "kind": { "type": "agent_completed" } }),
    ));
    assert_eq!(status_of(&events), Some(Busy));
}

#[test]
fn a_subagent_reply_does_not_end_the_main_turn() {
    let events = [
        start(),
        user(),
        turn_start(),
        calls("t1", "task"),
        tool_start("t1", "task"),
        event(
            "assistant.message",
            json!({ "messageId": "s", "content": "", "toolRequests": [], "parentToolCallId": "t1" }),
        ),
        tool_done("t1"),
        turn_end(),
    ];
    assert_eq!(status_of(&events), Some(Busy));
}

#[test]
fn an_open_ask_user_call_waits() {
    let events = [
        start(),
        user(),
        turn_start(),
        calls("t1", "ask_user"),
        tool_start("t1", "ask_user"),
    ];
    assert_eq!(status_of(&events), Some(Waiting));

    let mut answered = events.to_vec();
    answered.push(tool_done("t1"));
    assert_eq!(status_of(&answered), Some(Busy));
}

#[test]
fn an_open_permission_request_waits() {
    let requested = event(
        "permission.requested",
        json!({ "requestId": "p1", "permissionRequest": {}, "promptRequest": { "kind": "commands" } }),
    );
    let mut events = vec![
        start(),
        user(),
        turn_start(),
        calls("t1", "powershell"),
        tool_start("t1", "powershell"),
        requested,
    ];
    assert_eq!(status_of(&events), Some(Waiting));

    events.push(event(
        "permission.completed",
        json!({ "requestId": "p1", "toolCallId": "t1", "result": { "kind": "approved" } }),
    ));
    assert_eq!(status_of(&events), Some(Busy));
}

#[test]
fn abort_returns_to_the_prompt_and_drops_open_calls() {
    let events = [
        start(),
        user(),
        turn_start(),
        calls("t1", "powershell"),
        tool_start("t1", "powershell"),
        event("abort", json!({ "reason": "user initiated" })),
    ];
    assert_eq!(status_of(&events), Some(Waiting));

    // An ask_user abandoned by an interrupt no longer blocks.
    let events = [
        start(),
        user(),
        turn_start(),
        tool_start("t1", "ask_user"),
        event("abort", json!({ "reason": "user initiated" })),
        user(),
    ];
    assert_eq!(status_of(&events), Some(Busy));
}

#[test]
fn an_error_ends_the_loop() {
    let events = [
        start(),
        user(),
        turn_start(),
        calls("t1", "view"),
        tool_start("t1", "view"),
        tool_done("t1"),
        turn_end(),
        event(
            "session.error",
            json!({ "errorType": "api", "message": "synthetic" }),
        ),
    ];
    assert_eq!(status_of(&events), Some(Waiting));
}

#[test]
fn a_fresh_or_resumed_session_waits_for_its_first_prompt() {
    assert_eq!(
        status_of(&[start(), event("session.model_change", json!({}))]),
        Some(Waiting)
    );
    let mut events = finished_exchange();
    events.push(event("session.shutdown", json!({})));
    assert_eq!(status_of(&events), None);
    events.push(event("session.resume", json!({ "eventCount": 11 })));
    assert_eq!(status_of(&events), Some(Waiting));
}

#[test]
fn unknown_tails_report_no_status() {
    assert_eq!(status_of(&[]), None);
    assert_eq!(status_of(&[event("session.info", json!({}))]), None);
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(run_status(&dir.path().join("events.jsonl")), None);
}

#[test]
fn partial_lines_are_skipped() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    write(&path, &finished_exchange());
    // A line the CLI is still writing.
    let mut text = std::fs::read_to_string(&path).unwrap();
    text.push_str(r#"{"type":"user.mess"#);
    std::fs::write(&path, text).unwrap();
    assert_eq!(run_status(&path), Some(Waiting));
}

#[test]
fn a_large_last_record_reads_a_wider_tail() {
    let mut events = finished_exchange();
    events.truncate(events.len() - 2);
    events.push(reply());
    // One record bigger than the first window: only the wider read sees the
    // reply before it.
    events.push(event(
        "session.info",
        json!({ "message": "x".repeat(200 * 1024) }),
    ));
    events.push(turn_end());
    assert_eq!(status_of(&events), Some(Waiting));

    let mut huge = finished_exchange();
    huge.push(event(
        "session.info",
        json!({ "message": "x".repeat(200 * 1024) }),
    ));
    assert_eq!(status_of(&huge), Some(Waiting));
}

#[test]
fn a_missing_completion_does_not_outlive_its_turn() {
    // The ask_user call never records a completion, but the agent moved on.
    let mut events = vec![
        start(),
        user(),
        turn_start(),
        calls("t1", "ask_user"),
        tool_start("t1", "ask_user"),
        turn_end(),
        turn_start(),
        calls("t2", "view"),
        tool_start("t2", "view"),
    ];
    assert_eq!(status_of(&events), Some(Busy));
    events.extend([
        tool_done("t2"),
        turn_end(),
        turn_start(),
        reply(),
        turn_end(),
    ]);
    assert_eq!(status_of(&events), Some(Waiting));
}

#[test]
fn background_subagents_do_not_hide_a_question() {
    let events = [
        start(),
        user(),
        turn_start(),
        calls("t1", "ask_user"),
        tool_start("t1", "ask_user"),
        event(
            "tool.execution_start",
            json!({ "toolCallId": "s1", "toolName": "view", "parentToolCallId": "bg" }),
        ),
    ];
    assert_eq!(status_of(&events), Some(Waiting));
}
