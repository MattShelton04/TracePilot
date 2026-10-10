//! Background shells settle on the call that started them, from the
//! `system.notification` shapes Copilot CLI and the Claude Code provider write.

use super::*;
use crate::models::conversation::BackgroundOutcome;
use crate::parsing::events::typed_data_from_raw;

fn ev(value: Value) -> TypedEvent {
    let raw: RawEvent = serde_json::from_value(value).unwrap();
    let event_type = SessionEventType::parse_wire(&raw.event_type);
    let (typed_data, _) = typed_data_from_raw(&event_type, &raw.data);
    TypedEvent {
        raw,
        event_type,
        typed_data,
    }
}

fn at(second: u32) -> String {
    format!("2026-10-04T08:10:{second:02}.000Z")
}

fn user(second: u32, text: &str) -> TypedEvent {
    ev(json!({"type": "user.message", "timestamp": at(second), "data": {"content": text}}))
}

fn start(second: u32, id: &str, tool: &str, args: Value) -> TypedEvent {
    ev(
        json!({"type": "tool.execution_start", "timestamp": at(second),
        "data": {"toolCallId": id, "toolName": tool, "arguments": args}}),
    )
}

fn complete(second: u32, id: &str, content: &str) -> TypedEvent {
    ev(
        json!({"type": "tool.execution_complete", "timestamp": at(second),
        "data": {"toolCallId": id, "success": true, "result": {"content": content}}}),
    )
}

fn notification(second: u32, kind: Value) -> TypedEvent {
    ev(
        json!({"type": "system.notification", "timestamp": at(second),
        "data": {"content": "<system_notification>shell done</system_notification>", "kind": kind}}),
    )
}

fn outcome(turns: &[ConversationTurn], id: &str) -> Option<BackgroundOutcome> {
    let call = turns
        .iter()
        .flat_map(|t| &t.tool_calls)
        .find(|tc| tc.tool_call_id.as_deref() == Some(id))
        .unwrap();
    call.background_outcome.clone()
}

fn settled(status: &str, exit_code: Option<i64>, second: u32) -> Option<BackgroundOutcome> {
    Some(BackgroundOutcome {
        status: status.into(),
        exit_code,
        completed_at: Some(at(second).parse().unwrap()),
    })
}

#[test]
fn copilot_async_detached_and_timed_out_shells_settle_inline() {
    let events = vec![
        user(0, "Build and serve"),
        start(
            1,
            "async",
            "powershell",
            json!({"command": "npm run build", "description": "Build", "mode": "async", "shellId": "build"}),
        ),
        complete(
            2,
            "async",
            "<command started in background with shellId: build>",
        ),
        start(
            3,
            "detached",
            "powershell",
            json!({"command": "npm run serve", "description": "Serve", "mode": "async", "detach": true}),
        ),
        complete(
            4,
            "detached",
            "<command started in detached background with shellId: 12>",
        ),
        start(
            5,
            "slow",
            "powershell",
            json!({"command": "npm test", "description": "Test", "initial_wait": 30}),
        ),
        complete(
            6,
            "slow",
            "running\n<command with shellId: 13 is still running after 30 seconds. The command is still running. Use read_powershell to continue waiting for output, or stop_powershell to stop it.>",
        ),
        start(
            7,
            "sync",
            "powershell",
            json!({"command": "git status", "description": "Status", "shellId": "14"}),
        ),
        complete(8, "sync", "clean\n<shellId: 14 completed with exit code 0>"),
        notification(
            9,
            json!({"type": "shell_completed", "shellId": "build", "exitCode": 0, "description": "Build"}),
        ),
        notification(
            10,
            json!({"type": "shell_completed", "shellId": "13", "exitCode": 1, "description": "Test"}),
        ),
        notification(
            11,
            json!({"type": "shell_detached_completed", "shellId": "12", "description": "Serve"}),
        ),
        // No running launch owns these: ignored.
        notification(
            12,
            json!({"type": "shell_completed", "shellId": "14", "exitCode": 0}),
        ),
        notification(
            13,
            json!({"type": "shell_completed", "shellId": "nobody", "exitCode": 0}),
        ),
        notification(
            14,
            json!({"type": "agent_completed", "agentId": "build", "status": "completed"}),
        ),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1, "notifications open no turn");
    assert_eq!(outcome(&turns, "async"), settled("completed", Some(0), 9));
    assert_eq!(outcome(&turns, "slow"), settled("completed", Some(1), 10));
    assert_eq!(outcome(&turns, "detached"), settled("completed", None, 11));
    assert_eq!(outcome(&turns, "sync"), None);

    // The launch itself is unchanged.
    let launch = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("async"))
        .unwrap();
    assert!(launch.is_complete);
    assert_eq!(launch.success, Some(true));
    assert_eq!(launch.exit_code, None);
}

