use super::super::SessionLiveState;
use crate::bridge::BridgeEvent;
use serde_json::Value;

pub(super) const MAX_TEXT_PREVIEW_CHARS: usize = 16 * 1024;
const MAX_REDUCER_WARNINGS: usize = 8;

pub(super) fn turn_id(event: &BridgeEvent) -> Option<String> {
    string_field(&event.data, &["turnId", "turn_id"])
        .or_else(|| event.parent_id.clone())
        .or_else(|| {
            (event.event_type == "assistant.turn_start")
                .then(|| event.id.clone())
                .flatten()
        })
}

pub(super) fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(s) = value.get(*key).and_then(Value::as_str) {
            return Some(s.to_string());
        }
    }
    value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(super) fn event_text_field(value: &Value, keys: &[&str]) -> Option<String> {
    string_field(value, keys)
        .or_else(|| string_at_any_key_path(value, &["message"], keys))
        .or_else(|| string_at_any_key_path(value, &["event", "message"], keys))
        .or_else(|| string_at_any_key_path(value, &["event", "delta"], keys))
        .or_else(|| string_at_any_key_path(value, &["data", "message"], keys))
        .or_else(|| string_at_any_key_path(value, &["data", "delta"], keys))
}

pub(super) fn string_at_any_key_path(
    value: &Value,
    path: &[&str],
    keys: &[&str],
) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    keys.iter()
        .find_map(|key| current.get(*key).and_then(Value::as_str))
        .map(str::to_string)
}

pub(super) fn number_field(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_f64))
}

pub(super) fn append_capped(target: &mut String, delta: &str) {
    target.push_str(delta);
    drain_to_tail(target, MAX_TEXT_PREVIEW_CHARS);
}

/// Keep only the trailing `max_len` characters of `value`. For streaming
/// stdout/tool output the tail is what the user is actively watching, so we
/// drop the *oldest* bytes when over the cap rather than the latest ones.
pub(super) fn truncate_string(value: &str, max_len: usize) -> String {
    if value.len() <= max_len {
        return value.to_string();
    }
    let start = find_tail_start(value, max_len);
    format!("…{}", &value[start..])
}

/// Truncate a string in-place to keep only the trailing `max_len` bytes,
/// respecting UTF-8 character boundaries.
pub(super) fn drain_to_tail(s: &mut String, max_len: usize) {
    if s.len() <= max_len {
        return;
    }
    let start = find_tail_start(s, max_len);
    s.drain(..start);
}

/// Find the byte index to start from to keep the trailing `max_len` bytes
/// while respecting UTF-8 character boundaries.
pub(super) fn find_tail_start(s: &str, max_len: usize) -> usize {
    let mut start = s.len().saturating_sub(max_len);
    while start < s.len() && !s.is_char_boundary(start) {
        start += 1;
    }
    start
}

pub(super) fn warn(state: &mut SessionLiveState, event: &BridgeEvent, warning: &str) {
    let msg = format!("{}: {}", event.event_type, warning);
    if !state
        .reducer_warnings
        .iter()
        .any(|existing| existing == &msg)
    {
        state.reducer_warnings.push(msg);
    }
    if state.reducer_warnings.len() > MAX_REDUCER_WARNINGS {
        let overflow = state.reducer_warnings.len() - MAX_REDUCER_WARNINGS;
        state.reducer_warnings.drain(0..overflow);
    }
}
