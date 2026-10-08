//! Session totals from recorded `tracepilot.model_call` events.

use std::collections::HashMap;

use crate::models::event_types::{ModelMetricDetail, RequestMetrics, UsageMetrics};
use crate::parsing::events::{TypedEvent, TypedEventData};
use crate::provider::{MetricsCoverage, SessionMetrics};

/// Totals for a session with no `session.shutdown`: a live session, or a
/// source that never writes one. `None` when no call was recorded.
///
/// Coverage is always partial, because recorded calls cannot prove that all
/// usage was persisted or that the session ended. There is no cost: pricing
/// recorded usage is the pricing registry's job.
pub fn metrics_from_model_calls(events: &[TypedEvent]) -> Option<SessionMetrics> {
    let mut models: HashMap<String, ModelMetricDetail> = HashMap::new();
    let mut calls = 0;
    let mut duration: Option<u64> = None;
    let mut current_model = None;
    for event in events {
        let TypedEventData::ModelCall(call) = &event.typed_data else {
            continue;
        };
        calls += 1;
        let model = call.model.clone().unwrap_or_default();
        if event.raw.agent_id.is_none() && !model.is_empty() {
            current_model = Some(model.clone());
        }
        let detail = models.entry(model).or_insert_with(|| ModelMetricDetail {
            requests: Some(RequestMetrics {
                count: Some(0),
                cost: None,
            }),
            usage: Some(UsageMetrics {
                input_tokens: Some(0),
                output_tokens: Some(0),
                cache_read_tokens: Some(0),
                cache_write_tokens: Some(0),
                reasoning_tokens: Some(0),
            }),
            total_nano_aiu: None,
            token_details: None,
        });
        if let Some(count) = detail.requests.as_mut().and_then(|r| r.count.as_mut()) {
            *count += 1;
        }
        if let Some(usage) = detail.usage.as_mut() {
            let add = |total: &mut Option<u64>, value: Option<u64>| {
                *total = Some(total.unwrap_or(0) + value.unwrap_or(0));
            };
            add(&mut usage.input_tokens, call.input_tokens);
            add(&mut usage.output_tokens, call.output_tokens);
            add(&mut usage.cache_read_tokens, call.cache_read_tokens);
            add(&mut usage.cache_write_tokens, call.cache_write_tokens);
            add(&mut usage.reasoning_tokens, call.reasoning_tokens);
        }
        if let Some(ms) = call.duration_ms {
            duration = Some(duration.unwrap_or(0) + ms);
        }
    }
    (calls > 0).then(|| SessionMetrics {
        total_api_duration_ms: duration,
        current_model,
        model_metrics: models,
        coverage: Some(MetricsCoverage {
            partial: true,
            snapshot_line: None,
            recorded_calls: calls,
            tail_calls: calls,
            snapshot_cost: None,
        }),
        ..SessionMetrics::default()
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::ids::SessionId;
    use crate::models::event_types::SessionEventType;
    use crate::parsing::events::{RawEvent, typed_data_from_raw};

    fn event(kind: &str, agent: Option<&str>, data: Value) -> TypedEvent {
        let mut raw: RawEvent =
            serde_json::from_value(json!({"type": kind, "data": data})).unwrap();
        raw.agent_id = agent.map(str::to_string);
        let event_type = SessionEventType::parse_wire(kind);
        let (typed_data, warning) = typed_data_from_raw(&event_type, &raw.data);
        assert!(warning.is_none());
        TypedEvent {
            raw,
            event_type,
            typed_data,
        }
    }

    fn call(model: &str, input: u64, output: u64, ms: Option<u64>) -> Value {
        json!({"model": model, "inputTokens": input, "cacheReadTokens": input / 2,
            "cacheWriteTokens": 1, "outputTokens": output, "reasoningTokens": 2,
            "durationMs": ms})
    }

    #[test]
    fn sums_calls_per_model_as_partial_totals() {
        let events = [
            event("user.message", None, json!({"content": "go"})),
            event("tracepilot.model_call", None, call("m-a", 100, 10, Some(5))),
            event(
                "tracepilot.model_call",
                Some("agent-1"),
                call("m-b", 40, 4, None),
            ),
            event("tracepilot.model_call", None, call("m-a", 200, 20, Some(7))),
        ];
        let metrics = metrics_from_model_calls(&events).unwrap();
        let a = &metrics.model_metrics["m-a"];
        assert_eq!(a.requests.as_ref().unwrap().count, Some(2));
        let usage = a.usage.as_ref().unwrap();
        assert_eq!(
            (
                usage.input_tokens,
                usage.output_tokens,
                usage.cache_read_tokens,
                usage.cache_write_tokens,
                usage.reasoning_tokens
            ),
            (Some(300), Some(30), Some(150), Some(2), Some(4))
        );
        assert_eq!(
            metrics.model_metrics["m-b"]
                .requests
                .as_ref()
                .unwrap()
                .count,
            Some(1)
        );
        // The main agent's model, not a subagent's.
        assert_eq!(metrics.current_model.as_deref(), Some("m-a"));
        assert_eq!(metrics.total_api_duration_ms, Some(12));
        assert!(metrics.cost.is_none());
        let coverage = metrics.coverage.unwrap();
        assert!(coverage.partial);
        assert_eq!((coverage.recorded_calls, coverage.tail_calls), (3, 3));

        assert!(metrics_from_model_calls(&events[..1]).is_none());
    }

    #[test]
    fn a_summary_without_shutdown_takes_its_totals_from_model_calls() {
        let id = SessionId::from_validated("11111111-2222-4333-8444-555555555555");
        let events = [
            event("user.message", None, json!({"content": "go"})),
            event("tracepilot.model_call", None, call("m-a", 100, 10, None)),
        ];
        let (summary, turns) = crate::summary::summary_from_events(&id, &events);
        let metrics = summary.shutdown_metrics.unwrap();
        assert!(metrics.coverage.unwrap().partial);
        assert_eq!(metrics.total_nano_aiu, None);
        assert_eq!(
            metrics.model_metrics["m-a"]
                .usage
                .as_ref()
                .unwrap()
                .input_tokens,
            Some(100)
        );
        assert_eq!(turns[0].usage.unwrap().model_calls, 1);
        assert_eq!(summary.turn_count, Some(1));
        assert!(summary.has_events);
    }
}
