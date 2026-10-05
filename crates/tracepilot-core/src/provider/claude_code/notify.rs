//! `<task-notification>` blocks: a subagent or background shell finished.
//!
//! One completion can arrive in a `user` record, a `queue-operation` and an
//! `attachment:queued_command`. Callers de-duplicate by [`TaskNotification::key`].

/// One parsed `<task-notification>…</task-notification>` block.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct TaskNotification {
    /// The block as written, used as the notification content.
    pub(super) text: String,
    pub(super) task_id: Option<String>,
    pub(super) tool_use_id: Option<String>,
    pub(super) status: Option<String>,
    pub(super) summary: Option<String>,
    pub(super) total_tokens: Option<u64>,
    pub(super) tool_uses: Option<u64>,
    pub(super) duration_ms: Option<u64>,
}

impl TaskNotification {
    /// De-duplication key: (task or tool-use id, status).
    pub(super) fn key(&self) -> (String, String) {
        (
            self.task_id
                .clone()
                .or_else(|| self.tool_use_id.clone())
                .unwrap_or_default(),
            self.status.clone().unwrap_or_default(),
        )
    }
}

const OPEN: &str = "<task-notification>";
const CLOSE: &str = "</task-notification>";

pub(super) fn contains_notification(text: &str) -> bool {
    text.contains(OPEN)
}

/// Every notification block in `text`, in order. An unterminated block (a
/// live file cut mid-write) runs to the end of the text.
pub(super) fn parse_notifications(text: &str) -> Vec<TaskNotification> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        let body_start = start + OPEN.len();
        let (body, block_end) = match rest[body_start..].find(CLOSE) {
            Some(end) => (
                &rest[body_start..body_start + end],
                body_start + end + CLOSE.len(),
            ),
            None => (&rest[body_start..], rest.len()),
        };
        let number = |tag: &str| tag_value(body, tag).and_then(|v| v.trim().parse().ok());
        out.push(TaskNotification {
            text: rest[start..block_end].to_string(),
            task_id: tag_value(body, "task-id"),
            tool_use_id: tag_value(body, "tool-use-id"),
            status: tag_value(body, "status"),
            summary: tag_value(body, "summary"),
            total_tokens: number("subagent_tokens").or_else(|| number("total_tokens")),
            tool_uses: number("tool_uses"),
            duration_ms: number("duration_ms"),
        });
        rest = &rest[block_end..];
    }
    out
}

fn tag_value(body: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = body.find(&open)? + open.len();
    let end = body[start..].find(&close)? + start;
    Some(body[start..end].trim().to_string()).filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fields_and_multiple_blocks() {
        let text = "<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n\
            <status>completed</status>\n<summary>Agent \"x\" finished</summary>\n\
            <usage><subagent_tokens>180</subagent_tokens><tool_uses>4</tool_uses>\
            <duration_ms>600</duration_ms></usage>\n</task-notification>\n\
            <task-notification><task-id>b2</task-id><status>failed</status>";
        let parsed = parse_notifications(text);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].task_id.as_deref(), Some("a1"));
        assert_eq!(parsed[0].tool_use_id.as_deref(), Some("toolu_1"));
        assert_eq!(parsed[0].total_tokens, Some(180));
        assert_eq!(parsed[0].tool_uses, Some(4));
        assert_eq!(parsed[0].duration_ms, Some(600));
        assert!(parsed[0].text.ends_with(CLOSE));
        assert_eq!(parsed[1].key(), ("b2".into(), "failed".into()));
        assert!(parse_notifications("no notification").is_empty());
    }
}
