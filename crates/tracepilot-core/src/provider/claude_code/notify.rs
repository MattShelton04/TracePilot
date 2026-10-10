//! `<task-notification>` blocks: a subagent or background shell finished.
//!
//! One completion can arrive in a `user` record, a `queue-operation` and an
//! `attachment:queued_command`. Callers de-duplicate by [`TaskNotification::key`].

use crate::models::event_types::{TaskNotificationData, TaskNotificationKind};

/// One parsed `<task-notification>…</task-notification>` block.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct TaskNotification {
    /// The block as written, used as the notification content.
    pub(super) text: String,
    pub(super) task_id: Option<String>,
    pub(super) tool_use_id: Option<String>,
    pub(super) status: Option<String>,
    pub(super) summary: Option<String>,
    /// The task's final report (`<result>`), when there is one.
    pub(super) result: Option<String>,
    pub(super) output_file: Option<String>,
    /// A shell's exit code, read from its summary
    /// (`… completed (exit code 0)`).
    pub(super) exit_code: Option<i32>,
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

    /// The structured form carried on the `user.message` the block opens.
    pub(super) fn to_data(&self, kind: TaskNotificationKind) -> TaskNotificationData {
        TaskNotificationData {
            task_id: self.task_id.clone(),
            tool_use_id: self.tool_use_id.clone(),
            kind,
            status: self.status.clone(),
            summary: self.summary.clone(),
            result: self.result.clone(),
            output_file: self.output_file.clone(),
            exit_code: self.exit_code,
            total_tokens: self.total_tokens,
            tool_uses: self.tool_uses,
            duration_ms: self.duration_ms,
        }
    }

    /// One short readable line for the block:
    /// `Agent "Map it" finished · 180k tokens · 40 tool uses · 10m`.
    pub(super) fn readable_line(&self, kind: TaskNotificationKind) -> String {
        let head = self.summary.clone().unwrap_or_else(|| {
            let status = self.status.as_deref().unwrap_or("finished");
            match kind {
                TaskNotificationKind::Agent => format!("Agent {status}"),
                TaskNotificationKind::Shell => format!("Background command {status}"),
            }
        });
        let mut parts = vec![head];
        if let Some(tokens) = self.total_tokens {
            parts.push(format!("{} tokens", compact_count(tokens)));
        }
        if let Some(uses) = self.tool_uses {
            let noun = if uses == 1 { "tool use" } else { "tool uses" };
            parts.push(format!("{uses} {noun}"));
        }
        if let Some(ms) = self.duration_ms {
            parts.push(compact_duration(ms));
        }
        parts.join(" · ")
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
        // The report is free text: read the other tags without it, so a
        // `<summary>` quoted in the report can't stand in for the block's own.
        let (fields, result) = split_result(body);
        let fields = fields.as_str();
        let number = |tag: &str| tag_value(fields, tag).and_then(|v| v.trim().parse().ok());
        let summary = tag_value(fields, "summary");
        out.push(TaskNotification {
            text: rest[start..block_end].to_string(),
            task_id: tag_value(fields, "task-id"),
            tool_use_id: tag_value(fields, "tool-use-id"),
            status: tag_value(fields, "status"),
            exit_code: summary.as_deref().and_then(exit_code),
            summary,
            result: result
                .map(|r| decode_entities(r.trim()))
                .filter(|r| !r.is_empty()),
            output_file: tag_value(fields, "output-file"),
            total_tokens: number("subagent_tokens").or_else(|| number("total_tokens")),
            tool_uses: number("tool_uses"),
            duration_ms: number("duration_ms"),
        });
        rest = &rest[block_end..];
    }
    out
}

const RESULT_OPEN: &str = "<result>";
const RESULT_CLOSE: &str = "</result>";

/// `body` without its `<result>…</result>` span, and the span's text. The
/// span runs to the last `</result>` (or the end of an unterminated block),
/// so a closing tag quoted in the report doesn't end it early.
fn split_result(body: &str) -> (String, Option<&str>) {
    let Some(open) = body.find(RESULT_OPEN) else {
        return (body.to_string(), None);
    };
    let start = open + RESULT_OPEN.len();
    let (result, after) = match body[start..].rfind(RESULT_CLOSE) {
        Some(end) => (&body[start..start + end], start + end + RESULT_CLOSE.len()),
        None => (&body[start..], body.len()),
    };
    (format!("{}{}", &body[..open], &body[after..]), Some(result))
}

/// `exit code N` in a shell's summary.
fn exit_code(summary: &str) -> Option<i32> {
    const MARKER: &str = "exit code ";
    let rest = summary[summary.find(MARKER)? + MARKER.len()..].trim_start();
    let len = rest
        .char_indices()
        .take_while(|&(i, c)| c.is_ascii_digit() || (i == 0 && c == '-'))
        .count();
    rest[..len].parse().ok()
}

/// `9600` → `9.6k`, `180000` → `180k`, `1260000` → `1.3M`.
fn compact_count(n: u64) -> String {
    let scaled = |value: f64, unit: &str| {
        let text = if value >= 100.0 {
            format!("{value:.0}")
        } else {
            format!("{value:.1}")
        };
        format!("{}{unit}", text.trim_end_matches(".0"))
    };
    match n {
        0..1_000 => n.to_string(),
        1_000..1_000_000 => scaled(n as f64 / 1e3, "k"),
        _ => scaled(n as f64 / 1e6, "M"),
    }
}

