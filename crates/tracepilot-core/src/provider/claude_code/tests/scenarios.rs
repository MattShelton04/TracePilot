//! Mapping behaviour per fixture (mapping.md §1).

use tracepilot_test_support::claude::OPUS;
use tracepilot_test_support::claude_scenarios as fixtures;

use super::{event_types, parse, user_turns};
use crate::models::{ConversationTurn, TurnToolCall};
use crate::turns::reconstruct_turns;

fn tool_call<'a>(turns: &'a [ConversationTurn], id: &str) -> &'a TurnToolCall {
    turns
        .iter()
        .flat_map(|t| &t.tool_calls)
        .find(|tc| tc.tool_call_id.as_deref() == Some(id))
        .unwrap_or_else(|| panic!("tool call {id}"))
}

fn count(types: &[&str], kind: &str) -> usize {
    types.iter().filter(|t| **t == kind).count()
}

#[test]
fn tool_hazards_map_to_one_turn_per_call() {
    let parsed = parse(&fixtures::tool_hazards());
    let types = event_types(&parsed);
    assert_eq!(types[0], "session.start");
    let start = &parsed.events[0].raw.data;
    assert_eq!(start["producer"], "claude-code");
    assert_eq!(start["selectedModel"], OPUS);
    assert_eq!(start["context"]["cwd"], "C:\\work\\demo");

    let turns = reconstruct_turns(&parsed.events);
    assert_eq!(user_turns(&turns).len(), 1);
    assert_eq!(turns.len(), 3, "one TracePilot turn per API call");
    assert!(turns.iter().all(|t| t.is_complete));
    assert_eq!(count(&types, "assistant.turn_end"), 3);

    let failed = tool_call(&turns, "toolu_t1");
    assert_eq!(failed.tool_name, "shell");
    assert_eq!(failed.native_tool_name.as_deref(), Some("Bash"));
    assert_eq!(failed.success, Some(false));
    assert_eq!(failed.exit_code, Some(1));
    assert!(failed.error.as_deref().unwrap().contains("Exit code 1"));
    assert_eq!(tool_call(&turns, "toolu_t2").success, Some(true));
    assert_eq!(tool_call(&turns, "toolu_t3").success, Some(true));
    assert_eq!(tool_call(&turns, "toolu_t3").exit_code, Some(0));
    assert!(turns.iter().all(|t| t.reasoning_texts.is_empty()));
    assert_eq!(parsed.diagnostics.redacted_thinking, 1);
    assert_eq!(parsed.diagnostics.persisted_outputs, 1);

    // File order wins over the attachment's earlier timestamp.
    let completed = parsed
        .events
        .iter()
        .position(|e| {
            e.raw.data["toolCallId"] == "toolu_t1" && e.raw.event_type == "tool.execution_complete"
        })
        .unwrap();
    let attachment = types
        .iter()
        .position(|t| *t == "attachment:edited_text_file")
        .unwrap();
    assert!(attachment > completed);
    assert!(parsed.events[attachment].raw.timestamp < parsed.events[completed].raw.timestamp);
    // cost-state is metrics, not an event.
    assert!(!types.contains(&"cost-state"));
}

#[test]
fn meta_records_never_open_a_turn() {
    let parsed = parse(&fixtures::meta_records(false));
    let types = event_types(&parsed);
    let turns = reconstruct_turns(&parsed.events);
    let users = user_turns(&turns);
    assert_eq!(users.len(), 1, "only the human prompt opens a user turn");
    assert!(!turns.iter().any(|t| t.system_initiated));

    let skill = tool_call(&turns, "toolu_s1");
    assert_eq!(skill.tool_name, "skill");
    let invocation = skill.skill_invocation.as_ref().expect("skill attached");
    assert_eq!(invocation.name.as_deref(), Some("deploy"));
    assert!(
        invocation.context_folded,
        "skill context folds into the call"
    );

    assert!(
        turns
            .iter()
            .flat_map(|t| &t.system_messages)
            .any(|m| m == "Continue from where you left off.")
    );
    let compaction = parsed
        .events
        .iter()
        .find(|e| e.raw.event_type == "session.compaction_complete")
        .unwrap();
    assert!(
        compaction.raw.data["summaryContent"]
            .as_str()
            .unwrap()
            .starts_with("Summary: deploying")
    );
    assert_eq!(count(&types, "system.notification"), 2);

    let agent = tool_call(&turns, "toolu_ag1");
    assert!(agent.is_subagent);
    assert!(agent.is_complete);
    assert_eq!(agent.agent_status.as_deref(), Some("completed"));
    assert_eq!(agent.total_tokens, Some(180));
    let report = turns
        .iter()
        .flat_map(|t| &t.assistant_messages)
        .filter(|m| m.parent_tool_call_id.as_deref() == Some("toolu_ag1"))
        .count();
    assert_eq!(report, 2, "the subagent's own message and its hand-back");
}

