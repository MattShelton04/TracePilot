//! Tool execution tests.
//!
//! Tests for tool call lifecycle, completion tracking, and result handling.
//!
//! ## Tests Included
//! - Orphaned tool call handling
//! - Tool execution completion
//! - Deduplication of tool starts
//! - Intention summary extraction
//! - Polymorphic result handling

use super::*;

#[test]
fn leaves_orphaned_tool_call_incomplete() {
    let events = vec![
        user_msg("Hello")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        tool_start("read_file")
            .tool_call_id("tc-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].tool_calls.len(), 1);
    assert!(!turns[0].tool_calls[0].is_complete);
    assert!(turns[0].tool_calls[0].completed_at.is_none());
}

#[test]
fn tool_exec_complete_finds_entry_in_finalized_turn() {
    // ToolExecutionComplete may also arrive after turn boundary
    let events = vec![
        user_msg("Do something")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T10:00:00.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T10:00:00.100Z")
            .parent("evt-1")
            .build_event(),
        tool_start("powershell")
            .tool_call_id("tc-slow")
            .arguments(json!({ "command": "sleep 300" }))
            .id("evt-3")
            .timestamp("2026-03-10T10:00:01.000Z")
            .parent("evt-2")
            .build_event(),
        // Turn ends before tool completes
        turn_end()
            .turn_id("turn-1")
            .id("evt-4")
            .timestamp("2026-03-10T10:00:02.000Z")
            .parent("evt-2")
            .build_event(),
        // ToolExecComplete arrives after turn is finalized
        tool_complete("tc-slow")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .result(json!("done"))
            .id("evt-5")
            .timestamp("2026-03-10T10:05:01.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    let tc = &turns[0].tool_calls[0];
    assert_eq!(tc.tool_call_id.as_deref(), Some("tc-slow"));
    assert!(tc.is_complete);
    assert_eq!(tc.success, Some(true));
    // Duration should be ~5 minutes
    assert!(
        tc.duration_ms.unwrap() > 290_000,
        "Duration should be >290s, got {}ms",
        tc.duration_ms.unwrap()
    );
}

#[test]
fn duplicate_tool_execution_start_is_deduplicated() {
    let events = vec![
        user_msg("Do work")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2025-01-01T00:00:00Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("ev-2")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        // First ToolExecutionStart
        tool_start("read_file")
            .tool_call_id("tc-dup")
            .id("ev-3")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        // Duplicate ToolExecutionStart with same ID
        tool_start("read_file")
            .tool_call_id("tc-dup")
            .id("ev-3-dup")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        tool_complete("tc-dup")
            .success(true)
            .id("ev-4")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-5")
            .timestamp("2025-01-01T00:00:04Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].tool_calls.len(),
        1,
        "duplicate ToolExecutionStart should be deduplicated"
    );
}

#[test]
fn extracts_intention_summary_for_tool_calls() {
    let events = vec![
        user_msg("Fix the bug")
            .interaction_id("int-1")
            .transformed_content("[[datetime]] Fix the bug [[reminders]]")
            .attachments(vec![json!({"type": "file", "path": "src/main.rs"})])
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        asst_msg("")
            .message_id("msg-1")
            .interaction_id("int-1")
            .tool_requests(vec![json!({
                "toolCallId": "tc-1",
                "name": "view",
                "intentionSummary": "view the file at src/main.rs",
                "arguments": {"path": "src/main.rs"}
            })])
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        tool_start("view")
            .tool_call_id("tc-1")
            .arguments(json!({"path": "src/main.rs"}))
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.100Z")
            .parent("evt-2")
            .build_event(),
        tool_complete("tc-1")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .result(json!({"content": "fn main() { println!(\"hello\"); }", "detailedContent": "1. fn main() {\n2.     println!(\"hello\");\n3. }"}))
            .id("evt-4")
            .timestamp("2026-03-10T07:14:52.500Z")
            .parent("evt-3")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-5")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-1")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    let turn = &turns[0];

    // Transformed user message and attachments preserved
    assert_eq!(
        turn.transformed_user_message.as_deref(),
        Some("[[datetime]] Fix the bug [[reminders]]")
    );
    assert!(turn.attachments.is_some());
    assert_eq!(turn.attachments.as_ref().unwrap().len(), 1);

    // Tool call has intention summary
    assert_eq!(turn.tool_calls.len(), 1);
    let tc = &turn.tool_calls[0];
    assert_eq!(
        tc.intention_summary.as_deref(),
        Some("view the file at src/main.rs")
    );

    // Tool call has result preview (from object with content field)
    assert!(tc.result_content.is_some());
    assert!(tc.result_content.as_ref().unwrap().contains("fn main()"));
}

#[test]
fn handles_polymorphic_result_string() {
    // result can be a plain string (not an object)
    let events = vec![
        user_msg("Do something")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        tool_start("read_file")
            .tool_call_id("tc-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        tool_complete("tc-1")
            .success(true)
            .result(json!("file contents here"))
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.500Z")
            .parent("evt-2")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    let tc = &turns[0].tool_calls[0];
    assert_eq!(tc.result_content.as_deref(), Some("file contents here"));
}
