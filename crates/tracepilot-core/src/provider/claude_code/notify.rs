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
    Some(decode_entities(body[start..end].trim())).filter(|v| !v.is_empty())
}

/// Decodes XML character references (`&lt;`, `&#62;`, `&#x3E;`, …) in one
/// left-to-right pass, so `&amp;gt;` becomes `&gt;`, not `>`. Anything that
/// isn't a well-formed reference is kept as written.
fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 1..];
        let decoded = after
            .find(';')
            .filter(|&semi| semi <= 8)
            .and_then(|semi| Some((entity_char(&after[..semi])?, semi)));
        match decoded {
            Some((ch, semi)) => {
                out.push(ch);
                rest = &after[semi + 1..];
            }
            None => {
                out.push('&');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn entity_char(name: &str) -> Option<char> {
    match name {
        "lt" => Some('<'),
        "gt" => Some('>'),
        "amp" => Some('&'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => {
            let digits = name.strip_prefix('#')?;
            let (digits, radix) = match digits.strip_prefix(['x', 'X']) {
                Some(hex) => (hex, 16),
                None => (digits, 10),
            };
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return None;
            }
            let code = u32::from_str_radix(digits, radix).ok()?;
            char::from_u32(code)
        }
    }
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

    #[test]
    fn decodes_xml_entities_in_tag_values_once() {
        // Claude Code escapes tag text the way XML does.
        let text = "<task-notification>\n<task-id>b3</task-id>\n<status>completed</status>\n\
            <summary>Background command \"uv run x &gt; out.txt &amp;&amp; echo &lt;ok&gt;\" \
            completed (exit code 0)</summary>\n</task-notification>";
        let note = &parse_notifications(text)[0];
        assert_eq!(
            note.summary.as_deref(),
            Some("Background command \"uv run x > out.txt && echo <ok>\" completed (exit code 0)")
        );
        // The block itself stays as written.
        assert!(note.text.contains("&gt; out.txt"));

        // Quotes, apostrophes and numeric references; an escaped entity
        // decodes one level only.
        let text = "<task-notification><task-id>b4</task-id><summary>&quot;a&quot; &apos;b&apos; \
            &#60;c&#x3E; &#65; &amp;gt; &amp;amp;</summary></task-notification>";
        assert_eq!(
            parse_notifications(text)[0].summary.as_deref(),
            Some("\"a\" 'b' <c> A &gt; &amp;")
        );
    }

    #[test]
    fn leaves_unknown_or_malformed_entities_alone() {
        let text = "<task-notification><summary>AT&T &nbsp; &#xZZ; &#; &#+65; &#1114112; &amp</summary>\
            </task-notification>";
        assert_eq!(
            parse_notifications(text)[0].summary.as_deref(),
            Some("AT&T &nbsp; &#xZZ; &#; &#+65; &#1114112; &amp")
        );
    }
}
