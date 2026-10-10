//! `<task-notification>` blocks: a subagent or background shell finished,
//! or a `Monitor` reported an event.
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
    /// A `Monitor` event's payload (`<event>`).
    pub(super) event: Option<String>,
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

    /// De-duplication key of an agent's completion: (task id, block text).
    /// A resumed agent completes again with the same task and status, but
    /// the carriers of one completion repeat its block.
    pub(super) fn completion_key(&self) -> (String, String) {
        (self.key().0, self.text.trim().to_string())
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
            event: self.event.clone(),
            output_file: self.output_file.clone(),
            exit_code: self.exit_code,
            total_tokens: self.total_tokens,
            tool_uses: self.tool_uses,
            duration_ms: self.duration_ms,
        }
    }

    /// A `Monitor` notification: it carries an event, or its summary says so
    /// (`Monitor event: "…"`, or a stream that ended without one).
    pub(super) fn is_monitor(&self) -> bool {
        self.event.is_some()
            || self
                .summary
                .as_deref()
                .is_some_and(|s| s.starts_with("Monitor "))
    }

    /// One short readable line for the block:
    /// `Agent "Map it" finished · 180K tokens · 40 tool uses · 10m`, or for a
    /// Monitor event its summary and the event's first line.
    pub(super) fn readable_line(&self, kind: TaskNotificationKind) -> String {
        let head = self.summary.clone().unwrap_or_else(|| {
            let status = self.status.as_deref().unwrap_or("finished");
            match kind {
                TaskNotificationKind::Agent => format!("Agent {status}"),
                TaskNotificationKind::Shell => format!("Background command {status}"),
                TaskNotificationKind::Monitor => "Monitor event".to_string(),
            }
        });
        let mut parts = vec![head];
        if let Some(event) = self.event.as_deref().and_then(first_line) {
            parts.push(event);
        }
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

/// Whether `text` is nothing but notification blocks (and whitespace), as
/// Claude Code writes a wake record, rather than prose that quotes one.
pub(super) fn only_notifications(text: &str) -> bool {
    let mut rest = text;
    while let Some(start) = rest.find(OPEN) {
        if !rest[..start].trim().is_empty() {
            return false;
        }
        match rest[start..].find(CLOSE) {
            Some(end) => rest = &rest[start + end + CLOSE.len()..],
            None => return true,
        }
    }
    rest.trim().is_empty() && text.contains(OPEN)
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
        // The report and the event are free text: read the other tags without
        // them, so a `<summary>` quoted in either can't stand in for the
        // block's own.
        let (fields, result) = split_span(body, "result");
        let (fields, event) = split_span(&fields, "event");
        let free_text = |span: Option<&str>| {
            span.map(|t| decode_entities(t.trim()))
                .filter(|t| !t.is_empty())
        };
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
            result: free_text(result),
            event: free_text(event),
            output_file: tag_value(fields, "output-file"),
            total_tokens: number("subagent_tokens").or_else(|| number("total_tokens")),
            tool_uses: number("tool_uses"),
            duration_ms: number("duration_ms"),
        });
        rest = &rest[block_end..];
    }
    out
}

/// `body` without its `<tag>…</tag>` span, and the span's text. The span
/// runs to the last `</tag>` (or the end of an unterminated block), so a
/// closing tag quoted in free text doesn't end it early.
pub(super) fn split_span<'b>(body: &'b str, tag: &str) -> (String, Option<&'b str>) {
    let (open_tag, close_tag) = (format!("<{tag}>"), format!("</{tag}>"));
    let Some(open) = body.find(&open_tag) else {
        return (body.to_string(), None);
    };
    let start = open + open_tag.len();
    let (span, after) = match body[start..].rfind(&close_tag) {
        Some(end) => (&body[start..start + end], start + end + close_tag.len()),
        None => (&body[start..], body.len()),
    };
    (format!("{}{}", &body[..open], &body[after..]), Some(span))
}

/// The first non-blank line of `text`, cut to [`LINE_CHARS`] characters.
pub(super) fn first_line(text: &str) -> Option<String> {
    const LINE_CHARS: usize = 160;
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(match line.char_indices().nth(LINE_CHARS) {
        Some((cut, _)) => format!("{}…", &line[..cut]),
        None => line.to_string(),
    })
}

/// `exit code N` in a shell's summary.
pub(super) fn exit_code(summary: &str) -> Option<i32> {
    const MARKER: &str = "exit code ";
    let rest = summary[summary.find(MARKER)? + MARKER.len()..].trim_start();
    let len = rest
        .char_indices()
        .take_while(|&(i, c)| c.is_ascii_digit() || (i == 0 && c == '-'))
        .count();
    rest[..len].parse().ok()
}

/// `9600` → `9.6K`, `180000` → `180K`, `1260000` → `1.3M`, as the app's
/// `formatNumber` writes them.
pub(super) fn compact_count(n: u64) -> String {
    let scaled = |value: f64, unit: &str| {
        let text = format!("{value:.1}");
        format!("{}{unit}", text.trim_end_matches(".0"))
    };
    match n {
        0..1_000 => n.to_string(),
        1_000..1_000_000 => scaled(n as f64 / 1e3, "K"),
        _ => scaled(n as f64 / 1e6, "M"),
    }
}

/// `9000` → `9s`, `600000` → `10m`, `150000` → `2m 30s`, `3900000` → `1h 5m`.
/// The Conversation card's `compactDuration` writes the same.
pub(super) fn compact_duration(ms: u64) -> String {
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
