use super::super::*;

// Helper functions
pub(super) fn sub_completed_event(ts: &str, evt_id: &str) -> TypedEvent {
    subagent_complete("explore")
        .tool_call_id("tc-sub")
        .agent_display_name("Explore Agent")
        .id(evt_id)
        .timestamp(ts)
        .parent("evt-4")
        .build_event()
}
pub(super) fn sub_failed_event(ts: &str, evt_id: &str, error: &str) -> TypedEvent {
    subagent_failed("explore")
        .tool_call_id("tc-sub")
        .agent_display_name("Explore Agent")
        .error(error)
        .id(evt_id)
        .timestamp(ts)
        .parent("evt-4")
        .build_event()
}
pub(super) fn tool_complete_event(ts: &str, evt_id: &str, success: Option<bool>) -> TypedEvent {
    tool_complete("tc-sub")
        .model("claude-opus-4.6")
        .interaction_id("int-1")
        .success(success.unwrap_or(true))
        .result(json!("Agent completed successfully"))
        .id(evt_id)
        .timestamp(ts)
        .parent("evt-3")
        .build_event()
}
pub(super) fn turn_end_event(ts: &str, evt_id: &str) -> TypedEvent {
    turn_end()
        .turn_id("turn-1")
        .id(evt_id)
        .timestamp(ts)
        .parent("evt-2")
        .build_event()
}
pub(super) fn run_subagent_scenario(events: Vec<TypedEvent>) -> TurnToolCall {
    let turns = reconstruct_turns(&events);
    assert!(!turns.is_empty(), "Expected at least one turn");
    let subagent = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.is_subagent)
        .expect("Expected a subagent tool call");
    subagent.clone()
}
