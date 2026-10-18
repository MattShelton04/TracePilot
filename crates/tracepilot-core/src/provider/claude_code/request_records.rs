//! Claude Code's request records (2.1.301+): `api-request`,
//! `api-request-blob` and `api-request-shape` (record-shapes.md, "Request
//! records").
//!
//! They log what Claude Code sent the API: the system prompt and tool list
//! once per distinct set, each request's parameters, and the messages by
//! hash. They are a third to well over half of a recent transcript, and none
//! of them is part of the conversation, so the reader keeps a stub with only
//! the `type`, `timestamp` and `version` the parser uses: their timestamps
//! still mark when a request was sent (a call's `requested_at`) and when the
//! session was active. The Context tab reads the full records on demand
//! ([`super::request_log`]).

use serde::Deserialize;
use serde_json::{Map, Value};

use super::translate::{RecCtx, Stream, Translator};
use crate::parsing::events::parse_json_line_lenient;

/// The request record types.
pub(super) const REQUEST_TYPES: &[&str] = &["api-request", "api-request-blob", "api-request-shape"];

/// Every request record line holds this; other lines are not head-parsed.
pub(super) const MARKER: &str = "\"api-request";

pub(super) fn is_request_type(kind: &str) -> bool {
    handled() && REQUEST_TYPES.contains(&kind)
}

#[cfg(test)]
thread_local! {
    /// Set by tests to parse a session as the parser did before request
    /// records were handled: each one read in full and kept as an Unknown
    /// event.
    pub(super) static AS_UNKNOWN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
fn handled() -> bool {
    !AS_UNKNOWN.with(std::cell::Cell::get)
}

#[cfg(not(test))]
const fn handled() -> bool {
    true
}

/// The top-level fields the parser reads from a request record. Unknown
/// keys are skipped without being built, whatever their order.
#[derive(Deserialize)]
struct Head {
    #[serde(rename = "type")]
    kind: Option<Value>,
    timestamp: Option<Value>,
    version: Option<Value>,
}

/// The stub kept for a request record line: an object of its `type` and,
/// when present, `timestamp` and `version`, as they were written. `None`
/// for any other line, and for a line the head parse rejects, which then
/// takes the ordinary path.
pub(super) fn stub(text: &str) -> Option<Value> {
    if !text.contains(MARKER) {
        return None;
    }
    let head = parse_json_line_lenient::<Head>(text).ok()?;
    let kind = head.kind?;
    if !kind.as_str().is_some_and(is_request_type) {
        return None;
    }
    let mut map = Map::new();
    map.insert("type".into(), kind);
    for (key, value) in [("timestamp", head.timestamp), ("version", head.version)] {
        if let Some(value) = value {
            map.insert(key.into(), value);
        }
    }
    Some(Value::Object(map))
}

impl<F: Fn() -> bool> Translator<'_, F> {
    /// A request record makes no event. It is counted, and a main-file
    /// record's time still dates the session and its runs, as its event did.
    pub(super) fn request_record(&mut self, st: &Stream<'_>, ctx: &RecCtx) {
        self.diagnostics.request_records += 1;
        if ctx.position.abandoned {
            self.diagnostics.abandoned_records += 1;
        }
        if st.agent_id.is_none()
            && let Some(ts) = ctx.ts
        {
            self.request_times.push((ctx.position.line, ts));
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::stub;

    #[test]
    fn request_records_become_stubs_whatever_their_key_order() {
        let line = r#"{"params":{"model":"m","max_tokens":1},"version":"2.1.302","timestamp":"2026-10-17T00:00:00.000Z","type":"api-request","tail":["a"]}"#;
        assert_eq!(
            stub(line),
            Some(
                json!({"type": "api-request", "timestamp": "2026-10-17T00:00:00.000Z", "version": "2.1.302"})
            )
        );
        let blob =
            r#"{"type":"api-request-blob","hash":"h","message":{"role":"user","content":"x"}}"#;
        assert_eq!(stub(blob), Some(json!({"type": "api-request-blob"})));
    }

    #[test]
    fn other_records_mentioning_the_marker_take_the_ordinary_path() {
        // A prompt that quotes a request record, a nested `type`, and a
        // future request type are not stubbed.
        for line in [
            r#"{"type":"user","message":{"content":"{\"type\":\"api-request\"}"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"api-request"}]}}"#,
            r#"{"type":"api-request-v2","timestamp":"2026-10-17T00:00:00.000Z"}"#,
            r#"{"type":"api-request","timestamp":"#,
        ] {
            assert_eq!(stub(line), None, "{line}");
        }
        assert_eq!(stub(r#"{"type":"user"}"#), None);
    }
}