#[test]
fn notification_waking_an_idle_session_opens_one_system_turn() {
    let parsed = parse(&fixtures::meta_records(true));
    let turns = reconstruct_turns(&parsed.events);
    let users = user_turns(&turns);
    assert_eq!(users.len(), 2);
    assert!(!users[0].system_initiated);
    assert!(users[1].system_initiated);
    assert_eq!(count(&event_types(&parsed), "system.notification"), 3);
}

#[test]
fn subagents_attach_to_their_launching_calls() {
    let parsed = parse(&fixtures::subagents());
    let turns = reconstruct_turns(&parsed.events);
    let owner_of = |content: &str| {
        turns
            .iter()
            .flat_map(|t| &t.assistant_messages)
            .find(|m| m.content == content)
            .and_then(|m| m.parent_tool_call_id.clone())
    };
    assert_eq!(owner_of("Indexer mapped.").as_deref(), Some("toolu_A"));
    assert_eq!(owner_of("Exporter mapped.").as_deref(), Some("toolu_B"));
    assert_eq!(owner_of("Tests mapped.").as_deref(), Some("toolu_C"));
    assert_eq!(owner_of("Stray agent.").as_deref(), Some("agentD"));

    let launch = tool_call(&turns, "toolu_A");
    assert!(launch.is_subagent, "Agent maps to task with agent_type");
    assert_eq!(launch.native_tool_name.as_deref(), Some("Agent"));
    let nested = tool_call(&turns, "toolu_C");
    assert!(nested.is_subagent);
    assert_eq!(nested.parent_tool_call_id.as_deref(), Some("toolu_A"));
    assert_eq!(tool_call(&turns, "toolu_A").total_tokens, Some(700));
    assert_eq!(tool_call(&turns, "toolu_B").total_tokens, Some(300));
    assert!(tool_call(&turns, "toolu_A").is_complete);
    assert_eq!(parsed.diagnostics.orphan_subagents, 1);
    assert_eq!(parsed.diagnostics.duplicate_notifications, 2);

    // Each child is one contiguous block right after its launching call.
    let owners: Vec<Option<&str>> = parsed
        .events
        .iter()
        .map(|e| e.raw.agent_id.as_deref())
        .collect();
    let start_of = |id: &str| {
        parsed
            .events
            .iter()
            .position(|e| {
                e.raw.event_type == "tool.execution_start" && e.raw.data["toolCallId"] == id
            })
            .unwrap()
    };
    assert_eq!(owners[start_of("toolu_A") + 1], Some("agentA"));
    assert_eq!(owners[start_of("toolu_B") + 1], Some("agentB"));
    assert_eq!(owners[start_of("toolu_C") + 1], Some("agentC"));
    assert!(
        start_of("toolu_C") < start_of("toolu_B"),
        "nested block sits inside A's"
    );
    assert_eq!(
        owners.last().copied().flatten(),
        Some("agentD"),
        "orphan appended last"
    );
}

#[test]
fn rewound_branch_stays_out_of_conversation() {
    let parsed = parse(&fixtures::rewind_fork());
    let turns = reconstruct_turns(&parsed.events);
    let prompts: Vec<_> = user_turns(&turns)
        .iter()
        .map(|t| t.user_message.clone().unwrap())
        .collect();
    assert_eq!(prompts, ["Write a haiku.", "Make it about snow."]);
    assert_eq!(parsed.diagnostics.abandoned_records, 2);
    let abandoned: Vec<_> = parsed
        .events
        .iter()
        .zip(&parsed.positions)
        .filter(|(_, position)| position.as_ref().is_some_and(|p| p.abandoned))
        .map(|(event, _)| event.raw.native.as_ref().unwrap().record_type.as_str())
        .collect();
    assert_eq!(abandoned, ["user", "assistant"]);
}

