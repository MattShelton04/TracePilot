use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::*;
use crate::parsing::events::TypedEvent;
use crate::testing::make_typed_event;

pub(super) const MODEL: &str = "gpt-5.6-luna";

pub(super) fn at(time: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&format!("2026-09-12T{time}Z"))
        .unwrap()
        .with_timezone(&Utc)
}

pub(super) fn event(event_type: &str, time: &str, data: Value) -> TypedEvent {
    let mut event = make_typed_event(event_type, data);
    event.raw.timestamp = Some(at(time));
    event
}

pub(super) fn start(model: &str) -> TypedEvent {
    event(
        "session.start",
        "00:00:00",
        json!({"copilotVersion": "1.0.83", "selectedModel": model, "reasoningEffort": "high"}),
    )
}

pub(super) fn user(time: &str, interaction: &str) -> TypedEvent {
    event(
        "user.message",
        time,
        json!({"content": "hi", "interactionId": interaction}),
    )
}

pub(super) fn turn_end(time: &str) -> TypedEvent {
    event("assistant.turn_end", time, json!({"turnId": "0"}))
}

pub(super) fn tools(names: &[(&str, &str, bool)]) -> Value {
    Value::Array(
        names
            .iter()
            .map(|(name, hash, safe)| json!({"name": name, "schema_hash": hash, "safe": safe}))
            .collect(),
    )
}

pub(super) fn default_tools() -> Value {
    tools(&[("view", "aaa", true), ("powershell", "bbb", true)])
}

pub(super) fn baseline(effort: &str, tools: Value, messages: u64, hashes: &[&str]) -> Value {
    json!({
        "model": MODEL,
        "reasoning_effort": effort,
        "initiator": "agent",
        "tools": tools,
        "system_segments": [
            {"segment": "identity", "hash": "id1", "tokens": 700},
            {"segment": "environment_context", "hash": "env1", "tokens": 100}
        ],
        "conversation": {
            "message_count": messages,
            "points": hashes.iter().enumerate()
                .map(|(i, h)| json!({"index": i, "hash": h}))
                .collect::<Vec<_>>()
        },
        "cache_config": {"arm": "control"},
        "prompt_tokens": 20_003,
        "frontier_tokens": 20_000,
        "ttl_seconds": 1800,
    })
}

pub(super) fn checkpoint(
    time: &str,
    nano: u64,
    expires: &str,
    ttl: u64,
    base: Option<Value>,
) -> TypedEvent {
    let mut data = json!({
        "totalNanoAiu": nano,
        "modelCacheState": [{
            "modelId": MODEL,
            "cacheExpiresAt": format!("2026-09-12T{expires}Z"),
            "cacheTtlSeconds": ttl
        }]
    });
    if let Some(base) = base {
        data["promptCacheBreakState"] = json!([{"conversation": "main", "models": {MODEL: base}}]);
    }
    event("session.usage_checkpoint", time, data)
}

pub(super) fn no_registry(_: &str) -> Option<u64> {
    None
}

pub(super) fn build(events: &[TypedEvent]) -> PromptCacheTimeline {
    build_prompt_cache_timeline(events, no_registry)
}

mod changes;
mod observations;
mod windows;
