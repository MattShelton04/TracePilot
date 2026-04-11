//! Integration tests for version-specific event parsing.
//!
//! Each fixture represents a Copilot CLI version milestone with its unique
//! event schema. Tests verify that `parse_typed_events` and `reconstruct_turns`
//! correctly handle version-progressive field additions.

use std::path::PathBuf;

use tracepilot_core::models::event_types::SessionEventType;
use tracepilot_core::parsing::events::{parse_typed_events, TypedEventData};
use tracepilot_core::turns::reconstruct_turns;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("versions")
        .join(name)
}

// ---------------------------------------------------------------------------
// Helper: extract typed data variants from parsed events
// ---------------------------------------------------------------------------

fn find_shutdown(events: &[tracepilot_core::parsing::events::TypedEvent]) -> &TypedEventData {
    events
        .iter()
        .find(|e| e.event_type == SessionEventType::SessionShutdown)
        .map(|e| &e.typed_data)
        .expect("fixture must contain session.shutdown")
}

fn find_subagent_completed(
    events: &[tracepilot_core::parsing::events::TypedEvent],
) -> &TypedEventData {
    events
        .iter()
        .find(|e| e.event_type == SessionEventType::SubagentCompleted)
        .map(|e| &e.typed_data)
        .expect("fixture must contain subagent.completed")
}

fn find_session_start(
    events: &[tracepilot_core::parsing::events::TypedEvent],
) -> &TypedEventData {
    events
        .iter()
        .find(|e| e.event_type == SessionEventType::SessionStart)
        .map(|e| &e.typed_data)
        .expect("fixture must contain session.start")
}

// ---------------------------------------------------------------------------
// Macro to reduce boilerplate for common per-version assertions
// ---------------------------------------------------------------------------

macro_rules! assert_common_parse {
    ($parsed:expr, $expected_event_count:expr, $version:expr) => {
        assert_eq!(
            $parsed.diagnostics.malformed_lines, 0,
            "no malformed lines for {}",
            $version
        );
        assert!(
            $parsed.diagnostics.unknown_event_types.is_empty(),
            "no unknown event types for {}",
            $version
        );
        assert!(
            $parsed.diagnostics.deserialization_failures.is_empty(),
            "no deserialization failures for {}",
            $version
        );
        assert_eq!(
            $parsed.events.len(),
            $expected_event_count,
            "event count for {}",
            $version
        );
    };
}

// ===========================================================================
// v1.0.2 — modelMetrics in shutdown, no token budget, no subagent metrics
// ===========================================================================

#[test]
fn v1_0_2_parses_without_errors() {
    let parsed = parse_typed_events(&fixture_path("v1_0_2.jsonl")).unwrap();
    assert_common_parse!(parsed, 10, "v1.0.2");
}

#[test]
fn v1_0_2_has_expected_event_types() {
    let parsed = parse_typed_events(&fixture_path("v1_0_2.jsonl")).unwrap();
    let types: Vec<_> = parsed.events.iter().map(|e| &e.event_type).collect();
    assert!(types.contains(&&SessionEventType::SessionStart));
    assert!(types.contains(&&SessionEventType::UserMessage));
    assert!(types.contains(&&SessionEventType::AssistantTurnStart));
    assert!(types.contains(&&SessionEventType::ToolExecutionStart));
    assert!(types.contains(&&SessionEventType::SubagentStarted));
    assert!(types.contains(&&SessionEventType::SubagentCompleted));
    assert!(types.contains(&&SessionEventType::ToolExecutionComplete));
    assert!(types.contains(&&SessionEventType::AssistantMessage));
    assert!(types.contains(&&SessionEventType::AssistantTurnEnd));
    assert!(types.contains(&&SessionEventType::SessionShutdown));
}

#[test]
fn v1_0_2_session_start_fields() {
    let parsed = parse_typed_events(&fixture_path("v1_0_2.jsonl")).unwrap();
    let start = find_session_start(&parsed.events);
    if let TypedEventData::SessionStart(data) = start {
        assert_eq!(data.session_id.as_deref(), Some("test-v1_0_2"));
        assert_eq!(data.copilot_version.as_deref(), Some("1.0.2"));
        assert_eq!(data.producer.as_deref(), Some("copilot-agent"));
    } else {
        panic!("expected SessionStart variant");
    }
}

