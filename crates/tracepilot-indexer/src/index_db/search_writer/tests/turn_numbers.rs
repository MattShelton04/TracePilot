use super::super::extract_search_content;
use super::helpers::*;

#[test]
fn turn_numbers_single_user_message_turn() {
    // UserMessage → TurnStart → AssistantMsg → TurnEnd = 1 turn (turn 0)
    let events = vec![
        user_message("Hello"),
        assistant_turn_start(),
        assistant_message("Hi there!"),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    assert!(!rows.is_empty());
    for row in &rows {
        assert_eq!(
            row.turn_number,
            Some(0),
            "all rows in single turn should be turn 0"
        );
    }
}

#[test]
fn turn_numbers_multiple_assistant_cycles() {
    // UserMessage → TurnStart → AssistantMsg → ToolExec → TurnEnd
    //             → TurnStart → AssistantMsg → TurnEnd
    // = 3 turns: turn 0 (user+first cycle), turn 1 (second cycle), turn 2 (third cycle won't exist here)
    // Actually: turn 0 starts at UserMessage, TurnEnd closes it,
    // next TurnStart opens turn 1.
    let events = vec![
        user_message("Do a task"),                 // turn 0 opens
        assistant_turn_start(),                    // noop (turn 0 already open)
        assistant_message("Let me look..."),       // turn 0
        tool_exec_start("view", "tc-1"),           // turn 0
        assistant_turn_end(),                      // turn 0 closes
        assistant_turn_start(),                    // turn 1 opens (ensure_turn)
        assistant_message("Found it, editing..."), // turn 1
        tool_exec_start("edit", "tc-2"),           // turn 1
        assistant_turn_end(),                      // turn 1 closes
        assistant_turn_start(),                    // turn 2 opens
        assistant_message("All done!"),            // turn 2
        assistant_turn_end(),                      // turn 2 closes
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    // First cycle: user_message + assistant_message + tool_call = turn 0
    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "assistant_message"));
    assert_eq!(map[2], (Some(0), "tool_call"));

    // Second cycle: assistant_message + tool_call = turn 1
    assert_eq!(map[3], (Some(1), "assistant_message"));
    assert_eq!(map[4], (Some(1), "tool_call"));

    // Third cycle: assistant_message = turn 2
    assert_eq!(map[5], (Some(2), "assistant_message"));
}

#[test]
fn turn_numbers_synthetic_turn_before_user_message() {
    // TurnStart before any UserMessage creates turn 0 (synthetic),
    // then UserMessage opens turn 1.
    let events = vec![
        assistant_turn_start(),           // turn 0 (synthetic)
        assistant_message("Resuming..."), // turn 0
        assistant_turn_end(),             // turn 0 closes
        user_message("Now do this"),      // turn 1 opens
        assistant_turn_start(),           // noop
        assistant_message("OK!"),         // turn 1
        assistant_turn_end(),             // turn 1 closes
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "assistant_message")); // synthetic turn 0
    assert_eq!(map[1], (Some(1), "user_message")); // user turn 1
    assert_eq!(map[2], (Some(1), "assistant_message")); // same turn 1
}

#[test]
fn turn_numbers_abort_closes_turn() {
    // Abort should close the current turn, next events open a new one.
    let events = vec![
        user_message("Start"),           // turn 0
        assistant_turn_start(),          // noop
        assistant_message("Working..."), // turn 0
        abort(),                         // closes turn 0
        assistant_turn_start(),          // turn 1 opens
        assistant_message("Recovered"),  // turn 1
        assistant_turn_end(),            // turn 1 closes
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "assistant_message")); // before abort
    assert_eq!(map[2], (Some(1), "assistant_message")); // after abort, new turn
}

#[test]
fn turn_numbers_user_message_after_turn_end() {
    // TurnEnd → UserMessage: user message opens a new turn
    let events = vec![
        user_message("First"), // turn 0
        assistant_turn_start(),
        assistant_message("Response 1"), // turn 0
        assistant_turn_end(),            // closes turn 0
        user_message("Second"),          // turn 1
        assistant_turn_start(),
        assistant_message("Response 2"), // turn 1
        assistant_turn_end(),            // closes turn 1
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "assistant_message"));
    assert_eq!(map[2], (Some(1), "user_message"));
    assert_eq!(map[3], (Some(1), "assistant_message"));
}

