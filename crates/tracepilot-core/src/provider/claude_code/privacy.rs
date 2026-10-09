//! Record-level export redaction (data-comparison.md §5).
//!
//! Claude Code records carry data the user never sees in a transcript: their
//! email, organization and account ids, the full system prompt, instruction
//! files and the exact model-facing text. Export replaces these with a marker
//! whatever the user's redaction options; the pattern-based redaction engine
//! still covers secrets and PII in content. Keys are matched wherever they
//! appear, because record shapes change between versions.

use serde_json::{Map, Value};

const REDACTED: &str = "[redacted by TracePilot]";
const OMITTED: &str = "[omitted by TracePilot: duplicate of the tool call]";

/// Identity, account and plan fields, redacted at any depth.
const PRIVATE_KEYS: &[&str] = &[
    "userEmail",
    "organizationUuid",
    "accountUuid",
    "quotaLimits",
    "frameUrl",
];

/// Extra copies of a call's input or result (`input` and `toolUseResult` stay).
const DUPLICATE_KEYS: &[&str] = &["wireToolInputs", "bashEditDiff"];

/// Attachments whose body is model-facing context: the system prompt and
/// tool list, and CLAUDE.md / AGENTS.md text.
const PRIVATE_ATTACHMENTS: &[&str] = &["prompt_snapshot", "instructions", "nested_memory"];

/// Redact one native record in place. `record_type` is the native type, with
/// the subtype for `system` and `attachment` records.
pub(crate) fn redact_record(record_type: &str, record: &mut Value) {
    let Value::Object(map) = record else {
        return;
    };
    if let Some(attachment) = record_type.strip_prefix("attachment:") {
        // The exact text the model saw, which repeats the attachment.
        redact_member(map, "rendered", REDACTED);
        if PRIVATE_ATTACHMENTS.contains(&attachment)
            && let Some(Value::Object(body)) = map.get_mut("attachment")
        {
            for (key, value) in body.iter_mut() {
                if key != "type" {
                    *value = Value::String(REDACTED.into());
                }
            }
        }
    }
    if record_type == "system:bridge_status" {
        // A remote-control URL.
        redact_member(map, "url", REDACTED);
    }
    redact_keys(record);
}

fn redact_member(map: &mut Map<String, Value>, key: &str, marker: &str) {
    if let Some(value) = map.get_mut(key) {
        *value = Value::String(marker.into());
    }
}

fn redact_keys(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, value) in map.iter_mut() {
                if is_private_key(key) {
                    *value = Value::String(REDACTED.into());
                } else if DUPLICATE_KEYS.contains(&key.as_str()) {
                    *value = Value::String(OMITTED.into());
                } else {
                    redact_keys(value);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(redact_keys),
        _ => {}
    }
}

/// `bridge-session` names its owner ids `owner…Uuid`.
fn is_private_key(key: &str) -> bool {
    PRIVATE_KEYS.contains(&key) || (key.starts_with("owner") && key.ends_with("Uuid"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn redacted(record_type: &str, mut record: Value) -> Value {
        redact_record(record_type, &mut record);
        record
    }

    #[test]
    fn session_context_loses_the_email_and_rendered_text() {
        let record = json!({
            "type": "attachment",
            "attachment": {"type": "session_context", "context": {
                "userEmail": "dev@example.com", "platform": "win32"}},
            "rendered": ["You are working for dev@example.com"],
        });
        let out = redacted("attachment:session_context", record);
        assert_eq!(out["attachment"]["context"]["userEmail"], REDACTED);
        assert_eq!(out["attachment"]["context"]["platform"], "win32");
        assert_eq!(out["rendered"], REDACTED);
    }

    #[test]
    fn prompt_and_instruction_attachments_keep_only_their_type() {
        for kind in PRIVATE_ATTACHMENTS {
            let record = json!({
                "type": "attachment",
                "attachment": {"type": kind, "content": "You are Claude…", "path": "C:\\work\\CLAUDE.md"},
            });
            let out = redacted(&format!("attachment:{kind}"), record);
            assert_eq!(
                out["attachment"],
                json!({"type": kind, "content": REDACTED, "path": REDACTED})
            );
        }
    }

    #[test]
    fn other_attachments_keep_their_body() {
        let record =
            json!({"type": "attachment", "attachment": {"type": "date", "date": "2026-09-20"}});
        let out = redacted("attachment:date", record.clone());
        assert_eq!(out, record);
    }

    #[test]
    fn account_ids_are_redacted_at_any_depth() {
        let org = redacted(
            "attachment:credential_org",
            json!({"attachment": {"type": "credential_org", "organizationUuid": "org-1"}}),
        );
        assert_eq!(org["attachment"]["organizationUuid"], REDACTED);

        let bridge = redacted(
            "bridge-session",
            json!({"type": "bridge-session", "ownerAccountUuid": "a", "ownerOrgUuid": "b", "sessionId": "s"}),
        );
        assert_eq!(bridge["ownerAccountUuid"], REDACTED);
        assert_eq!(bridge["ownerOrgUuid"], REDACTED);
        assert_eq!(bridge["sessionId"], "s");

        let ledger = redacted(
            "artifact-autoreact-ledger",
            json!({"entries": [{"accountUuid": "acct"}]}),
        );
        assert_eq!(ledger["entries"][0]["accountUuid"], REDACTED);
    }

    #[test]
    fn quota_and_remote_control_urls_are_redacted() {
        let error = redacted(
            "assistant",
            json!({"apiErrorStatus": 429, "quotaLimits": {"plan": "max"}}),
        );
        assert_eq!(error["quotaLimits"], REDACTED);
        assert_eq!(error["apiErrorStatus"], 429);

        let status = redacted(
            "system:bridge_status",
            json!({"subtype": "bridge_status", "url": "https://remote.example/s/1"}),
        );
        assert_eq!(status["url"], REDACTED);
        let frame = redacted(
            "frame-link",
            json!({"frameUrl": "https://remote.example/f"}),
        );
        assert_eq!(frame["frameUrl"], REDACTED);
        // `url` elsewhere is ordinary content (WebFetch results).
        let fetch = redacted(
            "user",
            json!({"toolUseResult": {"url": "https://docs.example"}}),
        );
        assert_eq!(fetch["toolUseResult"]["url"], "https://docs.example");
    }

    #[test]
    fn duplicate_tool_io_is_omitted_and_the_canonical_copy_kept() {
        let record = json!({
            "message": {"content": [{"type": "tool_use", "input": {"command": "ls"}}]},
            "wireToolInputs": {"command": "ls"},
            "toolUseResult": {"stdout": "a"},
            "bashEditDiff": "diff",
        });
        let out = redacted("assistant", record);
        assert_eq!(out["wireToolInputs"], OMITTED);
        assert_eq!(out["bashEditDiff"], OMITTED);
        assert_eq!(out["message"]["content"][0]["input"]["command"], "ls");
        assert_eq!(out["toolUseResult"]["stdout"], "a");
    }
}