#[test]
fn v1_0_2_shutdown_has_model_metrics_but_no_token_budget() {
    let parsed = parse_typed_events(&fixture_path("v1_0_2.jsonl")).unwrap();
    let shutdown = find_shutdown(&parsed.events);
    if let TypedEventData::SessionShutdown(data) = shutdown {
        // Has modelMetrics
        let mm = data.model_metrics.as_ref().expect("modelMetrics present");
        let gpt4o = mm.get("gpt-4o").expect("gpt-4o metrics present");
        let usage = gpt4o.usage.as_ref().expect("usage present");
        assert_eq!(usage.input_tokens, Some(1000));
        assert_eq!(usage.output_tokens, Some(500));
        assert_eq!(usage.cache_read_tokens, Some(200));
        assert_eq!(usage.cache_write_tokens, Some(100));
        assert_eq!(usage.reasoning_tokens, None);

        let req = gpt4o.requests.as_ref().expect("requests present");
        assert_eq!(req.count, Some(3));

        // No token budget fields
        assert!(data.current_tokens.is_none(), "no currentTokens in v1.0.2");
        assert!(data.system_tokens.is_none(), "no systemTokens in v1.0.2");
        assert!(
            data.conversation_tokens.is_none(),
            "no conversationTokens in v1.0.2"
        );
        assert!(
            data.tool_definitions_tokens.is_none(),
            "no toolDefinitionsTokens in v1.0.2"
        );

        assert_eq!(data.total_premium_requests, Some(5.0));
        assert_eq!(data.total_api_duration_ms, Some(10000));
    } else {
        panic!("expected SessionShutdown variant");
    }
}

#[test]
fn v1_0_2_subagent_completed_has_no_metrics() {
    let parsed = parse_typed_events(&fixture_path("v1_0_2.jsonl")).unwrap();
    let sub = find_subagent_completed(&parsed.events);
    if let TypedEventData::SubagentCompleted(data) = sub {
        assert_eq!(data.agent_display_name.as_deref(), Some("Explore Agent"));
        assert!(data.model.is_none(), "no model in v1.0.2 subagent.completed");
        assert!(
            data.total_tokens.is_none(),
            "no totalTokens in v1.0.2 subagent.completed"
        );
        assert!(
            data.total_tool_calls.is_none(),
            "no totalToolCalls in v1.0.2 subagent.completed"
        );
        assert!(
            data.duration_ms.is_none(),
            "no durationMs in v1.0.2 subagent.completed"
        );
    } else {
        panic!("expected SubagentCompleted variant");
    }
}

// ===========================================================================
// v1.0.7 — same schema as v1.0.2 (verify stability)
// ===========================================================================

#[test]
fn v1_0_7_parses_without_errors() {
    let parsed = parse_typed_events(&fixture_path("v1_0_7.jsonl")).unwrap();
    assert_common_parse!(parsed, 10, "v1.0.7");
}

#[test]
fn v1_0_7_shutdown_has_model_metrics_but_no_token_budget() {
    let parsed = parse_typed_events(&fixture_path("v1_0_7.jsonl")).unwrap();
    let shutdown = find_shutdown(&parsed.events);
    if let TypedEventData::SessionShutdown(data) = shutdown {
        let mm = data.model_metrics.as_ref().expect("modelMetrics present");
        assert!(mm.contains_key("gpt-4o"));

        let usage = mm["gpt-4o"].usage.as_ref().expect("usage present");
        assert_eq!(usage.input_tokens, Some(2000));
        assert_eq!(usage.output_tokens, Some(800));
        assert_eq!(usage.reasoning_tokens, None);

        assert!(data.current_tokens.is_none());
        assert!(data.system_tokens.is_none());
        assert!(data.conversation_tokens.is_none());
        assert!(data.tool_definitions_tokens.is_none());
    } else {
        panic!("expected SessionShutdown variant");
    }
}