#[test]
fn turn_numbers_many_cycles_produces_high_turn_numbers() {
    // Simulate a session with 1 user message but many assistant cycles.
    // This is the core scenario the fix addresses.
    let mut events = vec![user_message("Do a complex task")];
    let num_cycles = 50;
    for i in 0..num_cycles {
        events.push(assistant_turn_start());
        events.push(assistant_message(&format!("Cycle {i}")));
        events.push(tool_exec_start("view", &format!("tc-{i}")));
        events.push(assistant_turn_end());
    }

    let rows = extract_search_content(&sid(), &events);

    // User message is turn 0
    assert_eq!(rows[0].turn_number, Some(0));
    assert_eq!(rows[0].content_type, "user_message");

    // First cycle's assistant_message + tool_call = turn 0 (same as user msg)
    assert_eq!(rows[1].turn_number, Some(0));
    assert_eq!(rows[2].turn_number, Some(0));

    // Second cycle = turn 1
    assert_eq!(rows[3].turn_number, Some(1));
    assert_eq!(rows[4].turn_number, Some(1));

    // Last cycle = turn 49
    let last_idx = rows.len() - 1;
    assert_eq!(rows[last_idx].turn_number, Some(49));

    // Verify we have high turn numbers (the whole point of the fix)
    let max_turn = rows.iter().filter_map(|r| r.turn_number).max().unwrap();
    assert_eq!(
        max_turn, 49,
        "50 cycles should produce turn numbers up to 49"
    );
}

#[test]
fn turn_numbers_reasoning_opens_turn() {
    // Reasoning event should also open a turn if none is open.
    let events = vec![
        user_message("Think about this"),
        assistant_turn_start(),
        reasoning("Let me consider..."),
        assistant_message("Here's my analysis"),
        assistant_turn_end(),
        reasoning("More thinking after turn end"), // opens turn 1
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "reasoning"));
    assert_eq!(map[2], (Some(0), "assistant_message"));
    assert_eq!(map[3], (Some(1), "reasoning")); // new turn after TurnEnd
}

#[test]
fn turn_numbers_match_reconstructor() {
    // Cross-validate: extract_search_content turn_number should match
    // reconstruct_turns turn_index for the same event sequence.
    use tracepilot_core::turns::reconstruct_turns;

    let events = vec![
        user_message("First"),
        assistant_turn_start(),
        assistant_message("Response 1"),
        tool_exec_start("view", "tc-1"),
        assistant_turn_end(),
        assistant_turn_start(),
        assistant_message("Follow-up 1"),
        assistant_turn_end(),
        user_message("Second"),
        assistant_turn_start(),
        assistant_message("Response 2"),
        assistant_turn_end(),
    ];

    let turns = reconstruct_turns(&events);
    let rows = extract_search_content(&sid(), &events);

    // The reconstructor should produce 3 turns: [0, 1, 2]
    assert_eq!(turns.len(), 3);
    assert_eq!(turns[0].turn_index, 0);
    assert_eq!(turns[1].turn_index, 1);
    assert_eq!(turns[2].turn_index, 2);

    // FTS rows should have matching turn numbers
    // Turn 0: user_message + assistant_message + tool_call
    assert_eq!(rows[0].turn_number, Some(0)); // user_message "First"
    assert_eq!(rows[1].turn_number, Some(0)); // assistant_message "Response 1"
    assert_eq!(rows[2].turn_number, Some(0)); // tool_call "view"

    // Turn 1: assistant_message (after TurnEnd→TurnStart)
    assert_eq!(rows[3].turn_number, Some(1)); // assistant_message "Follow-up 1"

    // Turn 2: user_message + assistant_message
    assert_eq!(rows[4].turn_number, Some(2)); // user_message "Second"
    assert_eq!(rows[5].turn_number, Some(2)); // assistant_message "Response 2"
}

#[test]
fn turn_numbers_consecutive_user_messages() {
    // Two user messages in a row: each opens a new turn.
    let events = vec![
        user_message("First"),
        user_message("Second"),
        assistant_turn_start(),
        assistant_message("Response"),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(1), "user_message"));
    assert_eq!(map[2], (Some(1), "assistant_message"));
}

#[test]
fn turn_numbers_tool_complete_uses_start_turn() {
    // ToolExecutionComplete should use the turn from its matching
    // ToolExecutionStart, not the ambient current_turn.
    let events = vec![
        user_message("Do it"),                       // turn 0
        assistant_turn_start(),                      // noop
        tool_exec_start("view", "tc-1"),             // turn 0
        assistant_turn_end(),                        // closes turn 0
        assistant_turn_start(),                      // turn 1 opens
        tool_exec_complete("tc-1", "file contents"), // should be turn 0
        assistant_message("Done"),                   // turn 1
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "tool_call"));
    // tool_result for tc-1 should be turn 0 (where the start was)
    assert_eq!(map[2], (Some(0), "tool_result"));
    assert_eq!(map[3], (Some(1), "assistant_message"));
}
