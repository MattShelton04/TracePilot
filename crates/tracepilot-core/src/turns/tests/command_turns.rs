//! Slash commands that run without a model call (Claude Code `/model`,
//! `/cost`): their output is logged after them as `system.message` events.

use super::*;

fn at(seconds: u32) -> String {
    format!("2026-10-07T10:00:{seconds:02}.000Z")
}

/// A local command's printed output, as the Claude Code parser tags it.
fn command_output(content: &str, id: &str, seconds: u32) -> TypedEvent {
    system_message(content)
        .no_role()
        .name("command-output")
        .id(id)
        .timestamp(at(seconds))
        .build_event()
}

/// A prompt command's or skill's expansion (an `isMeta` record): role-less
/// and untagged, sent to the model rather than printed.
fn expansion(content: &str, id: &str, seconds: u32) -> TypedEvent {
    system_message(content)
        .no_role()
        .id(id)
        .timestamp(at(seconds))
        .build_event()
}

fn abort(id: &str, seconds: u32) -> TypedEvent {
    make_event(
        SessionEventType::Abort,
        TypedEventData::Abort(AbortData {
            reason: Some("user initiated".to_string()),
        }),
        id,
        &at(seconds),
        None,
    )
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
        command_output("Set model to Opus 5.5", "e5", 5),
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
        command_output("Total cost: $0.00", "e1", 1),
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

/// `/review 57` → its expanded prompt.
fn prompt_command() -> Vec<TypedEvent> {
    vec![
        user_msg("/review 57")
            .source("command-review")
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        expansion("Review pull request 57.", "e1", 1),
    ]
}

#[test]
fn prompt_command_interrupted_before_the_reply_stays_incomplete() {
    let mut events = prompt_command();
    events.push(abort("e2", 2));
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].system_messages, ["Review pull request 57."]);
    assert!(
        turns[0].command_output_event_indices.is_empty(),
        "a prompt sent to the model is no command output"
    );
    assert!(!turns[0].is_complete, "the user interrupted it");
}

#[test]
fn prompt_command_awaiting_the_model_is_not_done() {
    // A live session between the expansion and the model's first record.
    let turns = reconstruct_turns(&prompt_command());
    assert!(turns[0].command_output_event_indices.is_empty());
    assert!(!turns[0].is_complete);
}

#[test]
fn prompt_command_answered_by_the_model_has_no_output() {
    let mut events = prompt_command();
    events.extend([
        turn_start().id("e2").timestamp(at(2)).build_event(),
        asst_msg("Looks good.")
            .id("e3")
            .timestamp(at(3))
            .build_event(),
        turn_end().id("e4").timestamp(at(4)).build_event(),
    ]);
    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].system_messages, ["Review pull request 57."]);
    assert!(turns[0].command_output_event_indices.is_empty());
    assert!(turns[0].is_complete);
}

#[test]
fn command_interrupted_after_its_output_keeps_it_but_is_not_complete() {
    let events = vec![
        user_msg("/cost")
            .source("command-cost")
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        command_output("Total cost: $0.00", "e1", 1),
        abort("e2", 2),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].command_output_event_indices, [1]);
    assert!(!turns[0].is_complete, "an abort never reads as complete");
}

#[test]
fn system_message_after_the_last_turn_lands_before_its_output() {
    let events = vec![
        user_msg("/cost")
            .source("command-cost")
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        command_output("Total cost: $0.00", "e1", 1),
        abort("e2", 2),
        system_message("Late prompt.")
            .no_role()
            .id("e3")
            .timestamp(at(3))
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(
        turns[0].system_messages,
        ["Late prompt.", "Total cost: $0.00"],
        "the output stays last, where its indices point"
    );
    assert_eq!(turns[0].command_output_event_indices, [1]);
}

#[test]
fn system_message_carried_into_a_command_turn_keeps_its_output() {
    // A system message logged before any prompt joins the next turn, ahead
    // of the command's own output.
    let events = vec![
        system_message("Carried prompt.")
            .no_role()
            .id("e0")
            .timestamp(at(0))
            .build_event(),
        user_msg("/model claude-opus-5-5")
            .source("command-model")
            .id("e1")
            .timestamp(at(1))
            .build_event(),
        command_output("Set model to Opus 5.5", "e2", 2),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(
        turns[0].system_messages,
        ["Carried prompt.", "Set model to Opus 5.5"]
    );
    assert_eq!(turns[0].command_output_event_indices, [2]);
    assert!(turns[0].is_complete);
}
