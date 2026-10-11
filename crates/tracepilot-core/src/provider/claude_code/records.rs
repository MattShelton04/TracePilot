//! Tolerant views of Claude Code records.
//!
//! Every field is optional and unknown keys are ignored (data-comparison
//! rule 10). Records stay as `serde_json::Value`, so the native record can be
//! kept verbatim; [`Rec`] reads fields without copying, and the small
//! fixed-shape bodies (usage, `cost-state`, subagent meta) use serde structs.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;

/// Borrowed accessor over one record.
#[derive(Clone, Copy)]
pub(super) struct Rec<'a>(pub(super) &'a Value);

impl<'a> Rec<'a> {
    pub(super) fn str(self, key: &str) -> Option<&'a str> {
        self.0.get(key).and_then(Value::as_str)
    }

    pub(super) fn ptr_str(self, pointer: &str) -> Option<&'a str> {
        self.0.pointer(pointer).and_then(Value::as_str)
    }

    pub(super) fn flag(self, key: &str) -> bool {
        self.0.get(key).and_then(Value::as_bool) == Some(true)
    }

    pub(super) fn kind(self) -> &'a str {
        self.str("type").unwrap_or("")
    }

    /// The native type: `type`, with the subtype for `system` and `attachment`.
    pub(super) fn native_type(self) -> String {
        match self.kind() {
            "system" => format!("system:{}", self.str("subtype").unwrap_or("")),
            "attachment" => format!(
                "attachment:{}",
                self.ptr_str("/attachment/type").unwrap_or("")
            ),
            "" => "unknown".to_string(),
            kind => kind.to_string(),
        }
    }

    pub(super) fn uuid(self) -> Option<&'a str> {
        self.str("uuid")
    }

    pub(super) fn parent_uuid(self) -> Option<&'a str> {
        self.str("parentUuid")
    }

    pub(super) fn timestamp(self) -> Option<DateTime<Utc>> {
        self.str("timestamp")
            .and_then(|ts| DateTime::parse_from_rfc3339(ts).ok())
            .map(|ts| ts.with_timezone(&Utc))
    }

    pub(super) fn message_id(self) -> Option<&'a str> {
        self.ptr_str("/message/id")
    }

    pub(super) fn model(self) -> Option<&'a str> {
        self.ptr_str("/message/model")
    }

    /// The reasoning effort an assistant record's call ran at: the session's
    /// `effort`, or `perTurnEffort` when only that is recorded.
    pub(super) fn effort(self) -> Option<&'a str> {
        ["effort", "perTurnEffort"]
            .into_iter()
            .find_map(|key| self.str(key).filter(|effort| !effort.is_empty()))
    }

    pub(super) fn origin_kind(self) -> Option<&'a str> {
        self.ptr_str("/origin/kind")
    }

    /// `message.content` as blocks. A string body is one text block.
    pub(super) fn blocks(self) -> Blocks<'a> {
        match self.0.pointer("/message/content") {
            Some(Value::Array(items)) => Blocks::Array(items),
            Some(Value::String(text)) => Blocks::Text(text),
            _ => Blocks::Array(&[]),
        }
    }

    /// The text of a user record: the string body, or its text blocks joined.
    pub(super) fn text(self) -> Option<String> {
        match self.blocks() {
            Blocks::Text(text) => Some(text.clone()),
            Blocks::Array(items) => {
                let parts: Vec<&str> = items
                    .iter()
                    .filter(|b| block_type(b) == "text")
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .collect();
                (!parts.is_empty()).then(|| parts.join("\n"))
            }
        }
    }

    pub(super) fn has_tool_results(self) -> bool {
        matches!(self.blocks(), Blocks::Array(items)
            if items.iter().any(|b| block_type(b) == "tool_result"))
    }

    pub(super) fn is_synthetic_error(self) -> bool {
        self.flag("isApiErrorMessage") || self.model() == Some("<synthetic>")
    }
}

pub(super) enum Blocks<'a> {
    Array(&'a [Value]),
    Text(&'a String),
}

pub(super) fn block_type(block: &Value) -> &str {
    block.get("type").and_then(Value::as_str).unwrap_or("")
}

/// Text of a `tool_result` block's content: a string, or text blocks joined.
/// Images become a placeholder; their data was already sanitized. ToolSearch's
/// `tool_reference` blocks become the names of the tools they loaded.
pub(super) fn tool_result_text(block: &Value) -> String {
    match block.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match (block_type(item), item.get("tool_name")) {
                ("text", _) => item
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                ("image", _) => "[image]".to_string(),
                ("tool_reference", Some(Value::String(name))) => name.clone(),
                (other, _) => format!("[{other}]"),
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// `message.usage` of an assistant record (Anthropic API convention:
/// `input_tokens` excludes cache reads and writes).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(super) struct WireUsage {
    pub(super) input_tokens: u64,
    pub(super) cache_read_input_tokens: u64,
    pub(super) cache_creation_input_tokens: u64,
    pub(super) output_tokens: u64,
    pub(super) cache_creation: WireCacheCreation,
    pub(super) output_tokens_details: WireOutputDetails,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(super) struct WireCacheCreation {
    pub(super) ephemeral_5m_input_tokens: u64,
    pub(super) ephemeral_1h_input_tokens: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(super) struct WireOutputDetails {
    pub(super) thinking_tokens: u64,
}

/// `subagents/agent-<id>.meta.json`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct SubagentMeta {
    pub(super) agent_type: Option<String>,
    pub(super) description: Option<String>,
    pub(super) tool_use_id: Option<String>,
    pub(super) spawn_depth: Option<u64>,
}

/// `system:compact_boundary` → `compactMetadata`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct CompactMetadata {
    pub(super) trigger: Option<String>,
    pub(super) pre_tokens: Option<u64>,
    pub(super) post_tokens: Option<u64>,
    pub(super) duration_ms: Option<u64>,
}
