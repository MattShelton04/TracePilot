use super::super::extract_search_content;
use super::helpers::sid;
use tracepilot_core::parsing::events::parse_typed_events;
use tracepilot_core::turns::reconstruct_turns;

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