#[test]
fn a_reused_shell_id_settles_its_latest_launch_once() {
    let events = vec![
        user(0, "Run twice"),
        start(
            1,
            "first",
            "powershell",
            json!({"command": "a", "mode": "async", "shellId": "w"}),
        ),
        complete(
            2,
            "first",
            "<command started in background with shellId: w>",
        ),
        notification(
            3,
            json!({"type": "shell_completed", "shellId": "w", "exitCode": 0}),
        ),
        start(
            4,
            "second",
            "powershell",
            json!({"command": "b", "mode": "async", "shellId": "w"}),
        ),
        complete(
            5,
            "second",
            "<command started in background with shellId: w>",
        ),
        notification(
            6,
            json!({"type": "shell_completed", "shellId": "w", "exitCode": 2}),
        ),
        // A repeat with nothing running under the id changes nothing.
        notification(
            7,
            json!({"type": "shell_completed", "shellId": "w", "exitCode": 0}),
        ),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(outcome(&turns, "first"), settled("completed", Some(0), 3));
    assert_eq!(outcome(&turns, "second"), settled("completed", Some(2), 6));
}

#[test]
fn claude_shells_settle_across_turns_with_their_reported_status() {
    // The Claude Code provider copies `backgroundTaskId` into `shellId` and
    // writes the notification's status and parsed exit code.
    let bg = |id: &str| json!({"command": "cargo test", "mode": "background", "shellId": id});
    let events = vec![
        user(0, "Start the suites"),
        start(1, "ok", "shell", bg("b1")),
        complete(2, "ok", "Command running in background with ID: b1"),
        start(3, "bad", "shell", bg("b2")),
        complete(4, "bad", "Command running in background with ID: b2"),
        start(5, "killed", "powershell", bg("b3")),
        complete(6, "killed", "Command running in background with ID: b3"),
        start(7, "still", "shell", bg("b4")),
        complete(8, "still", "Command running in background with ID: b4"),
        user(9, "Next question"),
        notification(
            10,
            json!({"type": "shell_completed", "shellId": "b1", "status": "completed", "exitCode": 0}),
        ),
        notification(
            11,
            json!({"type": "shell_completed", "shellId": "b2", "status": "failed", "exitCode": null}),
        ),
        notification(
            12,
            json!({"type": "shell_completed", "shellId": "b3", "status": "killed", "exitCode": null}),
        ),
        notification(
            13,
            json!({"type": "shell_completed", "shellId": "b4", "status": "running"}),
        ),
        notification(
            14,
            json!({"type": "shell_completed", "shellId": "b9", "status": "completed", "exitCode": 0}),
        ),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 2);
    assert_eq!(outcome(&turns, "ok"), settled("completed", Some(0), 10));
    assert_eq!(outcome(&turns, "bad"), settled("failed", None, 11));
    assert_eq!(outcome(&turns, "killed"), settled("stopped", None, 12));
    assert_eq!(
        outcome(&turns, "still"),
        None,
        "a running report is not an outcome"
    );
}

#[test]
fn a_completion_before_any_launch_is_ignored() {
    let events = vec![
        user(0, "Hi"),
        notification(
            1,
            json!({"type": "shell_completed", "shellId": "b1", "status": "completed", "exitCode": 0}),
        ),
        start(
            2,
            "late",
            "shell",
            json!({"command": "x", "mode": "background", "shellId": "b1"}),
        ),
        complete(3, "late", "Command running in background with ID: b1"),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(outcome(&turns, "late"), None);
}

#[test]
fn an_outcome_is_serialized_only_when_present() {
    let events = vec![
        user(0, "Hi"),
        start(
            1,
            "a",
            "shell",
            json!({"command": "x", "mode": "background", "shellId": "b1"}),
        ),
        complete(2, "a", "started"),
        start(3, "b", "shell", json!({"command": "y"})),
        complete(4, "b", "ok"),
        notification(
            5,
            json!({"type": "shell_completed", "shellId": "b1", "status": "completed", "exitCode": 0}),
        ),
    ];
    let turns = reconstruct_turns(&events);
    let json = serde_json::to_value(&turns[0].tool_calls).unwrap();
    assert_eq!(
        json[0]["backgroundOutcome"],
        json!({"status": "completed", "exitCode": 0, "completedAt": "2026-10-04T08:10:05Z"})
    );
    assert!(json[1].get("backgroundOutcome").is_none());
}
