//! Task notifications that wake an idle session (mapping.md §1.1).

use tracepilot_test_support::claude_scenarios as fixtures;

use super::{parse, user_turns};
use crate::models::event_types::TaskNotificationKind;
use crate::parsing::events::TypedEventData;
use crate::turns::reconstruct_turns;

#[test]
fn a_wake_turn_reads_as_one_line_per_notification() {
    let parsed = parse(&fixtures::notification_wake());
    let turns = reconstruct_turns(&parsed.events);
    let users = user_turns(&turns);
    assert_eq!(
        users.len(),
        3,
        "the prompt, the wake and the quoting prompt; the busy notification opens none"
    );
    let wake = users[1];
    assert_eq!(
        wake.user_message.as_deref(),
        Some(
            "Agent \"Map the indexer\" finished · 180K tokens · 40 tool uses · 10m\n\
             Background command \"npm run build\" failed with exit code 2\n\
             Monitor event: \"PR #12 check results\" · Quality gate: pass"
        )
    );
    assert!(wake.system_initiated);
    assert!(users[0].notifications.is_empty());

    // Nothing is lost: the record as written stays in the transformed message.
    let raw = wake.transformed_user_message.as_deref().unwrap();
    assert!(raw.starts_with("<task-notification>\n<task-id>a1</task-id>"));
    assert!(raw.contains("<task-id>bsh1</task-id>"));

    let [agent, shell, monitor] = wake.notifications.as_slice() else {
        panic!("three notifications, got {:?}", wake.notifications);
    };
    assert_eq!(agent.kind, TaskNotificationKind::Agent);
    assert_eq!(agent.task_id.as_deref(), Some("a1"));
    assert_eq!(agent.tool_use_id.as_deref(), Some("toolu_ag1"));
    assert_eq!(agent.status.as_deref(), Some("completed"));
    assert_eq!(
        agent.summary.as_deref(),
        Some("Agent \"Map the indexer\" finished")
    );
    assert_eq!(
        agent.result.as_deref(),
        Some("The indexer has **three** stages.")
    );
    assert_eq!(
        agent.output_file.as_deref(),
        Some("C:\\tmp\\tasks\\a1.output")
    );
    assert_eq!(
        (agent.total_tokens, agent.tool_uses, agent.duration_ms),
        (Some(180_000), Some(40), Some(600_000))
    );
    assert_eq!(agent.exit_code, None);

    assert_eq!(shell.kind, TaskNotificationKind::Shell);
    assert_eq!(shell.tool_use_id.as_deref(), Some("toolu_sh1"));
    assert_eq!(shell.status.as_deref(), Some("failed"));
    assert_eq!(shell.exit_code, Some(2));
    assert_eq!(shell.result, None);
    assert_eq!(shell.total_tokens, None);

    assert_eq!(monitor.kind, TaskNotificationKind::Monitor);
    assert_eq!(monitor.tool_use_id.as_deref(), Some("toolu_mon1"));
    assert_eq!(
        monitor.event.as_deref(),
        Some("Quality gate: pass\nlint: ok")
    );
    assert_eq!(monitor.status, None);
}

#[test]
fn a_typed_prompt_that_quotes_a_block_keeps_its_text() {
    let parsed = parse(&fixtures::notification_wake());
    let turns = reconstruct_turns(&parsed.events);
    let quoted = user_turns(&turns)[2];
    let text = quoted.user_message.as_deref().unwrap();
    assert!(text.starts_with("Why did this fail?\n<task-notification>"));
    assert!(quoted.notifications.is_empty());
    assert_eq!(quoted.transformed_user_message, None);
}

#[test]
fn notification_events_keep_the_block_as_written() {
    let parsed = parse(&fixtures::notification_wake());
    let notes: Vec<&str> = parsed
        .events
        .iter()
        .filter(|e| e.raw.event_type == "system.notification")
        .map(|e| e.raw.data["content"].as_str().unwrap())
        .collect();
    // Queued, delivered and quoted copies count once.
    assert_eq!(notes.len(), 4);
    assert!(notes.iter().all(|n| n.starts_with("<task-notification>")));

    let messages: Vec<_> = parsed
        .events
        .iter()
        .filter_map(|e| match &e.typed_data {
            TypedEventData::UserMessage(data) => Some(data),
            _ => None,
        })
        .collect();
    assert_eq!(
        messages.len(),
        3,
        "a busy session's notification is no user message"
    );
    assert_eq!(messages[1].source.as_deref(), Some("system"));
    assert_eq!(messages[1].notifications.len(), 3);
}

#[test]
fn a_typed_prompt_serializes_without_notifications() {
    let parsed = parse(&fixtures::notification_wake());
    let turns = reconstruct_turns(&parsed.events);
    let prompt = serde_json::to_value(user_turns(&turns)[0]).unwrap();
    assert!(prompt.get("notifications").is_none());
    let wake = serde_json::to_value(user_turns(&turns)[1]).unwrap();
    assert_eq!(wake["notifications"][0]["kind"], "agent");
    assert_eq!(wake["notifications"][1]["exitCode"], 2);
    assert_eq!(wake["notifications"][1]["toolUseId"], "toolu_sh1");
    assert!(wake["notifications"][1].get("result").is_none());
    assert_eq!(wake["notifications"][2]["kind"], "monitor");
    assert_eq!(
        wake["notifications"][2]["event"],
        "Quality gate: pass\nlint: ok"
    );
}

#[test]
fn background_shells_settle_on_their_launching_call() {
    let parsed = parse(&fixtures::notification_wake());
    let turns = reconstruct_turns(&parsed.events);
    let call = |id: &str| {
        turns
            .iter()
            .flat_map(|t| &t.tool_calls)
            .find(|tc| tc.tool_call_id.as_deref() == Some(id))
            .unwrap_or_else(|| panic!("tool call {id}"))
    };
    let failed = call("toolu_sh1");
    let args = failed.arguments.as_ref().unwrap();
    assert_eq!(
        (args["shellId"].as_str(), args["mode"].as_str()),
        (Some("bsh1"), Some("background"))
    );
    let outcome = failed.background_outcome.as_ref().expect("settled");
    assert_eq!(
        (outcome.status.as_str(), outcome.exit_code),
        ("failed", Some(2))
    );
    // The launch itself returned at once and stays a success.
    assert_eq!(
        (failed.success, failed.is_complete, failed.exit_code),
        (Some(true), true, None)
    );

    // The rebuild finishes while the model is busy: it opens no turn but still settles.
    let rebuilt = call("toolu_sh2")
        .background_outcome
        .as_ref()
        .expect("settled");
    assert_eq!(
        (rebuilt.status.as_str(), rebuilt.exit_code),
        ("completed", Some(0))
    );
    assert!(
        rebuilt.completed_at.is_some(),
        "the notification record's time"
    );

    // A Monitor reports through the same notification but starts no shell.
    assert!(call("toolu_mon1").background_outcome.is_none());
    // Agents keep settling through their subagent events.
    assert!(call("toolu_ag1").background_outcome.is_none());
}
