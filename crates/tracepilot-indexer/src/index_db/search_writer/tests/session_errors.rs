use super::super::extract_search_content;
use super::helpers::*;

#[test]
fn session_error_between_turns_assigned_to_next_turn() {
    // Session errors between turns should be buffered and assigned to
    // the next turn that opens (mirroring reconstructor's pending_session_events).
    let events = vec![
        user_message("Start"), // turn 0
        assistant_turn_start(),
        assistant_message("Working..."),  // turn 0
        assistant_turn_end(),             // closes turn 0
        session_error("rate limit hit"),  // between turns → pending
        assistant_turn_start(),           // turn 1 opens → flush pending
        assistant_message("Retrying..."), // turn 1
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "assistant_message"));
    // The session error between turns should be flushed to turn 1
    assert_eq!(map[2], (Some(1), "error"));
    assert_eq!(map[3], (Some(1), "assistant_message"));
}

#[test]
fn session_error_within_turn_assigned_to_current_turn() {
    // Session errors within an active turn should use that turn.
    let events = vec![
        user_message("Start"),
        assistant_turn_start(),
        session_error("transient error"), // within turn 0
        assistant_message("Continuing..."),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "error"));
    assert_eq!(map[2], (Some(0), "assistant_message"));
}

#[test]
fn session_error_before_any_turn_gets_none() {
    // Session errors before any turn has opened should have turn_number: None
    // until a turn opens.
    let events = vec![
        session_error("early error"), // no turn yet → pending
        user_message("Start"),        // turn 0 → flushes pending
        assistant_turn_start(),
        assistant_message("OK"),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    // The early error should be flushed to turn 0 (when user message opens it)
    assert_eq!(map[0], (Some(0), "error"));
    assert_eq!(map[1], (Some(0), "user_message"));
    assert_eq!(map[2], (Some(0), "assistant_message"));
}

#[test]
fn trailing_session_error_after_last_turn_gets_none() {
    // Session errors after the last turn has closed, with no more turns,
    // should get turn_number: None.
    let events = vec![
        user_message("Start"),
        assistant_turn_start(),
        assistant_message("Done"),
        assistant_turn_end(),
        session_error("final error"), // after last turn, no more turns
    ];
    let rows = extract_search_content(&sid(), &events);

    // user_message + assistant_message = turn 0
    assert_eq!(rows[0].turn_number, Some(0));
    assert_eq!(rows[1].turn_number, Some(0));
    // trailing error has no turn to attach to
    assert_eq!(rows[2].turn_number, None);
    assert_eq!(rows[2].content_type, "error");
}
