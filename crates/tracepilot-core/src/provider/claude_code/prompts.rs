//! The wrappers Claude Code writes into user prompt text: slash command
//! records, local command output and pasted text.

use super::reader::Line;
use super::records::Rec;

/// A slash command record, `<command-name>/review</command-name>…` → `review`.
/// The tags may come in any order (`<command-message>` often comes first).
pub(super) fn command_name(text: &str) -> Option<String> {
    if !text.trim_start().starts_with("<command-") {
        return None;
    }
    let name = tag(text, "command-name")?;
    Some(name.trim().trim_start_matches('/').to_string()).filter(|n| !n.is_empty())
}

/// A slash command record as the user typed it: `/review 12`.
pub(super) fn command_prompt(name: &str, text: &str) -> String {
    match tag(text, "command-args").map(str::trim) {
        Some(args) if !args.is_empty() => format!("/{name} {args}"),
        _ => format!("/{name}"),
    }
}

/// The text of a local command's output record (`<local-command-stdout>` or
/// `-stderr>`), without the wrapper or terminal colour codes. `None` for
/// other text.
pub(super) fn command_output(text: &str) -> Option<String> {
    let trimmed = text.trim_start();
    let body = ["local-command-stdout", "local-command-stderr"]
        .iter()
        .filter(|name| trimmed.starts_with(&format!("<{name}>")))
        .find_map(|name| tag(trimmed, name))?;
    Some(strip_ansi(body).trim().to_string())
}

/// The caveat Claude Code adds before local command output for the model.
pub(super) fn is_command_caveat(text: &str) -> bool {
    text.trim_start().starts_with("<local-command-caveat>")
}

/// A slash command as typed, `/compact` → `compact`, when the
/// `<command-name>` record for the same command follows before the next
/// model call or prompt. Claude Code writes the typed text first when the
/// command runs before its record is written: in the S3 census all 15 such
/// records were `/compact`, followed by the compaction and then the record.
pub(super) fn echoed_command(text: &str, rest: &[Line]) -> Option<String> {
    let name = text.trim().strip_prefix('/')?.split_whitespace().next()?;
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':'))
    {
        return None;
    }
    for line in rest {
        let rec = Rec(&line.value);
        match rec.kind() {
            "assistant" => return None,
            "user" if rec.flag("isMeta") || rec.flag("isCompactSummary") => {}
            "user" => {
                let next = command_name(&rec.text().unwrap_or_default())?;
                return (next == name).then_some(next);
            }
            _ => {}
        }
    }
    None
}