/// `9000` → `9s`, `600000` → `10m`, `150000` → `2m 30s`, `3900000` → `1h 5m`.
fn compact_duration(ms: u64) -> String {
    let secs = (ms + 500) / 1000;
    let (hours, mins, secs) = (secs / 3600, secs % 3600 / 60, secs % 60);
    match (hours, mins, secs) {
        (0, 0, s) => format!("{s}s"),
        (0, m, 0) => format!("{m}m"),
        (0, m, s) => format!("{m}m {s}s"),
        (h, 0, _) => format!("{h}h"),
        (h, m, _) => format!("{h}h {m}m"),
    }
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
    fn parses_result_output_file_and_exit_code() {
        let text = "<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n\
            <output-file>C:\\tmp\\tasks\\a1.output</output-file>\n<status>completed</status>\n\
            <summary>Agent \"Map it\" finished</summary>\n\
            <result>The map has &lt;3&gt; stages.\n\nDone.</result>\n\
            <usage><subagent_tokens>180000</subagent_tokens><tool_uses>40</tool_uses>\
            <duration_ms>600000</duration_ms></usage>\n</task-notification>";
        let note = &parse_notifications(text)[0];
        assert_eq!(
            note.result.as_deref(),
            Some("The map has <3> stages.\n\nDone.")
        );
        assert_eq!(
            note.output_file.as_deref(),
            Some("C:\\tmp\\tasks\\a1.output")
        );
        assert_eq!(note.exit_code, None);
        assert_eq!(note.total_tokens, Some(180_000));

        let shell = "<task-notification><task-id>b1</task-id><status>failed</status>\
            <summary>Background command \"npm test\" failed with exit code 1</summary>\
            </task-notification><task-notification><task-id>b2</task-id>\
            <summary>Background command \"x\" completed (exit code -2)</summary></task-notification>";
        let parsed = parse_notifications(shell);
        assert_eq!(parsed[0].exit_code, Some(1));
        assert_eq!(parsed[0].result, None);
        assert_eq!(parsed[1].exit_code, Some(-2));
        assert_eq!(exit_code("exit code"), None);
        assert_eq!(exit_code("no code here"), None);
    }

    #[test]
    fn tags_inside_the_result_never_stand_in_for_the_blocks_own() {
        // The report quotes tags of its own before the real summary and
        // usage, and even a stray closing tag.
        let text = "<task-notification><task-id>a1</task-id>\
            <result>I saw <summary>quoted summary</summary> and <status>failed</status> \
            and <subagent_tokens>1</subagent_tokens> and </result> mid-text.</result>\
            <status>completed</status><summary>Agent \"real\" finished</summary>\
            <usage><subagent_tokens>900</subagent_tokens></usage></task-notification>";
        let note = &parse_notifications(text)[0];
        assert_eq!(note.summary.as_deref(), Some("Agent \"real\" finished"));
        assert_eq!(note.status.as_deref(), Some("completed"));
        assert_eq!(note.total_tokens, Some(900));
        let result = note.result.as_deref().unwrap();
        assert!(result.starts_with("I saw <summary>quoted summary</summary>"));
        assert!(result.ends_with("</result> mid-text."));

        // A block cut mid-report keeps what was written.
        let cut = "<task-notification><summary>s</summary><result>partial";
        let note = &parse_notifications(cut)[0];
        assert_eq!(note.result.as_deref(), Some("partial"));
        assert_eq!(note.summary.as_deref(), Some("s"));
    }

    #[test]
    fn readable_line_names_the_task_and_its_totals() {
        let agent = TaskNotification {
            summary: Some("Agent \"Map it\" finished".into()),
            total_tokens: Some(180_000),
            tool_uses: Some(40),
            duration_ms: Some(600_000),
            ..Default::default()
        };
        assert_eq!(
            agent.readable_line(TaskNotificationKind::Agent),
            "Agent \"Map it\" finished · 180k tokens · 40 tool uses · 10m"
        );
        let bare = TaskNotification {
            status: Some("stopped".into()),
            tool_uses: Some(1),
            ..Default::default()
        };
        assert_eq!(
            bare.readable_line(TaskNotificationKind::Shell),
            "Background command stopped · 1 tool use"
        );
        assert_eq!(
            TaskNotification::default().readable_line(TaskNotificationKind::Agent),
            "Agent finished"
        );

        assert_eq!(compact_count(999), "999");
        assert_eq!(compact_count(9_600), "9.6k");
        assert_eq!(compact_count(12_000), "12k");
        assert_eq!(compact_count(1_260_000), "1.3M");
        assert_eq!(compact_duration(400), "0s");
        assert_eq!(compact_duration(9_000), "9s");
        assert_eq!(compact_duration(150_000), "2m 30s");
        assert_eq!(compact_duration(3_600_000), "1h");
        assert_eq!(compact_duration(3_900_000), "1h 5m");
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
