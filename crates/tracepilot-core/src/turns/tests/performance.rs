//! Performance regression tests.
//!
//! Tests marked with #[ignore] that measure performance characteristics.
//!
//! ## Tests Included
//! - Subagent-heavy reconstruction performance test

use super::*;

// Helper function
fn make_subagent_heavy_session(
    turn_count: usize,
    subagents_per_turn: usize,
    tools_per_subagent: usize,
) -> Vec<TypedEvent> {
    let mut events = Vec::new();
    let mut ts_counter: u64 = 0;
    let mut next_ts = move || -> String {
        ts_counter += 1;
        let secs = ts_counter / 1000;
        let millis = ts_counter % 1000;
        let mins = secs / 60;
        let s = secs % 60;
        let hours = mins / 60;
        let m = mins % 60;
        format!("2026-01-01T{hours:02}:{m:02}:{s:02}.{millis:03}Z")
    };
    let mut evt_id: usize = 0;
    let mut next_id = move || -> String {
        evt_id += 1;
        format!("ev-{evt_id}")
    };

    // Session model change
    events.push(make_event(
        SessionEventType::SessionModelChange,
        TypedEventData::ModelChange(ModelChangeData {
            previous_model: None,
            new_model: Some("claude-sonnet-4".to_string()),
            previous_reasoning_effort: None,
            reasoning_effort: None,
        }),
        &next_id(),
        &next_ts(),
        None,
    ));

    for turn_idx in 0..turn_count {
        // UserMessage
        events.push(make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some(format!("Turn {turn_idx}")),
                transformed_content: None,
                attachments: None,
                interaction_id: Some(format!("int-{turn_idx}")),
                source: None,
                agent_mode: None,
            }),
            &next_id(),
            &next_ts(),
            None,
        ));

        // Main agent direct tool call
        let main_tc_id = format!("tc-main-{turn_idx}");
        events.push(make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some(main_tc_id.clone()),
                tool_name: Some("read_file".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            &next_id(),
            &next_ts(),
            None,
        ));
        events.push(make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some(main_tc_id),
                parent_tool_call_id: None,
                model: Some("claude-sonnet-4".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            &next_id(),
            &next_ts(),
            None,
        ));

        // Subagents
        for sub_idx in 0..subagents_per_turn {
            let sub_tc_id = format!("tc-sub-{turn_idx}-{sub_idx}");
            let sub_model = if sub_idx % 2 == 0 { "gemini-3-pro-preview" } else { "gpt-5.3-codex" };

            // ToolExecStart for subagent wrapper
            events.push(make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some(sub_tc_id.clone()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(json!({ "model": sub_model })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                &next_id(),
                &next_ts(),
                None,
            ));
            events.push(make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some(sub_tc_id.clone()),
                    agent_name: Some(format!("agent-{sub_idx}")),
                    agent_display_name: Some(format!("Agent {sub_idx}")),
                    agent_description: None,
                }),
                &next_id(),
                &next_ts(),
                None,
            ));

            // Child tool calls under this subagent
            for tool_idx in 0..tools_per_subagent {
                let child_tc_id = format!("tc-child-{turn_idx}-{sub_idx}-{tool_idx}");
                events.push(make_event(
                    SessionEventType::ToolExecutionStart,
                    TypedEventData::ToolExecutionStart(ToolExecStartData {
                        tool_call_id: Some(child_tc_id.clone()),
                        tool_name: Some("grep".to_string()),
                        arguments: None,
                        parent_tool_call_id: Some(sub_tc_id.clone()),
                        mcp_server_name: None,
                        mcp_tool_name: None,
                    }),
                    &next_id(),
                    &next_ts(),
                    None,
                ));
                events.push(make_event(
                    SessionEventType::ToolExecutionComplete,
                    TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                        tool_call_id: Some(child_tc_id),
                        parent_tool_call_id: Some(sub_tc_id.clone()),
                        model: Some(sub_model.to_string()),
                        interaction_id: None,
                        success: Some(true),
                        result: None,
                        error: None,
                        tool_telemetry: None,
                        is_user_requested: None,
                    }),
                    &next_id(),
                    &next_ts(),
                    None,
                ));
            }

            events.push(make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some(sub_tc_id.clone()),
                    agent_name: Some(format!("agent-{sub_idx}")),
                    agent_display_name: Some(format!("Agent {sub_idx}")),
                }),
                &next_id(),
                &next_ts(),
                None,
            ));
            events.push(make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some(sub_tc_id),
                    parent_tool_call_id: None,
                    model: Some("claude-sonnet-4".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                &next_id(),
                &next_ts(),
                None,
            ));
        }

        events.push(make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some(format!("turn-{turn_idx}")),
            }),
            &next_id(),
            &next_ts(),
            None,
        ));
    }

    events
}

#[test]
#[ignore] // Perf measurement test — run with --include-ignored
fn perf_reconstruct_turns_subagent_heavy() {
    // Measure performance with subagent-heavy sessions at different scales.
    // This is a timing test, not a pass/fail — prints results for manual review.
    let configs = [
        // (turns, subagents_per_turn, tools_per_subagent)
        (10, 3, 5),     // small: 10 turns, 3 subagents each with 5 tools
        (50, 3, 5),     // medium: 50 turns
        (200, 4, 8),    // large: 200 turns, 4 subagents each with 8 tools
        (500, 5, 10),   // xlarge: 500 turns, 5 subagents each with 10 tools
    ];

    for (turns, subs, tools) in configs {
        let events = make_subagent_heavy_session(turns, subs, tools);
        let event_count = events.len();

        // Warm up
        let _ = reconstruct_turns(&events);

        // Measure
        let iterations = 50;
        let start = std::time::Instant::now();
        for _ in 0..iterations {
            let result = reconstruct_turns(&events);
            std::hint::black_box(&result);
        }
        let elapsed = start.elapsed();
        let per_iter = elapsed / iterations;

        // Verify correctness
        let result = reconstruct_turns(&events);
        assert_eq!(result.len(), turns);
        for turn in &result {
            assert_eq!(
                turn.model.as_deref(),
                Some("claude-sonnet-4"),
                "turn {} model should be main agent's, got {:?}",
                turn.turn_index,
                turn.model
            );
        }

        let total_tool_calls: usize = result.iter().map(|t| t.tool_calls.len()).sum();
        let subagent_count: usize = result.iter()
            .flat_map(|t| t.tool_calls.iter())
            .filter(|tc| tc.is_subagent)
            .count();

        eprintln!(
            "  {turns:>4} turns x {subs} subs x {tools} tools | {event_count:>6} events | {total_tool_calls:>6} tool_calls ({subagent_count} subagents) | {per_iter:>10.2?}/iter | {:.1} events/us",
            event_count as f64 / per_iter.as_micros() as f64
        );
    }
}
