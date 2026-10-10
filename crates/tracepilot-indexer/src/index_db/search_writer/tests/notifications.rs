use tracepilot_core::models::event_types::{
    TaskNotificationData, TaskNotificationKind, UserMessageData,
};
use tracepilot_core::parsing::events::TypedEventData;

use super::super::extract_search_content;
use super::helpers::*;

fn note(
    kind: TaskNotificationKind,
    result: Option<&str>,
    event: Option<&str>,
) -> TaskNotificationData {
    TaskNotificationData {
        task_id: None,
        tool_use_id: None,
        kind,
        status: None,
        summary: None,
        result: result.map(str::to_string),
        event: event.map(str::to_string),
        output_file: None,
        exit_code: None,
        total_tokens: None,
        tool_uses: None,
        duration_ms: None,
    }
}

#[test]
fn a_notification_wake_indexes_the_report_and_event_beside_its_line() {
    let mut wake = user_message("Agent \"Map it\" finished\nMonitor event: \"checks\" · pass");
    if let TypedEventData::UserMessage(data) = &mut wake.typed_data {
        *data = UserMessageData {
            notifications: vec![
                note(
                    TaskNotificationKind::Agent,
                    Some("The indexer has three stages."),
                    None,
                ),
                note(TaskNotificationKind::Shell, None, None),
                note(
                    TaskNotificationKind::Monitor,
                    None,
                    Some("Quality gate: pass"),
                ),
            ],
            ..data.clone()
        };
    }
    let rows = extract_search_content(&sid(), &[wake]);
    let found: Vec<(&str, &str)> = rows
        .iter()
        .map(|r| (r.content_type, r.content.as_str()))
        .collect();
    assert_eq!(
        found,
        [
            (
                "user_message",
                "Agent \"Map it\" finished\nMonitor event: \"checks\" · pass"
            ),
            ("system_message", "The indexer has three stages."),
            ("system_message", "Quality gate: pass"),
        ]
    );
    assert!(rows.iter().all(|r| r.event_index == 0));
}
