//! Model and effort switches shown as session events in the conversation.

use super::super::*;
use crate::models::event_types::SessionAutoModeResolvedData;

fn prompt(n: u32, ts: &str) -> TypedEvent {
    user_msg(format!("Prompt {n}"))
        .interaction_id(format!("int-{n}"))
        .id(format!("ev-user-{n}"))
        .timestamp(ts)
        .build_event()
}

/// Real sessions close each turn before the next prompt's model events.
fn end_turn(n: u32, ts: &str) -> TypedEvent {
    turn_end()
        .turn_id(format!("turn-{n}"))
        .id(format!("ev-end-{n}"))
        .timestamp(ts)
        .build_event()
}

fn session_start(model: &str) -> TypedEvent {
    make_event(
        SessionEventType::SessionStart,
        TypedEventData::SessionStart(SessionStartData {
            selected_model: Some(model.to_string()),
            ..Default::default()
        }),
        "ev-start",
        "2025-01-01T00:00:00Z",
        None,
    )
}

fn auto_resolved(chosen: &str, id: &str, ts: &str) -> TypedEvent {
    make_event(
        SessionEventType::SessionAutoModeResolved,
        TypedEventData::SessionAutoModeResolved(SessionAutoModeResolvedData {
            chosen_model: Some(chosen.to_string()),
            ..Default::default()
        }),
        id,
        ts,
        None,
    )
}

fn model_summaries(turns: &[ConversationTurn]) -> Vec<(usize, String)> {
    turns
        .iter()
        .flat_map(|turn| {
            turn.session_events
                .iter()
                .filter(|event| {
                    matches!(
                        event.event_type.as_str(),
                        "session.model_change" | "session.auto_mode_resolved"
                    )
                })
                .map(|event| (turn.turn_index, event.summary.clone()))
        })
        .collect()
}

#[test]
fn startup_restatement_is_not_a_change() {
    let events = vec![
        session_start("gpt-5.6-luna"),
        model_change()
            .previous_model("gpt-5.6-luna")
            .new_model("gpt-5.6-luna")
            .source("startup")
            .id("ev-mc")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        prompt(1, "2025-01-01T00:00:02Z"),
    ];
    let turns = reconstruct_turns(&events);
    assert!(model_summaries(&turns).is_empty());
}

#[test]
fn initial_selection_without_a_known_model_is_not_a_change() {
    // Older CLIs open with a model_change that has no source or previous model.
    let events = vec![
        model_change()
            .new_model("claude-sonnet-4.6")
            .id("ev-mc")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        prompt(1, "2025-01-01T00:00:02Z"),
    ];
    let turns = reconstruct_turns(&events);
    assert!(model_summaries(&turns).is_empty());
    assert_eq!(turns[0].model.as_deref(), Some("claude-sonnet-4.6"));
}

#[test]
fn mid_session_switch_is_shown_on_the_next_turn() {
    let events = vec![
        session_start("gpt-5.6-luna"),
        prompt(1, "2025-01-01T00:00:01Z"),
        asst_msg("One")
            .id("ev-a1")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        end_turn(1, "2025-01-01T00:00:02Z"),
        model_change()
            .previous_model("gpt-5.6-luna")
            .new_model("claude-sonnet-4.6")
            .id("ev-mc")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
        prompt(2, "2025-01-01T00:00:04Z"),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 2);
    assert_eq!(
        model_summaries(&turns),
        vec![(
            1,
            "Model changed gpt-5.6-luna → claude-sonnet-4.6".to_string()
        )]
    );
    assert_eq!(turns[1].model.as_deref(), Some("claude-sonnet-4.6"));
}

#[test]
fn switch_without_previous_model_uses_the_session_model() {
    let events = vec![
        session_start("gpt-5.4"),
        model_change()
            .new_model("claude-opus-4.6")
            .id("ev-mc")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        prompt(1, "2025-01-01T00:00:02Z"),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(
        model_summaries(&turns),
        vec![(0, "Model changed gpt-5.4 → claude-opus-4.6".to_string())]
    );
}

#[test]
fn effort_changes_are_shown_alone_or_with_the_model() {
    let events = vec![
        session_start("gpt-5.6-luna"),
        prompt(1, "2025-01-01T00:00:01Z"),
        model_change()
            .previous_model("gpt-5.6-luna")
            .new_model("gpt-5.6-luna")
            .effort("high", "medium")
            .id("ev-mc1")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        model_change()
            .previous_model("gpt-5.6-luna")
            .new_model("gpt-5.4")
            .effort("medium", "low")
            .id("ev-mc2")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(
        model_summaries(&turns),
        vec![
            (0, "Reasoning effort high → medium".to_string()),
            (
                0,
                "Model changed gpt-5.6-luna → gpt-5.4 · effort medium → low".to_string()
            ),
        ]
    );
}

#[test]
fn auto_mode_choices_are_shown_only_when_they_change() {
    let events = vec![
        session_start("gpt-5.6-luna"),
        model_change()
            .previous_model("gpt-5.6-luna")
            .new_model("auto")
            .source("automatic")
            .id("ev-mc")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        auto_resolved("gpt-5.6-luna", "ev-auto-1", "2025-01-01T00:00:02Z"),
        prompt(1, "2025-01-01T00:00:03Z"),
        end_turn(1, "2025-01-01T00:00:03Z"),
        auto_resolved("gpt-5.6-luna", "ev-auto-2", "2025-01-01T00:00:04Z"),
        prompt(2, "2025-01-01T00:00:05Z"),
        end_turn(2, "2025-01-01T00:00:05Z"),
        auto_resolved("mai-code-1.1-flash", "ev-auto-3", "2025-01-01T00:00:06Z"),
        prompt(3, "2025-01-01T00:00:07Z"),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(
        model_summaries(&turns),
        vec![
            (0, "Model changed gpt-5.6-luna → auto".to_string()),
            (0, "Auto mode chose gpt-5.6-luna".to_string()),
            (2, "Auto mode chose mai-code-1.1-flash".to_string()),
        ]
    );
    // Turns carry the model auto mode actually chose, never "auto".
    let models: Vec<_> = turns.iter().map(|turn| turn.model.as_deref()).collect();
    assert_eq!(
        models,
        vec![
            Some("gpt-5.6-luna"),
            Some("gpt-5.6-luna"),
            Some("mai-code-1.1-flash")
        ]
    );
}

#[test]
fn leaving_auto_mode_resets_the_last_choice() {
    let events = vec![
        session_start("auto"),
        auto_resolved("gpt-5.6-luna", "ev-auto-1", "2025-01-01T00:00:01Z"),
        prompt(1, "2025-01-01T00:00:02Z"),
        end_turn(1, "2025-01-01T00:00:02Z"),
        model_change()
            .previous_model("auto")
            .new_model("gpt-5.4")
            .id("ev-mc1")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
        model_change()
            .previous_model("gpt-5.4")
            .new_model("auto")
            .id("ev-mc2")
            .timestamp("2025-01-01T00:00:04Z")
            .build_event(),
        auto_resolved("gpt-5.6-luna", "ev-auto-2", "2025-01-01T00:00:05Z"),
        prompt(2, "2025-01-01T00:00:06Z"),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(
        model_summaries(&turns),
        vec![
            (0, "Auto mode chose gpt-5.6-luna".to_string()),
            (1, "Model changed auto → gpt-5.4".to_string()),
            (1, "Model changed gpt-5.4 → auto".to_string()),
            (1, "Auto mode chose gpt-5.6-luna".to_string()),
        ]
    );
}
