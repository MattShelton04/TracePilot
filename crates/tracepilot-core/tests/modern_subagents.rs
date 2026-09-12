use std::path::PathBuf;
use tracepilot_core::models::conversation::{ConversationTurn, TurnToolCall};
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData, parse_typed_events};
use tracepilot_core::turns::{TurnReconstructor, reconstruct_turns};

fn events() -> Vec<TypedEvent> {
    parse_typed_events(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/versions/v1_0_83_agents.jsonl"),
    )
    .unwrap()
    .events
}

fn tool<'a>(turns: &'a [ConversationTurn], id: &str) -> &'a TurnToolCall {
    turns
        .iter()
        .flat_map(|turn| &turn.tool_calls)
        .find(|tc| tc.tool_call_id.as_deref() == Some(id))
        .unwrap()
}

fn multiturn_events() -> Vec<TypedEvent> {
    parse_typed_events(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/versions/v1_0_83_multiturn.jsonl"),
    )
    .unwrap()
    .events
}

#[test]
fn queued_followup_outlives_initial_terminal_event() {
    let original = multiturn_events();
    let mut events = original[..19].to_vec();
    // write_agent is allowed while the initial invocation is still running.
    events.extend_from_slice(&original[24..26]);
    events.push(original[19].clone());
    events.extend_from_slice(&original[30..34]);
    for (i, event) in events.iter_mut().enumerate() {
        event.raw.timestamp = Some(chrono::DateTime::from_timestamp(i as i64, 0).unwrap());
    }
    let turns = reconstruct_turns(&events);
    let agent = tool(&turns, "launch");
    assert!(!agent.is_complete);
    assert_eq!(agent.agent_status.as_deref(), Some("running"));
    assert_eq!(agent.success, None);
    assert_eq!(agent.completed_at, None);
    assert_eq!(agent.total_tokens, None);
    events.extend_from_slice(&original[29..30]); // matching read_agent start
    events.extend_from_slice(&original[35..36]); // current idle telemetry
    let turns = reconstruct_turns(&events);
    assert!(tool(&turns, "launch").is_complete);
    assert_eq!(tool(&turns, "launch").agent_status.as_deref(), Some("idle"));
}

#[test]
fn read_failure_and_cancellation_supersede_initial_success() {
    for status in ["failed", "cancelled"] {
        let mut events = multiturn_events();
        if let TypedEventData::ToolExecutionComplete(data) = &mut events[20].typed_data {
            data.tool_telemetry.as_mut().unwrap()["properties"]["status"] = status.into();
        }
        let turns = reconstruct_turns(&events[..21]);
        let agent = tool(&turns, "launch");
        assert!(agent.is_complete);
        assert_eq!(agent.success, Some(false));
        assert_eq!(agent.cancelled, Some(status == "cancelled"));
        assert_eq!(agent.agent_status.as_deref(), Some(status));
    }
}

#[test]
fn cancelling_a_worker_with_queued_followups_is_terminal_without_read_agent() {
    let original = multiturn_events();
    let mut events = original[..19].to_vec();
    events.extend_from_slice(&original[24..26]);
    let mut terminal = original[19].clone();
    if let TypedEventData::SubagentCompleted(data) = &mut terminal.typed_data {
        data.cancelled = Some(true);
    }
    events.push(terminal.clone());
    let turns = reconstruct_turns(&events);
    let agent = tool(&turns, "launch");
    assert!(agent.is_complete);
    assert_eq!(agent.cancelled, Some(true));
    assert_eq!(agent.agent_status.as_deref(), Some("cancelled"));

    terminal.event_type = tracepilot_core::models::event_types::SessionEventType::SubagentFailed;
    terminal.typed_data =
        TypedEventData::SubagentFailed(tracepilot_core::models::event_types::SubagentFailedData {
            tool_call_id: Some("launch".into()),
            error: Some("Worker stopped".into()),
            ..Default::default()
        });
    *events.last_mut().unwrap() = terminal;
    let turns = reconstruct_turns(&events);
    let agent = tool(&turns, "launch");
    assert!(agent.is_complete);
    assert_eq!(agent.success, Some(false));
    assert_eq!(agent.agent_status.as_deref(), Some("failed"));
}

#[test]
fn idle_read_with_queued_messages_does_not_complete_worker() {
    let mut events = multiturn_events();
    if let TypedEventData::ToolExecutionComplete(data) = &mut events[35].typed_data {
        data.tool_telemetry.as_mut().unwrap()["metrics"]["queue_depth"] = 1.into();
    }
    let turns = reconstruct_turns(&events);
    let agent = tool(&turns, "launch");
    assert!(!agent.is_complete);
    assert_eq!(agent.agent_status.as_deref(), Some("pending"));
}

#[test]
fn background_launch_stays_pending_before_child_log_is_flushed() {
    let events = events();
    for length in 4..24 {
        let turns = reconstruct_turns(&events[..length]);
        let agent = tool(&turns, "launch-a");
        assert!(agent.is_subagent, "prefix {length}");
        assert!(
            !agent.is_complete,
            "wrapper/child turn completed agent at prefix {length}"
        );
        assert_eq!(agent.completed_at, None);
        assert_eq!(agent.success, None);
    }
    let turns = reconstruct_turns(&events[..7]);
    assert_eq!(tool(&turns, "launch-a").agent_id.as_deref(), Some("uuid-a"));
}