#[test]
fn v1_0_7_subagent_completed_has_no_metrics() {
    let parsed = parse_typed_events(&fixture_path("v1_0_7.jsonl")).unwrap();
    let sub = find_subagent_completed(&parsed.events);
    if let TypedEventData::SubagentCompleted(data) = sub {
        assert!(data.model.is_none());
        assert!(data.total_tokens.is_none());
        assert!(data.total_tool_calls.is_none());
        assert!(data.duration_ms.is_none());
    } else {
        panic!("expected SubagentCompleted variant");
    }
}

// ===========================================================================
// v1.0.8 — adds token budget fields on shutdown
// ===========================================================================

#[test]
fn v1_0_8_parses_without_errors() {
    let parsed = parse_typed_events(&fixture_path("v1_0_8.jsonl")).unwrap();
    assert_common_parse!(parsed, 10, "v1.0.8");
}

#[test]
fn v1_0_8_shutdown_has_token_budget() {
    let parsed = parse_typed_events(&fixture_path("v1_0_8.jsonl")).unwrap();
    let shutdown = find_shutdown(&parsed.events);
    if let TypedEventData::SessionShutdown(data) = shutdown {
        // Token budget fields present
        assert_eq!(data.current_tokens, Some(50000));
        assert_eq!(data.system_tokens, Some(10000));
        assert_eq!(data.conversation_tokens, Some(30000));
        assert_eq!(data.tool_definitions_tokens, Some(10000));

        // modelMetrics still present
        let mm = data.model_metrics.as_ref().expect("modelMetrics present");
        let usage = mm["gpt-4o"].usage.as_ref().unwrap();
        assert_eq!(usage.input_tokens, Some(3000));
        assert_eq!(usage.output_tokens, Some(1200));
        assert_eq!(usage.reasoning_tokens, None);
    } else {
        panic!("expected SessionShutdown variant");
    }
}

#[test]
fn v1_0_8_subagent_completed_still_no_metrics() {
    let parsed = parse_typed_events(&fixture_path("v1_0_8.jsonl")).unwrap();
    let sub = find_subagent_completed(&parsed.events);
    if let TypedEventData::SubagentCompleted(data) = sub {
        assert!(data.model.is_none());
        assert!(data.total_tokens.is_none());
        assert!(data.total_tool_calls.is_none());
        assert!(data.duration_ms.is_none());
    } else {
        panic!("expected SubagentCompleted variant");
    }
}

// ===========================================================================
// v1.0.11 — subagent.completed gains metrics
// ===========================================================================

#[test]
fn v1_0_11_parses_without_errors() {
    let parsed = parse_typed_events(&fixture_path("v1_0_11.jsonl")).unwrap();
    assert_common_parse!(parsed, 10, "v1.0.11");
}

#[test]
fn v1_0_11_shutdown_has_token_budget() {
    let parsed = parse_typed_events(&fixture_path("v1_0_11.jsonl")).unwrap();
    let shutdown = find_shutdown(&parsed.events);
    if let TypedEventData::SessionShutdown(data) = shutdown {
        assert_eq!(data.current_tokens, Some(60000));
        assert_eq!(data.system_tokens, Some(12000));
        assert_eq!(data.conversation_tokens, Some(36000));
        assert_eq!(data.tool_definitions_tokens, Some(12000));
    } else {
        panic!("expected SessionShutdown variant");
    }
}

