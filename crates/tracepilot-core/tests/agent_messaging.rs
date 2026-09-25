//! Inter-agent messaging as persisted by Copilot CLI 1.0.88: a parent launches
//! two siblings that message each other directly, then broadcasts to both.

use std::path::PathBuf;
use tracepilot_core::models::conversation::{AgentMessage, ConversationTurn, TurnToolCall};
use tracepilot_core::parsing::events::{TypedEvent, parse_typed_events};
use tracepilot_core::turns::reconstruct_turns;

fn fixture(name: &str) -> Vec<TypedEvent> {
    parse_typed_events(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/versions")
            .join(name),
    )
    .unwrap()
    .events
}

fn messages_to<'a>(turns: &'a [ConversationTurn], recipient: &str) -> Vec<&'a AgentMessage> {
    turns
        .iter()
        .flat_map(|turn| &turn.agent_messages)
        .filter(|m| m.recipient_tool_call_id == recipient)
        .collect()
}

fn tools_named<'a>(turns: &'a [ConversationTurn], name: &str) -> Vec<&'a TurnToolCall> {
    turns
        .iter()
        .flat_map(|turn| &turn.tool_calls)
        .filter(|tc| tc.tool_name == name)
        .collect()
}

#[test]
fn child_prompts_never_become_main_conversation_turns() {
    let turns = reconstruct_turns(&fixture("v1_0_88_agent_messaging.jsonl"));
    let prompt = turns[0].user_message.as_deref().unwrap();
    assert!(prompt.starts_with("This is a protocol probe"));
    assert!(turns[1..].iter().all(|turn| turn.user_message.is_none()));
    // Every message delivered to a worker attaches to its launching turn.
    assert_eq!(turns[0].agent_messages.len(), 6);
    assert!(turns[1..].iter().all(|turn| turn.agent_messages.is_empty()));
}

#[test]
fn records_launch_prompts_peer_messages_and_broadcasts_per_recipient() {
    let turns = reconstruct_turns(&fixture("v1_0_88_agent_messaging.jsonl"));

    let alpha = messages_to(&turns, "launch-alpha");
    let contents: Vec<_> = alpha.iter().map(|m| m.content.as_str()).collect();
    assert_eq!(contents.len(), 3);
    assert!(contents[0].starts_with("You are alpha."));
    assert_eq!(contents[1], "6 * 7 = 42.");
    assert_eq!(contents[2], "Final check: reply with the single word DONE.");

    // Launch prompt from the main agent, which sends as the session.
    assert!(alpha[0].is_launch);
    assert_eq!(alpha[0].sender_agent_id.as_deref(), Some("session-main"));
    assert_eq!(alpha[0].sender_tool_call_id, None);
    // Direct message from the sibling resolves to the sibling's launch.
    assert!(!alpha[1].is_launch);
    assert_eq!(alpha[1].sender_agent_id.as_deref(), Some("agent-beta"));
    assert_eq!(alpha[1].sender_tool_call_id.as_deref(), Some("launch-beta"));
    // The broadcast arrived while alpha was busy.
    assert_eq!(alpha[1].delivery.as_deref(), Some("idle"));
    assert_eq!(alpha[2].delivery.as_deref(), Some("queued"));
    assert_eq!(alpha[2].sender_tool_call_id, None);

    let beta = messages_to(&turns, "launch-beta");
    assert_eq!(beta.len(), 3);
    assert!(beta[0].is_launch);
    assert_eq!(beta[1].content, "alpha asks: what is 6*7?");
    assert_eq!(beta[1].sender_tool_call_id.as_deref(), Some("launch-alpha"));

    // Messages carry their position in the log for chronological interleaving.
    let indices: Vec<_> = turns[0]
        .agent_messages
        .iter()
        .map(|m| m.event_index.unwrap())
        .collect();
    assert!(indices.windows(2).all(|w| w[0] < w[1]));
    assert!(
        turns[0]
            .agent_messages
            .iter()
            .all(|m| m.timestamp.is_some())
    );
}

#[test]
fn sibling_write_agent_calls_belong_to_the_sending_worker() {
    let turns = reconstruct_turns(&fixture("v1_0_88_agent_messaging.jsonl"));
    let writes = tools_named(&turns, "write_agent");
    let senders: Vec<_> = writes
        .iter()
        .map(|tc| tc.parent_tool_call_id.as_deref())
        .collect();
    assert_eq!(
        senders,
        [Some("launch-alpha"), Some("launch-beta"), None],
        "alpha → beta, beta → alpha, then the main agent's broadcast"
    );
    let broadcast = writes[2].arguments.as_ref().unwrap();
    assert_eq!(broadcast["scope"], "children");

    let sibling_lists: Vec<_> = tools_named(&turns, "list_agents")
        .into_iter()
        .filter(|tc| tc.parent_tool_call_id.as_deref() == Some("launch-alpha"))
        .collect();
    assert_eq!(sibling_lists.len(), 1);
    assert_eq!(
        sibling_lists[0].arguments.as_ref().unwrap()["scope"],
        "siblings"
    );
}

#[test]
fn messages_without_a_source_keep_an_unknown_sender() {
    // 1.0.83 persisted child prompts without `source`.
    let turns = reconstruct_turns(&fixture("v1_0_83_multiturn.jsonl"));
    let messages = messages_to(&turns, "launch");
    assert_eq!(messages.len(), 2);
    assert!(messages[0].is_launch);
    assert!(!messages[1].is_launch);
    assert!(messages.iter().all(|m| m.sender_agent_id.is_none()));
    assert!(messages.iter().all(|m| m.sender_tool_call_id.is_none()));
}

#[test]
fn delayed_child_prompt_is_the_launch_message_of_its_owner() {
    let turns = reconstruct_turns(&fixture("v1_0_83_agents.jsonl"));
    let messages = messages_to(&turns, "launch-a");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content, "Private worker prompt.");
    assert!(messages[0].is_launch);
}

#[test]
fn logs_before_agent_scoped_prompts_have_no_messages() {
    let turns = reconstruct_turns(&fixture("v1_0_24.jsonl"));
    assert!(!turns.is_empty());
    assert!(turns.iter().all(|turn| turn.agent_messages.is_empty()));
}
