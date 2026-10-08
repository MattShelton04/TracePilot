//! C7 `tracepilot.model_call` events, per-turn usage, and the warnings that
//! make interrupts and denials incidents (C10).

use serde_json::json;
use tracepilot_test_support::claude::{OPUS, Transcript, Usage, text, thinking, tool_use};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::{parse, user_turns};
use crate::models::conversation::{TurnSessionEvent, TurnUsage};
use crate::parsing::events::{TypedEvent, TypedEventData};
use crate::turns::reconstruct_turns;

fn model_calls(events: &[TypedEvent]) -> Vec<&TypedEvent> {
    events
        .iter()
        .filter(|e| matches!(e.typed_data, TypedEventData::ModelCall(_)))
        .collect()
}

fn warnings(events: &[TurnSessionEvent]) -> Vec<&str> {
    events
        .iter()
        .filter(|e| e.event_type == "session.warning")
        .map(|e| e.summary.as_str())
        .collect()
}

/// Two calls in one turn, the second after a denied tool, then an
/// interrupted call in a second turn.
fn denied_and_interrupted() -> tracepilot_test_support::claude::SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Delete the build folder.");
    let usage = Usage {
        input: 10,
        cache_read: 100,
        cache_write_5m: 5,
        cache_write_1h: 40,
        output: 20,
        thinking: 7,
    };
    t.call(
        "msg_1",
        OPUS,
        vec![
            thinking("Removing it."),
            text("Deleting."),
            tool_use("toolu_1", "Bash", json!({"command": "rm -rf build"})),
        ],
        usage,
        "tool_use",
    );
    t.user(
        json!({"message": {"role": "user", "content": [{"type": "tool_result",
        "tool_use_id": "toolu_1", "is_error": true, "content": "Permission denied."}]},
        "toolUseResult": "Error: Permission denied.", "toolDenialKind": "permission-rule"}),
    );
    t.call(
        "msg_2",
        OPUS,
        vec![text("The rule blocks it.")],
        Usage::new(2, 150, 0, 9),
        "end_turn",
    );
    t.prompt("Then list it.");
    t.call(
        "msg_3",
        OPUS,
        vec![text("Listing...")],
        Usage::new(1, 160, 0, 3),
        "tool_use",
    );
    t.user(json!({"message": {"role": "user",
        "content": [{"type": "text", "text": "[Request interrupted by user]"}]}}));
    tracepilot_test_support::claude::write_session(&t, &[])
}

#[test]
fn each_visible_call_emits_one_model_call_with_its_final_usage() {
    let parsed = parse(&denied_and_interrupted());
    let calls = model_calls(&parsed.events);
    assert_eq!(calls.len(), 3);
    assert_eq!(
        calls[0].raw.data,
        json!({
            "requestId": "req_msg_1", "model": OPUS,
            // 10 uncached + 100 read + 45 written.
            "inputTokens": 155, "cacheReadTokens": 100, "cacheWriteTokens": 45,
            "cacheWriteByTtl": {"300": 5, "3600": 40},
            // The last of the call's three records wins.
            "outputTokens": 20, "reasoningTokens": 7, "stopReason": "tool_use",
        })
    );
    assert!(calls[1].raw.data.get("cacheWriteByTtl").is_none());
    // Placed right after the call's turn start, outside the parent chain.
    let index = parsed
        .events
        .iter()
        .position(|e| e.raw.event_type == "tracepilot.model_call")
        .unwrap();
    assert_eq!(
        parsed.events[index - 1].raw.event_type,
        "assistant.turn_start"
    );
    assert_eq!(
        parsed.events[index + 1].raw.parent_id,
        parsed.events[index - 1].raw.id
    );
}

#[test]
fn turns_carry_the_usage_of_their_calls() {
    let parsed = parse(&denied_and_interrupted());
    let turns = reconstruct_turns(&parsed.events);
    // Claude turns are per API call (S3), so each holds one call.
    assert_eq!(turns.len(), 3);
    assert_eq!(
        turns[0].usage,
        Some(TurnUsage {
            model_calls: 1,
            input_tokens: 155,
            cache_read_tokens: 100,
            cache_write_tokens: 45,
            output_tokens: 20,
            reasoning_tokens: 7,
        })
    );
    // Claude messages carry no token counts, so the calls supply them.
    assert_eq!(turns[0].output_tokens, Some(20));
    assert_eq!(turns[1].usage.unwrap().input_tokens, 152);
    assert_eq!(turns[1].output_tokens, Some(9));
    assert_eq!(turns[2].usage.unwrap().model_calls, 1);
}

#[test]
fn denials_and_interrupts_become_turn_warnings() {
    let parsed = parse(&denied_and_interrupted());
    let turns = reconstruct_turns(&parsed.events);
    let turns = user_turns(&turns);
    assert_eq!(
        warnings(&turns[0].session_events),
        ["Tool use denied by a permission rule"]
    );
    assert_eq!(
        warnings(&turns[1].session_events),
        ["Interrupted by the user"]
    );
    assert!(!turns[1].is_complete);

    // A rejection that interrupts the call is one incident, not two.
    let parsed = parse(&fixtures::interrupted_and_live());
    let turns = reconstruct_turns(&parsed.events);
    assert_eq!(
        warnings(&user_turns(&turns)[0].session_events),
        ["Tool use rejected by the user"]
    );
}

#[test]
fn rewound_and_synthetic_calls_emit_no_model_call() {
    let parsed = parse(&fixtures::rewind_fork());
    let visible: Vec<_> = parsed.calls.iter().filter(|c| !c.abandoned).collect();
    assert!(visible.len() < parsed.calls.len());
    let emitted: Vec<_> = model_calls(&parsed.events)
        .iter()
        .map(|e| e.raw.data["requestId"].as_str().unwrap().to_string())
        .collect();
    let expected: Vec<_> = visible
        .iter()
        .map(|c| format!("req_{}", c.message_id))
        .collect();
    assert_eq!(emitted, expected);

    // The `<synthetic>` 429 is a session error, not a model call.
    let parsed = parse(&fixtures::compaction_cycle());
    assert_eq!(model_calls(&parsed.events).len(), parsed.calls.len());
}

#[test]
fn subagent_calls_are_owned_by_their_agent() {
    let parsed = parse(&fixtures::subagents());
    let events = model_calls(&parsed.events);
    assert_eq!(events.len(), parsed.calls.len());
    for (event, call) in events.iter().zip(&parsed.calls) {
        assert_eq!(event.raw.agent_id, call.agent_id);
    }
    assert!(events.iter().any(|e| e.raw.agent_id.is_some()));
    // A turn's usage includes the subagents it ran.
    let turns = reconstruct_turns(&parsed.events);
    let total: u64 = turns
        .iter()
        .filter_map(|t| t.usage)
        .map(|u| u.model_calls)
        .sum();
    assert_eq!(total, parsed.calls.len() as u64);
}
