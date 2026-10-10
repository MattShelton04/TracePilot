//! Background agents resumed by `SendMessage` (mapping.md §1.3).

use tracepilot_test_support::claude_scenarios as fixtures;

use super::parse;
use crate::agent_runs::{AgentRunOutcome, extract_agent_runs};
use crate::models::{ConversationTurn, TurnToolCall};
use crate::turns::reconstruct_turns;

fn tool_call<'a>(turns: &'a [ConversationTurn], id: &str) -> &'a TurnToolCall {
    turns
        .iter()
        .flat_map(|t| &t.tool_calls)
        .find(|tc| tc.tool_call_id.as_deref() == Some(id))
        .unwrap_or_else(|| panic!("tool call {id}"))
}

/// A resumed agent completes again, with its new totals, and every carrier
/// of one completion still counts once, even one written after the resume.
/// A follow-up to a running agent and a peer message that is not a hand-back
/// leave the agent to its own completion.
#[test]
fn a_resumed_background_agent_completes_again() {
    let parsed = parse(&fixtures::agent_follow_ups());
    let turns = reconstruct_turns(&parsed.events);

    let review = tool_call(&turns, "toolu_R");
    assert!(review.is_subagent);
    assert!(review.is_complete, "the resumed reviewer completes again");
    assert_eq!(review.success, Some(true));
    assert_eq!(review.agent_status.as_deref(), Some("completed"));
    assert_eq!(
        review.total_tokens,
        Some(900),
        "the second completion's totals"
    );

    let docs = tool_call(&turns, "toolu_W");
    assert!(docs.is_complete, "a follow-up to a running agent");
    assert_eq!(docs.agent_status.as_deref(), Some("completed"));

    for send in ["toolu_S1", "toolu_S2"] {
        let send = tool_call(&turns, send);
        assert_eq!(send.tool_name, "write_agent");
        assert!(
            !send.is_subagent,
            "a resumed completion names its SendMessage"
        );
        assert!(send.is_complete);
    }

    let runs = extract_agent_runs(&parsed.events, &turns).runs;
    assert_eq!(runs.len(), 2);
    assert!(
        runs.iter().all(|r| r.outcome == AgentRunOutcome::Completed),
        "{:?}",
        runs.iter().map(|r| r.outcome).collect::<Vec<_>>()
    );

    let terminals: Vec<_> = parsed
        .events
        .iter()
        .filter(|e| e.raw.event_type == "subagent.completed")
        .map(|e| (e.raw.agent_id.as_deref(), e.raw.data["toolCallId"].as_str()))
        .collect();
    assert_eq!(
        terminals,
        [
            (Some("agentR"), Some("toolu_R")),
            (Some("agentR"), Some("toolu_R")),
            (Some("agentW"), Some("toolu_W")),
        ],
        "one per completion, on the launching call"
    );
    let notifications = parsed
        .events
        .iter()
        .filter(|e| e.raw.event_type == "system.notification")
        .count();
    assert_eq!(notifications, 3);
    assert_eq!(parsed.diagnostics.duplicate_notifications, 4);
}
