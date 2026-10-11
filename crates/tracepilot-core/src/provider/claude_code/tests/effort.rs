//! The reasoning effort Claude Code records on each assistant record
//! (`effort`, `perTurnEffort`) as the session's and each turn's effort.

use serde_json::{Value, json};
use tracepilot_test_support::claude::{OPUS, Transcript, text, write_session};

use super::super::summary::summarize;
use super::{parse, user_turns};
use crate::ids::SessionId;
use crate::models::conversation::ConversationTurn;
use crate::parsing::events::TypedEventData;
use crate::turns::reconstruct_turns;

/// One single-record call, with `effort` keys merged in.
fn call(t: &mut Transcript, id: &str, effort: Value) {
    let mut body = json!({
        "requestId": format!("req_{id}"),
        "message": {
            "id": id,
            "model": OPUS,
            "role": "assistant",
            "stop_reason": "end_turn",
            "content": [text("Done.")],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        },
    });
    if let (Some(body), Value::Object(effort)) = (body.as_object_mut(), effort) {
        body.extend(effort);
    }
    t.record("assistant", body);
}

fn efforts(turns: &[ConversationTurn]) -> Vec<Option<&str>> {
    user_turns(turns)
        .iter()
        .map(|t| t.reasoning_effort.as_deref())
        .collect()
}

#[test]
fn recorded_effort_is_the_sessions_and_a_change_is_a_model_change() {
    let mut t = Transcript::main();
    t.prompt("Plan the change.");
    call(
        &mut t,
        "msg_1",
        json!({"effort": "high", "perTurnEffort": "high"}),
    );
    t.prompt("Now just rename it.");
    call(
        &mut t,
        "msg_2",
        json!({"effort": "low", "perTurnEffort": "low"}),
    );
    let parsed = parse(&write_session(&t, &[]));

    assert_eq!(parsed.events[0].raw.data["reasoningEffort"], "high");
    let changes: Vec<_> = parsed
        .events
        .iter()
        .filter_map(|e| match &e.typed_data {
            TypedEventData::ModelChange(data) => Some(data),
            _ => None,
        })
        .collect();
    assert_eq!(changes.len(), 1, "an effort switch on the same model");
    assert_eq!(
        changes[0].previous_reasoning_effort.as_deref(),
        Some("high")
    );
    assert_eq!(changes[0].reasoning_effort.as_deref(), Some("low"));
    assert_eq!(changes[0].new_model.as_deref(), Some(OPUS));

    let turns = reconstruct_turns(&parsed.events);
    assert_eq!(efforts(&turns), [Some("high"), Some("low")]);
    let (summary, ..) = summarize(&SessionId::from_validated("s"), &parsed);
    assert_eq!(summary.current_reasoning_effort.as_deref(), Some("low"));
}

#[test]
fn per_turn_effort_stands_in_and_a_call_without_effort_keeps_it() {
    let mut t = Transcript::main();
    t.prompt("First.");
    call(&mut t, "msg_1", json!({"perTurnEffort": "medium"}));
    t.prompt("Second.");
    call(
        &mut t,
        "msg_2",
        json!({"effort": null, "perTurnEffort": null}),
    );
    let parsed = parse(&write_session(&t, &[]));

    assert!(
        !parsed
            .events
            .iter()
            .any(|e| matches!(e.typed_data, TypedEventData::ModelChange(_))),
        "an unrecorded effort is not a change"
    );
    let (summary, turns, _) = summarize(&SessionId::from_validated("s"), &parsed);
    assert_eq!(summary.current_reasoning_effort.as_deref(), Some("medium"));
    assert_eq!(efforts(&turns), [Some("medium"), Some("medium")]);
}

#[test]
fn a_transcript_without_effort_records_none() {
    let mut t = Transcript::main();
    t.prompt("Hello.");
    call(&mut t, "msg_1", Value::Null);
    let parsed = parse(&write_session(&t, &[]));

    assert!(parsed.events[0].raw.data.get("reasoningEffort").is_none());
    let (summary, ..) = summarize(&SessionId::from_validated("s"), &parsed);
    assert_eq!(summary.current_reasoning_effort, None);
}

#[test]
fn an_effort_first_recorded_after_a_resume_becomes_the_sessions() {
    let mut t = Transcript::main();
    t.prompt("Started on an older Claude Code.");
    call(&mut t, "msg_1", Value::Null);
    t.prompt("Resumed on a newer one.");
    call(&mut t, "msg_2", json!({"effort": "xhigh"}));
    let parsed = parse(&write_session(&t, &[]));

    let (summary, turns, _) = summarize(&SessionId::from_validated("s"), &parsed);
    assert_eq!(summary.current_reasoning_effort.as_deref(), Some("xhigh"));
    assert_eq!(efforts(&turns), [None, Some("xhigh")]);
}
