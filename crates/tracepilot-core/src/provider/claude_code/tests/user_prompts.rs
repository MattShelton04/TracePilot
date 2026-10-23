//! User prompts and attachments: known attachment types and prompts sent
//! mid-turn (`translate_user`).

use serde_json::json;
use tracepilot_test_support::claude::{Transcript, Usage, image, text, tool_use, write_session};

use super::super::parse_claude_session;
use crate::turns::reconstruct_turns;

/// Hook context and the skills re-sent after a compaction carry nothing
/// TracePilot shows: they are known types, kept on the Events tab, and
/// open no turn. An unlisted type is still counted.
#[test]
fn hook_context_and_invoked_skills_are_known_attachments() {
    let mut main = Transcript::main();
    main.prompt("hello");
    main.record(
        "attachment",
        json!({"attachment": {
            "type": "hook_additional_context",
            "content": ["Synthetic hook context"],
            "hookName": "SessionStart:startup",
            "toolUseID": "SessionStart",
            "hookEvent": "SessionStart",
        }}),
    );
    main.record(
        "attachment",
        json!({"attachment": {
            "type": "invoked_skills",
            "skills": [{
                "name": "demo-skill",
                "path": "C:/work/demo/.claude/skills/demo-skill/SKILL.md",
                "content": "Synthetic skill body",
            }],
        }}),
    );
    main.record(
        "attachment",
        json!({"attachment": {"type": "brand_new_attachment"}}),
    );
    let files = write_session(&main, &[]);
    let parsed = parse_claude_session(&files.main, &|| false).unwrap();

    let unknown: Vec<_> = parsed.diagnostics.unknown_attachment_types.keys().collect();
    assert_eq!(unknown, ["brand_new_attachment"]);
    let natives: Vec<_> = parsed
        .events
        .iter()
        .filter_map(|e| e.raw.native.as_ref())
        .map(|n| n.data["attachment"]["type"].as_str().unwrap_or(""))
        .collect();
    assert!(natives.contains(&"hook_additional_context"));
    assert!(natives.contains(&"invoked_skills"));
    let turns = reconstruct_turns(&parsed.events);
    assert_eq!(turns.iter().filter(|t| t.user_message.is_some()).count(), 1);
}

/// A prompt sent while the model works is only a `queued_command`
/// attachment. It opens a steering turn, in the same interaction, before
/// the reply that answers it, and its pasted image becomes an attachment
/// that says where to read the picture back.
#[test]
fn mid_turn_prompts_open_steering_turns() {
    let opus = "claude-opus-4-8";
    let usage = || Usage::new(2, 20, 0, 2);
    let mut main = Transcript::main();
    main.prompt("fix the costs");
    main.call(
        "msg_1",
        opus,
        vec![tool_use("toolu_1", "Bash", json!({"command": "ls"}))],
        usage(),
        "tool_use",
    );
    main.tool_result("toolu_1", json!("a.ts"), json!({"stdout": "a.ts"}), false);
    let queued = |prompt| {
        json!({"attachment": {
            "type": "queued_command", "prompt": prompt, "commandMode": "prompt",
            "origin": {"kind": "human"}, "humanTurn": true,
        }})
    };
    main.record("attachment", queued(json!("also check the totals")));
    main.call(
        "msg_2",
        opus,
        vec![tool_use("toolu_2", "Bash", json!({"command": "ls"}))],
        usage(),
        "tool_use",
    );
    main.tool_result("toolu_2", json!("b.ts"), json!({"stdout": "b.ts"}), false);
    main.record(
        "attachment",
        queued(json!([
            image("iVBORw0KGgo="),
            text("the hover dot is off, see the screenshot")
        ])),
    );
    main.call(
        "msg_3",
        opus,
        vec![text("Got it, fixing the dot too.")],
        usage(),
        "end_turn",
    );
    let files = write_session(&main, &[]);
    let parsed = parse_claude_session(&files.main, &|| false).unwrap();
    let turns = reconstruct_turns(&parsed.events);

    let prompts: Vec<_> = turns
        .iter()
        .map(|t| {
            (
                t.user_message.as_deref(),
                t.user_message_delivery.as_deref(),
            )
        })
        .collect();
    assert_eq!(
        prompts,
        [
            (Some("fix the costs"), None),
            (Some("also check the totals"), Some("steering")),
            (
                Some("the hover dot is off, see the screenshot"),
                Some("steering")
            ),
        ]
    );
    assert!(turns.iter().all(|t| !t.system_initiated));
    assert!(
        turns
            .iter()
            .all(|t| t.interaction_id == turns[0].interaction_id),
        "steering stays in the prompt's interaction"
    );
    assert_eq!(
        turns[2].assistant_messages[0].content,
        "Got it, fixing the dot too."
    );
    let attachments = turns[2].attachments.as_deref().unwrap();
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments[0]["type"], "image");
    assert_eq!(attachments[0]["mediaType"], "image/png");
    assert_eq!(attachments[0]["line"], 7);
    assert_eq!(attachments[0]["pointer"], "/attachment/prompt/0");
}

/// A local command's printed output is tagged and follows its command, which
/// it completes. A prompt command's expansion (an `isMeta` record) is sent
/// to the model instead: interrupted before the reply, its turn is
/// incomplete and shows no output.
#[test]
fn only_printed_command_output_is_tagged_as_output() {
    let mut main = Transcript::main();
    main.next_prompt_id();
    main.user(json!({"message": {"role": "user", "content":
        "<command-name>/cost</command-name>\n<command-message>cost</command-message>\n<command-args></command-args>"}}));
    main.user(json!({"message": {"role": "user", "content":
        "<local-command-stderr>Error: no usage yet</local-command-stderr>"}}));
    main.next_prompt_id();
    main.user(json!({"message": {"role": "user", "content":
        "<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args>57</command-args>"}}));
    main.meta("Review pull request 57.", None);
    main.user(json!({"message": {"role": "user", "content": "[Request interrupted by user]"}}));
    let files = write_session(&main, &[]);
    let parsed = parse_claude_session(&files.main, &|| false).unwrap();

    let names: Vec<_> = parsed
        .events
        .iter()
        .filter(|e| e.raw.event_type == "system.message")
        .map(|e| e.raw.data.get("name").and_then(|n| n.as_str()))
        .collect();
    assert_eq!(names, [Some("command-output"), None]);
    let turns = reconstruct_turns(&parsed.events);
    let commands: Vec<_> = turns.iter().filter(|t| t.user_message.is_some()).collect();
    assert_eq!(commands.len(), 2);
    assert_eq!(commands[0].system_messages, ["Error: no usage yet"]);
    assert_eq!(commands[0].command_output_event_indices.len(), 1);
    assert!(commands[0].is_complete);
    assert_eq!(commands[1].system_messages, ["Review pull request 57."]);
    assert!(commands[1].command_output_event_indices.is_empty());
    assert!(!commands[1].is_complete);
}