#[test]
fn child_boundaries_do_not_finalize_or_replace_the_main_turn() {
    let mut events = events();
    events.remove(6); // main turn remains open while the worker completes its own turn
    let turns = reconstruct_turns(&events[..16]);
    assert_eq!(turns.len(), 1);
    assert!(!turns[0].is_complete);
    assert_eq!(turns[0].turn_id.as_deref(), Some("0"));
    assert_eq!(
        turns[0].user_message.as_deref(),
        Some("Delegate a small check.")
    );
    assert!(turns[0].system_messages.is_empty());
}

#[test]
fn uuid_owned_activity_nesting_and_cancellation_survive_replay() {
    let events = events();
    let turns = reconstruct_turns(&events);
    assert_eq!(
        turns.len(),
        2,
        "child user messages must not become main turns"
    );
    assert!(turns.iter().all(|t| t.is_complete));
    assert!(
        turns
            .iter()
            .all(|t| t.model.as_deref() == Some("gpt-5.6-luna"))
    );
    assert_eq!(
        tool(&turns, "child-tool").parent_tool_call_id.as_deref(),
        Some("launch-a")
    );
    assert_eq!(
        tool(&turns, "launch-b").parent_tool_call_id.as_deref(),
        Some("launch-a")
    );
    assert_eq!(tool(&turns, "launch-b").agent_id.as_deref(), Some("uuid-b"));
    assert_eq!(tool(&turns, "launch-b").cancelled, Some(true));
    assert_eq!(tool(&turns, "launch-b").success, Some(false));
    assert!(tool(&turns, "launch-b").is_complete);
    let parent = tool(&turns, "launch-a");
    assert_eq!(parent.success, Some(true));
    assert_eq!(parent.duration_ms, Some(20_000));
    assert_eq!(parent.total_tokens, Some(123));
    let reasoning = &turns[0].reasoning_texts[0];
    assert_eq!(reasoning.parent_tool_call_id.as_deref(), Some("launch-a"));
    assert_eq!(reasoning.agent_display_name.as_deref(), Some("Worker A"));
    let nested = turns[0]
        .assistant_messages
        .iter()
        .find(|m| m.content == "Nested output.")
        .unwrap();
    assert_eq!(nested.agent_display_name.as_deref(), Some("Worker B"));
    // The single-event API must work without the full-file ownership prepass.
    let mut incremental = TurnReconstructor::new();
    for (index, event) in events.iter().enumerate() {
        incremental.process(event, index);
    }
    assert_eq!(
        serde_json::to_value(incremental.finalize()).unwrap(),
        serde_json::to_value(turns).unwrap()
    );
}

#[test]
fn launch_failure_is_terminal_without_a_started_event() {
    let mut events = events();
    if let TypedEventData::ToolExecutionComplete(data) = &mut events[4].typed_data {
        data.success = Some(false);
        data.error = Some(serde_json::json!({"message":"Launch rejected"}));
    }
    let turns = reconstruct_turns(&events[..5]);
    let agent = tool(&turns, "launch-a");
    assert!(agent.is_complete);
    assert_eq!(agent.success, Some(false));
    assert!(agent.error.as_deref().unwrap().contains("Launch rejected"));
}

#[test]
fn lifecycle_model_wins_over_models_of_earlier_child_tools() {
    let mut events = events();
    if let TypedEventData::ToolExecutionComplete(data) = &mut events[15].typed_data {
        data.model = Some("earlier-child-model".into());
    }
    let turns = reconstruct_turns(&events);
    assert_eq!(
        tool(&turns, "launch-a").model.as_deref(),
        Some("gpt-5.6-luna")
    );
}

#[test]
fn multi_turn_followups_reopen_and_settle_from_control_telemetry() {
    let events = parse_typed_events(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/versions/v1_0_83_multiturn.jsonl"),
    )
    .unwrap()
    .events;
    let idle = reconstruct_turns(&events[..21]);
    assert_eq!(tool(&idle, "launch").agent_status.as_deref(), Some("idle"));
    for length in 26..36 {
        let turns = reconstruct_turns(&events[..length]);
        let agent = tool(&turns, "launch");
        assert!(!agent.is_complete, "follow-up prefix {length}");
        assert_eq!(agent.agent_status.as_deref(), Some("running"));
        assert_eq!(
            agent.total_tokens, None,
            "initial turn metrics must not describe later work"
        );
    }
    let done = reconstruct_turns(&events);
    let agent = tool(&done, "launch");
    assert!(agent.is_complete);
    assert_eq!(agent.agent_status.as_deref(), Some("idle"));
    assert_eq!(agent.success, Some(true));
    assert_eq!(done.len(), 5);
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e.typed_data, TypedEventData::SubagentCompleted(_)))
            .count(),
        1
    );
}

#[test]
fn uuid_child_prompts_and_reasoning_do_not_inflate_main_context() {
    use tracepilot_core::context_window::build_context_timeline;
    let original = events();
    let mut enlarged = original.clone();
    for event in &mut enlarged {
        if event.raw.agent_id.is_some() {
            match &mut event.typed_data {
                TypedEventData::UserMessage(d) => d.content = Some("private ".repeat(1000)),
                TypedEventData::SystemMessage(d) => d.content = Some("private ".repeat(1000)),
                TypedEventData::AssistantReasoning(d) => d.content = Some("private ".repeat(1000)),
                _ => {}
            }
        }
    }
    let before = build_context_timeline(&original);
    let after = build_context_timeline(&enlarged);
    assert_eq!(before.points, after.points);
}
