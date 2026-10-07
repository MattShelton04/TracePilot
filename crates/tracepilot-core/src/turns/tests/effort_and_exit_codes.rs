//! Reasoning effort, shell exit codes and user-message origin, reconstructed
//! from event shapes recorded by Copilot CLI 1.0.91.

use super::*;
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

fn user(second: u32, id: &str, delivery: &str) -> TypedEvent {
    ev(json!({
        "type": "user.message",
        "timestamp": at(second),
        "data": { "content": format!("message {id}"), "messageId": id, "delivery": delivery },
    }))
}

fn turn_start(second: u32, turn_id: &str) -> TypedEvent {
    ev(
        json!({ "type": "assistant.turn_start", "timestamp": at(second), "data": { "turnId": turn_id } }),
    )
}

fn turn_end(second: u32, turn_id: &str) -> TypedEvent {
    ev(
        json!({ "type": "assistant.turn_end", "timestamp": at(second), "data": { "turnId": turn_id } }),
    )
}

#[test]
fn shell_exit_codes_come_from_shell_execution_or_the_result_footer() {
    let events = vec![
        user(0, "m1", "idle"),
        turn_start(1, "0"),
        ev(json!({
            "type": "tool.execution_start",
            "data": { "toolCallId": "tc-1", "toolName": "powershell",
                      "arguments": { "command": "node -e \"process.exit(3)\"" } },
        })),
        ev(json!({
            "type": "tool.execution_complete",
            "data": { "toolCallId": "tc-1", "success": true, "shellExecution": { "exitCode": 3 },
                      "result": { "content": "\n<shellId: 0 completed with exit code 3>" } },
        })),
        // Older CLIs: only the footer records the code.
        ev(json!({
            "type": "tool.execution_start",
            "data": { "toolCallId": "tc-2", "toolName": "powershell",
                      "arguments": { "command": "git status" } },
        })),
        ev(json!({
            "type": "tool.execution_complete",
            "data": { "toolCallId": "tc-2", "success": true,
                      "result": { "content": "fatal: not a git repository\r\n<exited with exit code 128>\n" } },
        })),
        // The provider-neutral `shell` (Claude Code's Bash) parses the same footer.
        ev(json!({
            "type": "tool.execution_start",
            "data": { "toolCallId": "tc-4", "toolName": "shell",
                      "arguments": { "command": "make" } },
        })),
        ev(json!({
            "type": "tool.execution_complete",
            "data": { "toolCallId": "tc-4", "success": true,
                      "result": { "content": "make: done
        Process exited with code 2" } },
        })),
        ev(json!({
            "type": "tool.execution_start",
            "data": { "toolCallId": "tc-3", "toolName": "view", "arguments": { "path": "a.txt" } },
        })),
        ev(json!({
            "type": "tool.execution_complete",
            "data": { "toolCallId": "tc-3", "success": true,
                      "result": { "content": "<exited with exit code 1>" } },
        })),
        turn_end(2, "0"),
    ];
    let turns = reconstruct_turns(&events);
    let codes: Vec<_> = turns[0].tool_calls.iter().map(|tc| tc.exit_code).collect();
    // A non-zero exit is not a tool failure; `view` output is never parsed.
    assert_eq!(codes, vec![Some(3), Some(128), Some(2), None]);
    assert!(
        turns[0]
            .tool_calls
            .iter()
            .all(|tc| tc.success == Some(true))
    );
}

#[test]
fn each_agent_turn_records_the_effort_it_ran_at() {
    let events = vec![
        ev(
            json!({ "type": "session.start", "data": { "selectedModel": "gpt-5.6-luna", "reasoningEffort": "high" } }),
        ),
        user(0, "m1", "idle"),
        turn_start(1, "0"),
        turn_end(2, "0"),
        ev(json!({
            "type": "session.model_change",
            "data": { "newModel": "gpt-5.6-luna", "previousReasoningEffort": "high", "reasoningEffort": "xhigh" },
        })),
        user(3, "m2", "idle"),
        turn_start(4, "1"),
        turn_end(5, "1"),
    ];
    let turns = reconstruct_turns(&events);
    let efforts: Vec<_> = turns
        .iter()
        .map(|t| t.reasoning_effort.as_deref())
        .collect();
    assert_eq!(efforts, vec![Some("high"), Some("xhigh")]);
}

#[test]
fn steering_and_injected_messages_are_told_apart_from_typed_ones() {
    let events = vec![
        user(0, "p", "idle"),
        turn_start(1, "0"),
        // A deferred-tools reminder injected mid-turn (empty content).
        ev(json!({
            "type": "user.message",
            "timestamp": at(2),
            "data": { "content": "", "source": "system", "delivery": "steering" },
        })),
        turn_end(3, "0"),
        // A subagent finished while the main agent was idle.
        ev(json!({
            "type": "user.message",
            "timestamp": at(4),
            "data": { "content": "<system_notification> Agent \"agent-0\" has completed",
                      "source": "system", "delivery": "idle", "messageId": "sys-1" },
        })),
        turn_start(5, "1"),
        turn_end(6, "1"),
        // Logs from before `source` existed.
        ev(json!({
            "type": "user.message",
            "timestamp": at(7),
            "data": { "content": "<system_notification> Agent done" },
        })),
        turn_start(8, "2"),
        turn_end(9, "2"),
        user(10, "s", "steering"),
    ];
    let turns = reconstruct_turns(&events);
    let flags: Vec<_> = turns.iter().map(|t| t.system_initiated).collect();
    assert_eq!(flags, vec![false, true, true, true, false]);
    let last = turns.last().unwrap();
    assert_eq!(last.user_message_delivery.as_deref(), Some("steering"));
}
