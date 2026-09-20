use super::super::extract_search_content;
use super::helpers::sid;
use tracepilot_core::parsing::events::parse_typed_events;
use tracepilot_core::turns::reconstruct_turns;

#[test]
fn structured_reasoning_search_matches_conversation_and_child_attribution() {
    use serde_json::json;
    use tracepilot_core::models::event_types::AssistantMessageData;
    use tracepilot_core::parsing::events::TypedEventData;

    let mut event = super::helpers::assistant_message("");
    event.typed_data = TypedEventData::AssistantMessage(AssistantMessageData {
        parent_tool_call_id: Some("child-call".into()),
        reasoning_blocks: Some(json!({"provider": "openai-responses", "blocks": [
            {"type": "reasoning", "encrypted_content": "do not display", "summary": [
                {"type": "summary_text", "text": "**Checking fixtures**\n\nVisible details."}
            ]}
        ]})),
        ..Default::default()
    });
    let events = vec![super::helpers::user_message("Check compatibility"), event];
    let turns = reconstruct_turns(&events);
    let reasoning = &turns[0].reasoning_texts[0];
    assert_eq!(reasoning.parent_tool_call_id.as_deref(), Some("child-call"));
    assert_eq!(reasoning.event_index, Some(1));
    let rows = extract_search_content(&sid(), &events);
    let matches: Vec<_> = rows
        .iter()
        .filter(|row| row.content_type == "reasoning")
        .collect();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].content, reasoning.content);
    assert_eq!(matches[0].event_index, 1);
    assert_eq!(matches[0].turn_number, Some(0));
}

#[test]
fn search_destinations_follow_reconstructed_agent_ownership() {
    for fixture in ["v1_0_83_multiturn.jsonl", "v1_0_83_agents.jsonl"] {
        let events = parse_typed_events(
            &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../tracepilot-core/tests/fixtures/versions")
                .join(fixture),
        )
        .unwrap()
        .events;
        // Prefixes exercise partial launches, late child logs and reopened workers.
        for length in 1..=events.len() {
            let turns = reconstruct_turns(&events[..length]);
            let rows = extract_search_content(&sid(), &events[..length]);
            for turn in &turns {
                let indices = turn
                    .assistant_messages
                    .iter()
                    .filter_map(|m| m.event_index)
                    .chain(turn.reasoning_texts.iter().filter_map(|m| m.event_index))
                    .chain(turn.tool_calls.iter().filter_map(|tc| tc.event_index));
                for index in indices {
                    for row in rows.iter().filter(|row| row.event_index == index as i64) {
                        assert_eq!(
                            row.turn_number,
                            Some(turn.turn_index as i64),
                            "{fixture} prefix {length}, event {index}"
                        );
                    }
                }
            }
            assert!(
                rows.iter()
                    .filter_map(|row| row.turn_number)
                    .all(|i| i < turns.len() as i64)
            );
        }
    }
}
