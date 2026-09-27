//! Golden turn semantics shared with the built Node CLI.

use std::path::PathBuf;

#[test]
fn repeated_prompts_and_same_name_tool_results_preserve_identity()
-> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/versions/cli_turn_parity.jsonl");
    let parsed = tracepilot_core::parsing::events::parse_typed_events(&path)?;
    assert!(!parsed.diagnostics.has_warnings());
    let turns = tracepilot_core::turns::reconstruct_turns(&parsed.events);
    assert_eq!(turns.len(), 2);
    assert_eq!(
        turns[0].user_message.as_deref(),
        Some("Please inspect this.")
    );
    assert_eq!(
        turns[1].user_message.as_deref(),
        Some("Please inspect this.")
    );
    let calls: Vec<_> = turns[0]
        .tool_calls
        .iter()
        .map(|call| {
            (
                call.tool_name.as_str(),
                call.tool_call_id.as_deref(),
                call.success,
            )
        })
        .collect();
    assert_eq!(
        calls,
        vec![
            ("view", Some("call-a"), Some(false)),
            ("view", Some("call-b"), Some(true))
        ]
    );
    Ok(())
}
