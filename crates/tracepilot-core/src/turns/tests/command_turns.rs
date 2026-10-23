//! Slash commands that run without a model call (Claude Code `/model`,
//! `/cost`): their output is logged after them as `system.message` events.

use super::*;

fn at(seconds: u32) -> String {
    format!("2026-10-07T10:00:{seconds:02}.000Z")
}

/// prompt → answer → `/model` → its output → prompt → answer.
fn prompt_then_command_then_prompt() -> Vec<TypedEvent> {
    vec![
        user_msg("Hello")
            .source("user")
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        turn_start().id("e1").timestamp(at(1)).build_event(),
        asst_msg("Hi.").id("e2").timestamp(at(2)).build_event(),
        turn_end().id("e3").timestamp(at(3)).build_event(),
        user_msg("/model claude-opus-5-5")
            .source("command-model")
            .id("e4")
            .timestamp(at(4))
            .build_event(),
        system_message("Set model to Opus 5.5")
            .no_role()
            .id("e5")
            .timestamp(at(5))
            .build_event(),
        user_msg("Next")
            .source("user")
            .id("e6")
            .timestamp(at(6))
            .build_event(),
        turn_start().id("e7").timestamp(at(7)).build_event(),
        asst_msg("Done.").id("e8").timestamp(at(8)).build_event(),
        turn_end().id("e9").timestamp(at(9)).build_event(),
    ]
}

#[test]
fn local_command_output_follows_the_command_and_completes_its_turn() {
    let turns = reconstruct_turns(&prompt_then_command_then_prompt());
    assert_eq!(turns.len(), 3);
    let command = &turns[1];
    assert_eq!(
        command.user_message.as_deref(),
        Some("/model claude-opus-5-5")
    );
    assert_eq!(command.system_messages, ["Set model to Opus 5.5"]);
    assert_eq!(command.command_output_event_indices, [5]);
    assert!(
        command.is_complete,
        "a command that printed its output is not left incomplete"
    );
    // The prompts around it are untouched.
    assert!(turns[0].command_output_event_indices.is_empty());
    assert!(turns[2].command_output_event_indices.is_empty());
    assert!(turns[0].is_complete && turns[2].is_complete);
}

#[test]
fn last_command_of_a_session_with_output_is_complete() {
    let events = vec![
        user_msg("/cost")
            .source("command-cost")
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        system_message("Total cost: $0.00")
            .no_role()
            .id("e1")
            .timestamp(at(1))
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].command_output_event_indices, [1]);
    assert!(turns[0].is_complete);
}

#[test]
fn command_answered_by_the_model_keeps_its_system_prompt_before_it() {
    // Copilot logs the system prompt for the request a command starts.
    let events = vec![
        user_msg("/review 57")
            .source("command-review")
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        system_message("You are a reviewer.")
            .role("system")
            .id("e1")
            .timestamp(at(1))
            .build_event(),
        turn_start().id("e2").timestamp(at(2)).build_event(),
        asst_msg("Looks good.")
            .id("e3")
            .timestamp(at(3))
            .build_event(),
        user_msg("Thanks")
            .source("user")
            .id("e4")
            .timestamp(at(4))
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].system_messages, ["You are a reviewer."]);
    assert!(turns[0].command_output_event_indices.is_empty());
    assert!(!turns[0].is_complete, "no turn end was logged");
}

#[test]
fn roleless_system_message_before_a_model_reply_is_no_command_output() {
    // Older system prompts carry no role; the model's reply still rules
    // out a local command.
    let events = vec![
        user_msg("/plan")
            .source("command-plan")
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        system_message("System prompt.")
            .no_role()
            .id("e1")
            .timestamp(at(1))
            .build_event(),
        turn_start().id("e2").timestamp(at(2)).build_event(),
        asst_msg("Planning.")
            .id("e3")
            .timestamp(at(3))
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].system_messages, ["System prompt."]);
    assert!(turns[0].command_output_event_indices.is_empty());
}

#[test]
fn typed_prompt_with_system_message_is_unchanged() {
    let events = vec![
        user_msg("Hello")
            .source("user")
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        system_message("System prompt.")
            .no_role()
            .id("e1")
            .timestamp(at(1))
            .build_event(),
        user_msg("Again")
            .source("user")
            .id("e2")
            .timestamp(at(2))
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert!(turns[0].command_output_event_indices.is_empty());
    assert!(!turns[0].is_complete);
}

#[test]
fn command_output_indices_serialize_only_when_present() {
    let turns = reconstruct_turns(&prompt_then_command_then_prompt());
    let prompt = serde_json::to_value(&turns[0]).unwrap();
    assert!(prompt.get("commandOutputEventIndices").is_none());
    let command = serde_json::to_value(&turns[1]).unwrap();
    assert_eq!(command["commandOutputEventIndices"], json!([5]));
}
