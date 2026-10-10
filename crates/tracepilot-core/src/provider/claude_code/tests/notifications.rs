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
        2,
        "the prompt and the wake; the busy notification opens none"
    );
    let wake = users[1];
    assert_eq!(
        wake.user_message.as_deref(),
        Some(
            "Agent \"Map the indexer\" finished · 180k tokens · 40 tool uses · 10m\n\
             Background command \"npm run build\" failed with exit code 2"
        )
    );
    assert!(wake.system_initiated);
    assert!(users[0].notifications.is_empty());

    // Nothing is lost: the record as written stays in the transformed message.
    let raw = wake.transformed_user_message.as_deref().unwrap();
    assert!(raw.starts_with("<task-notification>\n<task-id>a1</task-id>"));
    assert!(raw.contains("<task-id>bsh1</task-id>"));

    let [agent, shell] = wake.notifications.as_slice() else {
        panic!("two notifications, got {:?}", wake.notifications);
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
    // Queued and delivered copies count once.
    assert_eq!(notes.len(), 3);
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
        2,
        "a busy session's notification is no user message"
    );
    assert_eq!(messages[1].source.as_deref(), Some("system"));
    assert_eq!(messages[1].notifications.len(), 2);
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
}
