//! Utility functions for turn reconstruction.

use chrono::{DateTime, Utc};

/// Compute duration in milliseconds between two timestamps.
///
/// Returns `None` if either timestamp is `None`, or if end < start (negative duration).
pub(crate) fn duration_ms(start: Option<DateTime<Utc>>, end: Option<DateTime<Utc>>) -> Option<u64> {
    let (Some(start), Some(end)) = (start, end) else {
        return None;
    };

    let millis = end.signed_duration_since(start).num_milliseconds();
    (millis >= 0).then_some(millis as u64)
}

/// Convert a JSON value to a string.
///
/// If the value is already a string, returns it as-is.
/// Otherwise, serializes the value to JSON.
pub(crate) fn json_value_to_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

/// Shell tools whose results end with the process exit code.
const SHELL_TOOLS: &[&str] = &[
    "bash",
    "powershell",
    "local_shell",
    "read_bash",
    "read_powershell",
    "write_bash",
    "write_powershell",
];

/// Exit code of a completed shell command.
///
/// Prefers the structured `shellExecution.exitCode` (Copilot CLI 1.0.88+),
/// which survives even when the CLI strips result contents. Older logs only
/// carry the code in the result's last line: `<shellId: N completed with exit
/// code X>`, `<exited with exit code X>` or `Process exited with code X.`.
pub(crate) fn shell_exit_code(
    tool_name: &str,
    shell_execution: Option<&serde_json::Value>,
    result: Option<&serde_json::Value>,
) -> Option<i64> {
    if let Some(code) = shell_execution
        .and_then(|value| value.get("exitCode"))
        .and_then(serde_json::Value::as_i64)
    {
        return Some(code);
    }
    if !SHELL_TOOLS.contains(&tool_name) {
        return None;
    }
    let text = match result? {
        serde_json::Value::String(text) => text.as_str(),
        serde_json::Value::Object(obj) => obj.get("content")?.as_str()?,
        _ => return None,
    };
    exit_code_from_output(text)
}

fn exit_code_from_output(text: &str) -> Option<i64> {
    let line = text.lines().rev().map(str::trim).find(|l| !l.is_empty())?;
    let code = if line.starts_with("<shellId:") {
        line.rsplit_once("completed with exit code ")?
            .1
            .strip_suffix('>')?
    } else if let Some(rest) = line.strip_prefix("<exited with exit code ") {
        rest.strip_suffix('>')?
    } else if let Some(rest) = line.strip_prefix("Process exited with code ") {
        rest.strip_suffix('.').unwrap_or(rest)
    } else {
        return None;
    };
    code.trim().parse().ok()
}

const RESULT_PREVIEW_MAX_BYTES: usize = 1024;

/// Truncate a string to a maximum byte length, respecting UTF-8 boundaries.
///
/// This is a thin wrapper around [`crate::utils::truncate_utf8_with_marker`]
/// that preserves the existing "…[truncated]" suffix for turn result previews.
pub(crate) fn truncate_str(s: &str, max_bytes: usize) -> String {
    crate::utils::truncate_utf8_with_marker(s, max_bytes, Some("…[truncated]"))
}

/// Extract display content from a polymorphic `result` field.
///
/// The result can be a plain string, an object with `content`/`detailedContent`, or other shapes.
/// Web search must retain its complete JSON envelope so the rich renderer can parse
/// it and discover sources after the usual preview boundary. Other tools remain lazy.
pub(crate) fn extract_result_content(
    result: &serde_json::Value,
    tool_name: &str,
) -> Option<String> {
    let text = match result {
        serde_json::Value::String(s) => Some(s.as_str()).filter(|s| !s.trim().is_empty()),
        serde_json::Value::Object(obj) => obj
            .get("content")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                obj.get("detailedContent")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
            }),
        _ => None,
    }?;
    Some(if tool_name == "web_search" {
        text.to_owned()
    } else {
        truncate_str(text, RESULT_PREVIEW_MAX_BYTES)
    })
}