/// Prompt text without its `<pasted_content id="N">` and
/// `</pasted_content id="N">` wrappers, keeping the pasted text.
pub(super) fn without_paste_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = [rest.find("<pasted_content"), rest.find("</pasted_content")]
        .into_iter()
        .flatten()
        .min()
    {
        // A tag ends on its own line; anything else is prose, kept as is.
        match rest[start..]
            .find('>')
            .filter(|&end| !rest[start..start + end].contains('\n'))
        {
            Some(end) => {
                out.push_str(&rest[..start]);
                rest = &rest[start + end + 1..];
            }
            None => {
                out.push_str(&rest[..=start]);
                rest = &rest[start + 1..];
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

/// The text between the first `<name>` and the following `</name>`.
fn tag<'t>(text: &'t str, name: &str) -> Option<&'t str> {
    let open = format!("<{name}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&format!("</{name}>"))?;
    Some(&text[start..start + end])
}

/// Remove ANSI escape sequences (CSI `ESC [ … final`, and two-byte `ESC x`).
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        if chars.next() == Some('[') {
            for c in chars.by_ref() {
                if ('\u{40}'..='\u{7e}').contains(&c) {
                    break;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{Value, json};

    use super::*;

    fn lines(records: Vec<Value>) -> Vec<Line> {
        records
            .into_iter()
            .enumerate()
            .map(|(i, value)| Line {
                line: i + 1,
                value: Arc::new(value),
            })
            .collect()
    }

    fn user(content: &str) -> Value {
        json!({"type": "user", "message": {"role": "user", "content": content}})
    }

    #[test]
    fn typed_command_is_an_echo_only_when_its_record_follows() {
        let record = "<command-name>/compact</command-name>";
        let confirmed = lines(vec![
            json!({"type": "system", "subtype": "compact_boundary"}),
            json!({"type": "user", "isCompactSummary": true, "message": {"content": "S"}}),
            json!({"type": "user", "isMeta": true, "message": {"content": "Caveat"}}),
            user(record),
        ]);
        assert_eq!(
            echoed_command("/compact", &confirmed).as_deref(),
            Some("compact")
        );
        assert_eq!(
            echoed_command(" /compact keep tests ", &confirmed).as_deref(),
            Some("compact")
        );
        // Another command's record, a model call first, or nothing at all.
        assert_eq!(echoed_command("/clear", &confirmed), None);
        let answered = lines(vec![json!({"type": "assistant"}), user(record)]);
        assert_eq!(echoed_command("/compact", &answered), None);
        let prompt = lines(vec![user("Why?"), user(record)]);
        assert_eq!(echoed_command("/compact", &prompt), None);
        assert_eq!(echoed_command("/compact", &[]), None);
        // Prose that starts with a slash.
        assert_eq!(echoed_command("/usr/bin is missing", &confirmed), None);
        assert_eq!(echoed_command("compact", &confirmed), None);
    }

    #[test]
    fn command_name_accepts_either_tag_order() {
        let review = "<command-name>/review</command-name>
<command-args></command-args>";
        assert_eq!(command_name(review).as_deref(), Some("review"));
        let compact = "<command-message>compact</command-message>
<command-name>/compact</command-name>";
        assert_eq!(command_name(compact).as_deref(), Some("compact"));
        assert_eq!(command_name("Run <command-name>/x</command-name>"), None);
    }

    #[test]
    fn command_prompt_is_the_typed_command_with_its_arguments() {
        let record = "<command-message>model</command-message>
<command-name>/model</command-name>
<command-args> claude-opus-5-5 </command-args>";
        assert_eq!(command_prompt("model", record), "/model claude-opus-5-5");
        let bare = "<command-name>/cost</command-name>\n<command-args></command-args>";
        assert_eq!(command_prompt("cost", bare), "/cost");
        assert_eq!(
            command_prompt("clear", "<command-name>/clear</command-name>"),
            "/clear"
        );
    }

    #[test]
    fn command_output_drops_the_wrapper_and_colour_codes() {
        let stdout =
            "<local-command-stdout>Set model to \u{1b}[1mOpus\u{1b}[22m</local-command-stdout>";
        assert_eq!(command_output(stdout).as_deref(), Some("Set model to Opus"));
        let stderr = "<local-command-stderr>Error: no such file</local-command-stderr>";
        assert_eq!(
            command_output(stderr).as_deref(),
            Some("Error: no such file")
        );
        let empty = "<local-command-stdout></local-command-stdout>";
        assert_eq!(command_output(empty).as_deref(), Some(""));
        assert_eq!(command_output("Plain text."), None);
        assert!(is_command_caveat(
            "<local-command-caveat>Caveat: …</local-command-caveat>"
        ));
        assert!(!is_command_caveat("Caveat"));
    }

    #[test]
    fn paste_tags_are_removed_and_their_text_kept() {
        let prompt = "Review this:\n\n<pasted_content id=\"42\">\nline one\nline two\n</pasted_content id=\"42\">\n\nThanks.";
        assert_eq!(
            without_paste_tags(prompt),
            "Review this:\n\n\nline one\nline two\n\n\nThanks."
        );
        let bare = "<pasted_content>\nbody\n</pasted_content>";
        assert_eq!(without_paste_tags(bare), "body");
        assert_eq!(without_paste_tags("a < b and c > d"), "a < b and c > d");
        assert_eq!(
            without_paste_tags("<pasted_content id=\"1\"\nnot a tag"),
            "<pasted_content id=\"1\"\nnot a tag"
        );
    }
}
