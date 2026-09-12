//! Normalize the latest available per-agent ledger without summing snapshots.
//! Keep the raw payload intact; malformed fields must not hide healthy workers.

use super::{TypedEvent, TypedEventData};
use crate::models::agent_usage::{AgentModelMetric, AgentUsageEntry, AgentUsageSnapshot};
use crate::models::event_types::{RequestMetrics, ShutdownTokenDetail, UsageMetrics};
use serde_json::Value;
use std::collections::HashMap;

pub(super) fn extract_agent_usage(events: &[TypedEvent]) -> Option<AgentUsageSnapshot> {
    for (event_index, event) in events.iter().enumerate().rev() {
        if event.raw.agent_id.is_some() {
            continue;
        }
        let TypedEventData::SessionShutdown(data) = &event.typed_data else {
            continue;
        };
        let Some(value) = data.agent_metrics.as_ref() else {
            continue;
        };
        let Some(object) = value.as_object() else {
            // Do not silently substitute an earlier ledger for malformed latest data.
            return Some(AgentUsageSnapshot {
                timestamp: event.raw.timestamp,
                event_index,
                has_invalid_fields: true,
                ..Default::default()
            });
        };
        let mut invalid = false;
        let agents = object
            .iter()
            .map(|(id, value)| {
                let entry = parse_agent(value, &mut invalid);
                (id.clone(), entry)
            })
            .collect();
        return Some(AgentUsageSnapshot {
            timestamp: event.raw.timestamp,
            event_index,
            agents,
            has_invalid_fields: invalid,
        });
    }
    None
}

fn parse_agent(value: &Value, invalid: &mut bool) -> AgentUsageEntry {
    if !value.is_object() {
        *invalid = true;
    }
    let models = value.get("modelMetrics");
    if !models.is_some_and(Value::is_object) {
        *invalid = true;
    }
    AgentUsageEntry {
        agent_name: value
            .get("agentName")
            .and_then(Value::as_str)
            .map(str::to_owned),
        agent_display_name: value
            .get("agentDisplayName")
            .and_then(Value::as_str)
            .map(str::to_owned),
        total_api_duration_ms: count(value, "totalApiDurationMs", invalid),
        total_nano_aiu: number(value, "totalNanoAiu", invalid),
        model_metrics: models
            .and_then(Value::as_object)
            .map(|models| {
                models
                    .iter()
                    .map(|(name, data)| (name.clone(), parse_model(data, invalid)))
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn parse_model(value: &Value, invalid: &mut bool) -> AgentModelMetric {
    if !value.is_object() {
        *invalid = true;
    }
    let requests = object_field(value, "requests", invalid).map(|d| RequestMetrics {
        count: count(d, "count", invalid),
        cost: number(d, "cost", invalid),
    });
    let usage = object_field(value, "usage", invalid).map(|d| UsageMetrics {
        input_tokens: count(d, "inputTokens", invalid),
        output_tokens: count(d, "outputTokens", invalid),
        cache_read_tokens: count(d, "cacheReadTokens", invalid),
        cache_write_tokens: count(d, "cacheWriteTokens", invalid),
        reasoning_tokens: count(d, "reasoningTokens", invalid),
    });
    let token_details = object_field(value, "tokenDetails", invalid)
        .and_then(Value::as_object)
        .map(|details| {
            details
                .iter()
                .map(|(key, detail)| {
                    if !detail.is_object() {
                        *invalid = true;
                    }
                    (
                        key.clone(),
                        ShutdownTokenDetail {
                            token_count: count(detail, "tokenCount", invalid),
                        },
                    )
                })
                .collect::<HashMap<_, _>>()
        });
    AgentModelMetric {
        requests,
        usage,
        total_nano_aiu: number(value, "totalNanoAiu", invalid),
        token_details,
    }
}

fn object_field<'a>(value: &'a Value, key: &str, invalid: &mut bool) -> Option<&'a Value> {
    let field = value.get(key)?;
    if field.is_null() {
        return None;
    }
    if field.is_object() {
        Some(field)
    } else {
        *invalid = true;
        None
    }
}

fn number(value: &Value, key: &str, invalid: &mut bool) -> Option<f64> {
    let field = value.get(key)?;
    if field.is_null() {
        return None;
    }
    match field.as_f64().filter(|n| n.is_finite() && *n >= 0.0) {
        Some(n) => Some(n),
        None => {
            *invalid = true;
            None
        }
    }
}

fn count(value: &Value, key: &str, invalid: &mut bool) -> Option<u64> {
    let field = value.get(key)?;
    if field.is_null() {
        return None;
    }
    if let Some(n) = field.as_u64() {
        return Some(n);
    }
    // Accept integral float encodings only in the exactly representable range.
    if let Some(n) = field
        .as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 9_007_199_254_740_991.0 && n.fract() == 0.0)
    {
        return Some(n as u64);
    }
    *invalid = true;
    None
}