#[test]
fn interrupts_missing_results_and_live_eof_set_turn_ends() {
    let parsed = parse(&fixtures::interrupted_and_live());
    let types = event_types(&parsed);
    assert_eq!(count(&types, "abort"), 1);
    assert_eq!(
        count(&types, "assistant.turn_end"),
        1,
        "only the call missing a result"
    );
    assert_eq!(parsed.diagnostics.missing_tool_results, 1);

    let turns = reconstruct_turns(&parsed.events);
    assert_eq!(user_turns(&turns).len(), 3);
    assert!(!turns[0].is_complete, "interrupted");
    assert!(turns[1].is_complete, "ended when the next prompt arrived");
    assert!(!turns[2].is_complete, "live: a tool result is pending");
    assert!(!tool_call(&turns, "toolu_i2").is_complete);
    assert!(!tool_call(&turns, "toolu_i3").is_complete);
}

#[test]
fn compaction_cycle_and_synthetic_rate_limit() {
    let parsed = parse(&fixtures::compaction_cycle());
    assert_eq!(parsed.diagnostics.parent_cycles, 1);
    assert_eq!(parsed.diagnostics.abandoned_records, 0);
    let error = parsed
        .events
        .iter()
        .find(|e| e.raw.event_type == "session.error")
        .unwrap();
    assert_eq!(error.raw.data["errorType"], "rate_limit");
    assert_eq!(error.raw.data["statusCode"], 429);
    assert_eq!(
        parsed.calls.len(),
        1,
        "a synthetic error is not a model call"
    );
    let complete = parsed
        .events
        .iter()
        .find(|e| e.raw.event_type == "session.compaction_complete")
        .unwrap();
    assert_eq!(complete.raw.data["summaryContent"], "Summary: refactoring.");
    assert_eq!(complete.raw.data["preCompactionTokens"], 200_000);

    let turns = reconstruct_turns(&parsed.events);
    assert_eq!(user_turns(&turns).len(), 2);
    assert!(
        turns
            .iter()
            .flat_map(|t| &t.session_events)
            .any(|e| e.event_type == "session.error")
    );
}

#[test]
fn slash_command_opens_a_command_turn_and_its_output_folds() {
    let parsed = parse(&fixtures::slash_command());
    let turns = reconstruct_turns(&parsed.events);
    let users = user_turns(&turns);
    assert_eq!(users.len(), 3);
    assert!(
        !users[1].system_initiated,
        "commands count as typed by the user"
    );
    // The command as typed, and only its unwrapped output: the caveat is for the model.
    assert_eq!(
        users[1].user_message.as_deref(),
        Some("/compact focus on tests")
    );
    assert_eq!(users[1].system_messages, ["Compacted."]);
    let command = parsed
        .events
        .iter()
        .find(|e| e.raw.data["source"] == "command-compact")
        .expect("command user.message");
    assert_eq!(command.raw.event_type, "user.message");
}

/// The S3 census: a typed `/compact` is written as plain text before the
/// compaction, and its `<command-name>` record only after it.
#[test]
fn typed_compact_echo_opens_one_command_turn_holding_the_compaction() {
    let parsed = parse(&fixtures::typed_compact());
    let turns = reconstruct_turns(&parsed.events);
    let users = user_turns(&turns);
    let prompts: Vec<_> = users.iter().map(|t| t.user_message.as_deref()).collect();
    assert_eq!(
        prompts,
        [Some("Start."), Some("/compact"), Some("Continue.")]
    );
    let command = users[1];
    assert!(
        !command.system_initiated,
        "commands count as typed by the user"
    );
    assert!(
        command
            .session_events
            .iter()
            .any(|e| e.event_type == "session.compaction_complete"),
        "the compaction belongs to the command's turn"
    );
    // The caveat and the repeated command record add nothing to read.
    assert_eq!(command.system_messages, ["Compacted."]);
    let sources: Vec<_> = parsed
        .events
        .iter()
        .filter(|e| e.raw.event_type == "user.message")
        .map(|e| e.raw.data["source"].as_str().unwrap_or(""))
        .collect();
    assert_eq!(sources, ["user", "command-compact", "user"]);
}

