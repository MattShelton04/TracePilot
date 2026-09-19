//! Lenient parsing of `session.usage_checkpoint.promptCacheBreakState`.
//!
//! The field is internal and opaque in the CLI schema, so every value is
//! optional, unknown fields are ignored and a malformed entry is skipped and
//! counted rather than failing the session.

use chrono::{DateTime, Utc};
use serde_json::{Map, Value};

use super::parse_timestamp;

/// The conversation id Copilot CLI uses for the root agent.
pub const MAIN_CONVERSATION: &str = "main";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolFingerprint {
    pub name: String,
    pub schema_hash: Option<String>,
    /// Whether the CLI considers the name safe to display. Unsafe names
    /// (custom and MCP tools) are redacted in the UI.
    pub safe: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentFingerprint {
    pub segment: String,
    pub hash: Option<String>,
    pub tokens: Option<u64>,
}

/// The prefix fingerprint of the last request before a checkpoint, for one
/// conversation and model.
#[derive(Debug, Clone, PartialEq)]
pub struct CacheBaseline {
    pub conversation: String,
    pub model: String,
    pub initiator: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub cache_expires_at: Option<DateTime<Utc>>,
    pub ttl_seconds: Option<u64>,
    pub prompt_tokens: Option<u64>,
    pub cache_read: Option<u64>,
    pub cache_write: Option<u64>,
    pub frontier_tokens: Option<u64>,
    pub reasoning_effort: Option<String>,
    pub tools: Vec<ToolFingerprint>,
    pub system_segments: Vec<SegmentFingerprint>,
    /// `(message index, hash)` for the most recent messages of the prompt.
    pub conversation_points: Vec<(u64, String)>,
    pub message_count: Option<u64>,
    pub cache_config: Option<Value>,
}

/// Result of parsing one checkpoint's break state.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedBaselines {
    pub baselines: Vec<CacheBaseline>,
    /// Entries that were present but could not be read.
    pub malformed: usize,
}

/// Parse every conversation/model baseline in a checkpoint's break state.
pub fn parse_baselines(entries: &[Value]) -> ParsedBaselines {
    let mut parsed = ParsedBaselines::default();
    for entry in entries {
        let Some(entry) = entry.as_object() else {
            parsed.malformed += 1;
            continue;
        };
        let Some(models) = entry.get("models").and_then(Value::as_object) else {
            parsed.malformed += 1;
            continue;
        };
        let conversation = str_field(entry, "conversation").unwrap_or_else(|| "unknown".into());
        for (key, value) in models {
            match parse_model_baseline(&conversation, key, value) {
                Some(baseline) => parsed.baselines.push(baseline),
                None => parsed.malformed += 1,
            }
        }
    }
    parsed
}

fn parse_model_baseline(conversation: &str, key: &str, value: &Value) -> Option<CacheBaseline> {
    let object = value.as_object()?;
    let model = str_field(object, "model").unwrap_or_else(|| key.to_string());
    if model.is_empty() {
        return None;
    }
    let conversation_state = object.get("conversation").and_then(Value::as_object);
    Some(CacheBaseline {
        conversation: conversation.to_string(),
        model,
        initiator: str_field(object, "initiator"),
        completed_at: str_field(object, "completed_at").and_then(|s| parse_timestamp(&s)),
        cache_expires_at: str_field(object, "cache_expires_at").and_then(|s| parse_timestamp(&s)),
        ttl_seconds: u64_field(object, "ttl_seconds"),
        prompt_tokens: u64_field(object, "prompt_tokens"),
        cache_read: u64_field(object, "cache_read"),
        cache_write: u64_field(object, "cache_write"),
        frontier_tokens: u64_field(object, "frontier_tokens"),
        reasoning_effort: str_field(object, "reasoning_effort"),
        tools: array_field(object, "tools")
            .filter_map(|tool| {
                let tool = tool.as_object()?;
                Some(ToolFingerprint {
                    name: str_field(tool, "name")?,
                    schema_hash: str_field(tool, "schema_hash"),
                    safe: tool.get("safe").and_then(Value::as_bool).unwrap_or(false),
                })
            })
            .collect(),
        system_segments: array_field(object, "system_segments")
            .filter_map(|segment| {
                let segment = segment.as_object()?;
                Some(SegmentFingerprint {
                    segment: str_field(segment, "segment")?,
                    hash: str_field(segment, "hash"),
                    tokens: u64_field(segment, "tokens"),
                })
            })
            .collect(),
        conversation_points: conversation_state
            .map(|state| {
                array_field(state, "points")
                    .filter_map(|point| {
                        let point = point.as_object()?;
                        Some((u64_field(point, "index")?, str_field(point, "hash")?))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        message_count: conversation_state.and_then(|state| u64_field(state, "message_count")),
        cache_config: object.get("cache_config").filter(|v| !v.is_null()).cloned(),
    })
}

fn str_field(object: &Map<String, Value>, key: &str) -> Option<String> {
    object.get(key).and_then(Value::as_str).map(str::to_string)
}

fn u64_field(object: &Map<String, Value>, key: &str) -> Option<u64> {
    let value = object.get(key)?;
    value
        .as_u64()
        .or_else(|| value.as_f64().filter(|f| *f >= 0.0).map(|f| f as u64))
}

fn array_field<'a>(object: &'a Map<String, Value>, key: &str) -> impl Iterator<Item = &'a Value> {
    object
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}