#[test]
fn v1_0_11_subagent_completed_has_metrics() {
    let parsed = parse_typed_events(&fixture_path("v1_0_11.jsonl")).unwrap();
    let sub = find_subagent_completed(&parsed.events);
    if let TypedEventData::SubagentCompleted(data) = sub {
        assert_eq!(data.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(data.total_tokens, Some(50000));
        assert_eq!(data.total_tool_calls, Some(10));
        assert_eq!(data.duration_ms, Some(5000));
        assert_eq!(data.agent_display_name.as_deref(), Some("Explore Agent"));
    } else {
        panic!("expected SubagentCompleted variant");
    }
}

// ===========================================================================
// v1.0.24 — reasoning_tokens, remote_steerable_changed, request_id
// ===========================================================================

#[test]
fn v1_0_24_parses_without_errors() {
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    // 13 events: +2 for subagent.failed flow, +1 for session.remote_steerable_changed
    assert_common_parse!(parsed, 13, "v1.0.24");
}

#[test]
fn v1_0_24_has_remote_steerable_changed_event() {
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    let rsc = parsed
        .events
        .iter()
        .find(|e| e.event_type == SessionEventType::SessionRemoteSteerableChanged)
        .expect("remote_steerable_changed event present");
    if let TypedEventData::SessionRemoteSteerableChanged(data) = &rsc.typed_data {
        assert_eq!(data.remote_steerable, Some(true));
    } else {
        panic!("expected SessionRemoteSteerableChanged variant");
    }
}

#[test]
fn v1_0_24_shutdown_has_reasoning_tokens() {
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    let shutdown = find_shutdown(&parsed.events);
    if let TypedEventData::SessionShutdown(data) = shutdown {
        // Token budget present
        assert_eq!(data.current_tokens, Some(80000));
        assert_eq!(data.system_tokens, Some(15000));
        assert_eq!(data.conversation_tokens, Some(50000));
        assert_eq!(data.tool_definitions_tokens, Some(15000));

        // reasoning_tokens in usage
        let mm = data.model_metrics.as_ref().expect("modelMetrics present");
        let opus = mm
            .get("claude-opus-4.6")
            .expect("claude-opus-4.6 metrics present");
        let usage = opus.usage.as_ref().expect("usage present");
        assert_eq!(usage.input_tokens, Some(5000));
        assert_eq!(usage.output_tokens, Some(2000));
        assert_eq!(usage.cache_read_tokens, Some(1000));
        assert_eq!(usage.cache_write_tokens, Some(500));
        assert_eq!(usage.reasoning_tokens, Some(300));
    } else {
        panic!("expected SessionShutdown variant");
    }
}

#[test]
fn v1_0_24_assistant_message_has_request_id() {
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    let msg = parsed
        .events
        .iter()
        .find(|e| e.event_type == SessionEventType::AssistantMessage)
        .expect("assistant.message present");
    if let TypedEventData::AssistantMessage(data) = &msg.typed_data {
        assert_eq!(data.request_id.as_deref(), Some("req-001"));
    } else {
        panic!("expected AssistantMessage variant");
    }
}

#[test]
fn v1_0_24_subagent_completed_has_metrics() {
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    let sub = find_subagent_completed(&parsed.events);
    if let TypedEventData::SubagentCompleted(data) = sub {
        assert_eq!(data.model.as_deref(), Some("claude-opus-4.6"));
        assert_eq!(data.total_tokens, Some(75000));
        assert_eq!(data.total_tool_calls, Some(15));
        assert_eq!(data.duration_ms, Some(8000));
        assert_eq!(data.agent_name.as_deref(), Some("explore"));
    } else {
        panic!("expected SubagentCompleted variant");
    }
}

#[test]
fn v1_0_24_subagent_failed_has_metrics() {
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    let failed = parsed
        .events
        .iter()
        .find(|e| e.event_type == SessionEventType::SubagentFailed)
        .expect("subagent.failed event present");
    if let TypedEventData::SubagentFailed(data) = &failed.typed_data {
        assert_eq!(data.model.as_deref(), Some("gpt-5.4"));
        assert_eq!(data.total_tokens, Some(12000));
        assert_eq!(data.total_tool_calls, Some(3));
        assert_eq!(data.duration_ms, Some(30000));
        assert_eq!(data.error.as_deref(), Some("Timeout exceeded"));
        assert_eq!(data.agent_name.as_deref(), Some("code-review"));
        assert_eq!(data.agent_display_name.as_deref(), Some("Code Review"));
    } else {
        panic!("expected SubagentFailed variant");
    }
}

#[test]
fn v1_0_24_session_start_has_remote_steerable() {
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    let start = find_session_start(&parsed.events);
    if let TypedEventData::SessionStart(data) = start {
        assert_eq!(data.remote_steerable, Some(true));
    } else {
        panic!("expected SessionStart variant");
    }
}

#[test]
fn v1_0_11_subagent_completed_has_agent_name() {
    let parsed = parse_typed_events(&fixture_path("v1_0_11.jsonl")).unwrap();
    let sub = find_subagent_completed(&parsed.events);
    if let TypedEventData::SubagentCompleted(data) = sub {
        assert_eq!(data.agent_name.as_deref(), Some("explore"));
    } else {
        panic!("expected SubagentCompleted variant");
    }
}

// ===========================================================================
// Turn reconstruction tests — verify subagent fields per version
// ===========================================================================

#[test]
fn turn_reconstruction_v1_0_2() {
    let parsed = parse_typed_events(&fixture_path("v1_0_2.jsonl")).unwrap();
    let turns = reconstruct_turns(&parsed.events);
    assert!(!turns.is_empty(), "should produce at least one turn");

    let turn = &turns[0];
    assert_eq!(turn.user_message.as_deref(), Some("Hello world"));
    assert!(!turn.tool_calls.is_empty(), "turn should have tool calls");

    // Find the subagent tool call
    let subagent_tc = turn.tool_calls.iter().find(|tc| tc.is_subagent);
    assert!(
        subagent_tc.is_some(),
        "should have a subagent tool call in turn"
    );
    let sub = subagent_tc.unwrap();
    assert_eq!(sub.agent_display_name.as_deref(), Some("Explore Agent"));
    // v1.0.2: no subagent metrics
    assert!(sub.model.is_none());
    assert!(sub.total_tokens.is_none());
    assert!(sub.total_tool_calls.is_none());
}

#[test]
fn turn_reconstruction_v1_0_8() {
    let parsed = parse_typed_events(&fixture_path("v1_0_8.jsonl")).unwrap();
    let turns = reconstruct_turns(&parsed.events);
    assert!(!turns.is_empty());

    let turn = &turns[0];
    assert_eq!(turn.user_message.as_deref(), Some("Add tests"));

    let subagent_tc = turn.tool_calls.iter().find(|tc| tc.is_subagent);
    assert!(subagent_tc.is_some());
    let sub = subagent_tc.unwrap();
    // v1.0.8: still no subagent metrics
    assert!(sub.model.is_none());
    assert!(sub.total_tokens.is_none());
}

#[test]
fn turn_reconstruction_v1_0_11() {
    let parsed = parse_typed_events(&fixture_path("v1_0_11.jsonl")).unwrap();
    let turns = reconstruct_turns(&parsed.events);
    assert!(!turns.is_empty());

    let turn = &turns[0];
    assert_eq!(turn.user_message.as_deref(), Some("Refactor module"));

    let subagent_tc = turn.tool_calls.iter().find(|tc| tc.is_subagent);
    assert!(subagent_tc.is_some());
    let sub = subagent_tc.unwrap();
    // v1.0.11: subagent metrics present
    assert_eq!(sub.model.as_deref(), Some("gpt-5.4"));
    assert_eq!(sub.total_tokens, Some(50000));
    assert_eq!(sub.total_tool_calls, Some(10));
    assert_eq!(sub.duration_ms, Some(5000));
}

#[test]
fn turn_reconstruction_v1_0_24() {
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    let turns = reconstruct_turns(&parsed.events);
    assert!(!turns.is_empty());

    let turn = &turns[0];
    assert_eq!(turn.user_message.as_deref(), Some("Analyze performance"));

    let subagent_tc = turn.tool_calls.iter().find(|tc| tc.is_subagent);
    assert!(subagent_tc.is_some());
    let sub = subagent_tc.unwrap();
    assert_eq!(sub.model.as_deref(), Some("claude-opus-4.6"));
    assert_eq!(sub.total_tokens, Some(75000));
    assert_eq!(sub.total_tool_calls, Some(15));
    assert_eq!(sub.duration_ms, Some(8000));
}

// ===========================================================================
// Cross-version: verify progressive field appearance
// ===========================================================================

#[test]
fn token_budget_absent_before_v1_0_8_present_after() {
    let fixtures_without = ["v1_0_2.jsonl", "v1_0_7.jsonl"];
    let fixtures_with = ["v1_0_8.jsonl", "v1_0_11.jsonl", "v1_0_24.jsonl"];

    for name in &fixtures_without {
        let parsed = parse_typed_events(&fixture_path(name)).unwrap();
        let shutdown = find_shutdown(&parsed.events);
        if let TypedEventData::SessionShutdown(data) = shutdown {
            assert!(
                data.current_tokens.is_none(),
                "{name} should NOT have currentTokens"
            );
        } else {
            panic!("{name}: expected SessionShutdown variant");
        }
    }

    for name in &fixtures_with {
        let parsed = parse_typed_events(&fixture_path(name)).unwrap();
        let shutdown = find_shutdown(&parsed.events);
        if let TypedEventData::SessionShutdown(data) = shutdown {
            assert!(
                data.current_tokens.is_some(),
                "{name} SHOULD have currentTokens"
            );
            assert!(
                data.system_tokens.is_some(),
                "{name} SHOULD have systemTokens"
            );
            assert!(
                data.conversation_tokens.is_some(),
                "{name} SHOULD have conversationTokens"
            );
            assert!(
                data.tool_definitions_tokens.is_some(),
                "{name} SHOULD have toolDefinitionsTokens"
            );
        } else {
            panic!("{name}: expected SessionShutdown variant");
        }
    }
}

#[test]
fn subagent_metrics_absent_before_v1_0_11_present_after() {
    let fixtures_without = ["v1_0_2.jsonl", "v1_0_7.jsonl", "v1_0_8.jsonl"];
    let fixtures_with = ["v1_0_11.jsonl", "v1_0_24.jsonl"];

    for name in &fixtures_without {
        let parsed = parse_typed_events(&fixture_path(name)).unwrap();
        let sub = find_subagent_completed(&parsed.events);
        if let TypedEventData::SubagentCompleted(data) = sub {
            assert!(
                data.total_tokens.is_none(),
                "{name} should NOT have subagent totalTokens"
            );
            assert!(
                data.model.is_none(),
                "{name} should NOT have subagent model"
            );
        } else {
            panic!("{name}: expected SubagentCompleted variant");
        }
    }

    for name in &fixtures_with {
        let parsed = parse_typed_events(&fixture_path(name)).unwrap();
        let sub = find_subagent_completed(&parsed.events);
        if let TypedEventData::SubagentCompleted(data) = sub {
            assert!(
                data.total_tokens.is_some(),
                "{name} SHOULD have subagent totalTokens"
            );
            assert!(
                data.model.is_some(),
                "{name} SHOULD have subagent model"
            );
            assert!(
                data.total_tool_calls.is_some(),
                "{name} SHOULD have subagent totalToolCalls"
            );
            assert!(
                data.duration_ms.is_some(),
                "{name} SHOULD have subagent durationMs"
            );
        } else {
            panic!("{name}: expected SubagentCompleted variant");
        }
    }
}

#[test]
fn reasoning_tokens_only_in_v1_0_24() {
    let fixtures_without = [
        "v1_0_2.jsonl",
        "v1_0_7.jsonl",
        "v1_0_8.jsonl",
        "v1_0_11.jsonl",
    ];

    for name in &fixtures_without {
        let parsed = parse_typed_events(&fixture_path(name)).unwrap();
        let shutdown = find_shutdown(&parsed.events);
        if let TypedEventData::SessionShutdown(data) = shutdown {
            if let Some(ref mm) = data.model_metrics {
                for (_model, detail) in mm {
                    if let Some(ref usage) = detail.usage {
                        assert!(
                            usage.reasoning_tokens.is_none(),
                            "{name} should NOT have reasoningTokens"
                        );
                    }
                }
            }
        } else {
            panic!("{name}: expected SessionShutdown variant");
        }
    }

    // v1.0.24 has reasoning_tokens
    let parsed = parse_typed_events(&fixture_path("v1_0_24.jsonl")).unwrap();
    let shutdown = find_shutdown(&parsed.events);
    if let TypedEventData::SessionShutdown(data) = shutdown {
        let mm = data.model_metrics.as_ref().unwrap();
        let usage = mm["claude-opus-4.6"].usage.as_ref().unwrap();
        assert_eq!(usage.reasoning_tokens, Some(300));
    } else {
        panic!("v1_0_24: expected SessionShutdown variant");
    }
}
