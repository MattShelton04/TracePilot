//! Markdown tests for what a turn shows: failed tool calls' errors, where its
//! session events go, and the Events Summary's order.

use super::MarkdownRenderer;
use super::tests::{fence_states, is_fenced};
use crate::document::*;
use crate::render::ExportRenderer;
use crate::test_helpers::{minimal_session, simple_turn, test_archive};

fn failed_edit(error: &str) -> TurnToolCall {
    let mut edit = crate::test_helpers::simple_tool_call("edit", Some(false), false);
    edit.error = Some(error.into());
    edit
}

fn render_turn(turn: ConversationTurn) -> String {
    let mut session = minimal_session();
    session.conversation = Some(vec![turn]);
    let files = MarkdownRenderer.render(&test_archive(session)).unwrap();
    files[0].as_text().unwrap().to_string()
}

#[test]
fn failed_tool_calls_show_their_error() {
    // With arguments, as an export with tool details has them.
    let mut with_args = failed_edit("No match found for old_str in src/app.rs");
    with_args.arguments = Some(serde_json::json!({"path": "src/app.rs"}));
    // Without arguments or a result, as an export without tool details has
    // them: the error is all there is to show.
    let bare = failed_edit("Permission denied: rm -rf build");
    // A tool that succeeded or reported no text writes no error block.
    let mut passed = crate::test_helpers::simple_tool_call("view", Some(true), false);
    passed.error = Some("stale warning".into());
    let silent = failed_edit("   ");
    let mut turn = simple_turn(0, "Fix it", "Trying", None);
    turn.tool_calls = vec![with_args, bare, passed, silent];

    let text = render_turn(turn);

    assert!(
        text.contains("**Arguments:**\n\n```json\n{\"path\":\"src/app.rs\"}\n```\n\n**Error:**\n\n```\nNo match found for old_str in src/app.rs\n```\n"),
        "{text}"
    );
    assert!(
        text.contains("#### 🔧 edit\n\n**Error:**\n\n```\nPermission denied: rm -rf build\n```\n"),
        "{text}"
    );
    assert_eq!(text.matches("**Error:**").count(), 2, "{text}");
    assert!(!text.contains("stale warning"), "{text}");
    assert!(!text.contains("#### 🔧 view"), "{text}");
}

#[test]
fn long_or_fenced_errors_are_cut_and_stay_in_their_block() {
    let long = format!("Command failed\n{}", "é".repeat(3_000));
    let fenced = "Parse error near:\n```\n## not a heading\n";
    let mut turn = simple_turn(0, "Run", "Ran", None);
    turn.tool_calls = vec![failed_edit(&long), failed_edit(fenced)];

    let text = render_turn(turn);

    let block = text.split("**Error:**").nth(1).unwrap();
    assert!(block.contains("Command failed"), "{text}");
    assert!(
        block.len() < 2_200,
        "error was not truncated: {} bytes",
        block.len()
    );
    assert!(
        block.contains(&format!(
            "… (truncated: 1999 of {} bytes shown)",
            long.len()
        )),
        "{block}"
    );
    assert!(is_fenced(&text, "## not a heading"), "{text}");
    assert!(!fence_states(&text).1, "a fence is left open:\n{text}");
}

#[test]
fn session_events_before_the_turn_come_before_its_work() {
    use chrono::TimeZone;
    let at = |secs: i64| chrono::Utc.timestamp_opt(1_700_000_000 + secs, 0).single();
    let event = |event_type: &str, summary: &str, timestamp| TurnSessionEvent {
        event_type: event_type.into(),
        timestamp,
        severity: SessionEventSeverity::Info,
        summary: summary.into(),
        checkpoint_number: None,
        request_id: None,
        tool_call_id: None,
        prompt_kind: None,
        result_kind: None,
        resolved_by_hook: None,
        skill_invocation: None,
    };
    let mut turn = simple_turn(0, "Ship it", "Shipping", None);
    turn.timestamp = at(10);
    turn.tool_calls = vec![crate::test_helpers::simple_tool_call(
        "bash",
        Some(true),
        false,
    )];
    // In log order: events buffered before the message lead the list. A
    // synthesized `session.start` (Claude Code) shares the message's instant.
    turn.session_events = vec![
        event("session.start", "Session started", at(0)),
        event("session.resume", "Same instant, before", at(10)),
        event("session.compaction_complete", "Compacted", at(20)),
        event("session.info", "Undated", None),
        event("session.mode_changed", "Same instant, during", at(10)),
    ];

    let text = render_turn(turn);

    let pos = |needle: &str| {
        text.find(needle)
            .unwrap_or_else(|| panic!("{needle:?} missing:\n{text}"))
    };
    assert!(
        pos("**session.start**") < pos("**session.resume**"),
        "{text}"
    );
    assert!(pos("**session.resume**") < pos("**User**"), "{text}");
    assert!(
        pos("**Tool Calls**") < pos("**session.compaction_complete**"),
        "{text}"
    );
    assert!(pos("**Tool Calls**") < pos("**session.info**"), "{text}");
    assert!(
        pos("**Tool Calls**") < pos("**session.mode_changed**"),
        "{text}"
    );
    assert_eq!(text.matches("**session.start**").count(), 1, "{text}");
}

#[test]
fn events_summary_orders_ties_by_name() {
    let raw = |event_type: &str| RawEvent {
        event_type: event_type.into(),
        data: serde_json::json!({}),
        id: None,
        timestamp: None,
        parent_id: None,
        agent_id: None,
        native: None,
    };
    let mut session = minimal_session();
    session.events = Some(
        [
            "tool.b",
            "tool.c",
            "user.message",
            "tool.a",
            "tool.c",
            "tool.b",
        ]
        .into_iter()
        .map(raw)
        .collect(),
    );

    let files = MarkdownRenderer.render(&test_archive(session)).unwrap();
    let text = files[0].as_text().unwrap();

    let rows: Vec<&str> = text
        .lines()
        .filter(|line| line.starts_with("| `"))
        .collect();
    assert_eq!(
        rows,
        [
            "| `tool.b` | 2 |",
            "| `tool.c` | 2 |",
            "| `tool.a` | 1 |",
            "| `user.message` | 1 |",
        ]
    );
}