#[test]
fn commands_only_session_shows_each_command_and_its_plain_output() {
    let parsed = parse(&fixtures::commands_only());
    let turns = reconstruct_turns(&parsed.events);
    let users = user_turns(&turns);
    let prompts: Vec<_> = users.iter().map(|t| t.user_message.as_deref()).collect();
    assert_eq!(prompts, [Some("/model claude-opus-5-5"), Some("/cost")]);
    assert!(users.iter().all(|t| !t.system_initiated));
    assert_eq!(users[0].system_messages, ["Set model to Opus 5.5"]);
    assert_eq!(users[1].system_messages, ["Total cost: $0.00"]);
    // Every record is still on the Events tab.
    let natives = parsed.events.iter().filter(|e| e.raw.native.is_some());
    assert_eq!(natives.count(), 6);
}

/// data-comparison.md rule 11: most subagent calls end with `stop_reason:
/// null`, even the last one before the hand-back. That must not leave the
/// agent, or the parent turn that launched it, looking unfinished.
#[test]
fn a_subagent_ending_on_a_null_stop_reason_still_completes() {
    use serde_json::json;
    use tracepilot_test_support::claude::{
        Subagent, Transcript, Usage, subagent_meta, text, tool_use, write_session,
    };
    let mut t = Transcript::main();
    t.prompt("Map the indexer.");
    let usage = Usage::new(1, 10, 0, 1);
    let input = json!({"subagent_type": "Explore", "description": "indexer", "prompt": "Map it."});
    let launch = vec![tool_use("toolu_N", "Agent", input)];
    t.call("msg_n1", OPUS, launch, usage, "tool_use");
    t.tool_result(
        "toolu_N",
        json!("Async agent launched successfully."),
        json!({"status": "async_launched", "isAsync": true, "agentId": "agentN"}),
        false,
    );
    t.meta(
        "The indexer has three stages.",
        Some(json!({"kind": "peer", "from": "agentN", "handback": true,
            "body": "The indexer has three stages."})),
    );
    t.call(
        "msg_n2",
        OPUS,
        vec![text("Three stages.")],
        usage,
        "end_turn",
    );

    let mut agent = Transcript::subagent("agentN", 1);
    agent.prompt("Map it.");
    let read = vec![tool_use(
        "toolu_Nr",
        "Read",
        json!({"file_path": "src/lib.rs"}),
    )];
    agent.call("msg_s1", OPUS, read, Usage::new(2, 20, 0, 2), None);
    agent.tool_result("toolu_Nr", json!("1\tpub mod index;"), json!(null), false);
    let done = vec![text("Indexer mapped.")];
    agent.call("msg_s2", OPUS, done, Usage::new(2, 20, 0, 2), None);
    let agents = [Subagent {
        agent_id: "agentN",
        transcript: &agent,
        meta: Some(subagent_meta("toolu_N", "Explore", 1)),
    }];
    let parsed = parse(&write_session(&t, &agents));
    let turns = reconstruct_turns(&parsed.events);

    let launched = tool_call(&turns, "toolu_N");
    assert!(launched.is_subagent);
    assert!(launched.is_complete, "the hand-back completes the agent");
    assert_eq!(launched.success, Some(true));
    assert_eq!(launched.agent_status.as_deref(), Some("completed"));
    assert!(tool_call(&turns, "toolu_Nr").is_complete);
    assert!(turns.iter().all(|t| t.is_complete), "no turn left open");
    let last = turns
        .iter()
        .flat_map(|t| &t.assistant_messages)
        .find(|m| m.content == "Indexer mapped.")
        .expect("the subagent's last message");
    assert_eq!(last.parent_tool_call_id.as_deref(), Some("toolu_N"));
}
