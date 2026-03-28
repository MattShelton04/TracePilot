//! Shared test helpers for analytics tests.
//!
//! Contains factory functions for creating test fixtures used across
//! `dashboard`, `tools`, and `code_impact` test modules.

use chrono::{TimeZone, Utc};
use std::collections::HashMap;

use crate::models::conversation::{AttributedMessage, ConversationTurn, TurnToolCall};
use crate::models::event_types::{CodeChanges, ModelMetricDetail, RequestMetrics, UsageMetrics};
use crate::models::session_summary::{SessionSummary, ShutdownMetrics};

use super::types::SessionAnalyticsInput;

/// Create a minimal `SessionAnalyticsInput` with shutdown metrics.
pub(super) fn make_input(
    id: &str,
    date: &str,
    model: &str,
    tokens: u64,
    cost: f64,
    turns: u32,
) -> SessionAnalyticsInput {
    let dt = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .unwrap()
        .and_hms_opt(12, 0, 0)
        .unwrap();
    let updated = Utc.from_utc_datetime(&dt);

    let mut model_metrics = HashMap::new();
    model_metrics.insert(
        model.to_string(),
        ModelMetricDetail {
            requests: Some(RequestMetrics {
                count: Some(turns as u64),
                cost: Some(cost),
            }),
            usage: Some(UsageMetrics {
                input_tokens: Some(tokens / 2),
                output_tokens: Some(tokens / 2),
                cache_read_tokens: Some(0),
                cache_write_tokens: Some(0),
            }),
        },
    );

    SessionAnalyticsInput {
        summary: SessionSummary {
            id: id.to_string(),
            summary: Some(format!("Session {}", id)),
            repository: Some("test/repo".to_string()),
            branch: Some("main".to_string()),
            cwd: None,
            host_type: Some("vscode".to_string()),
            created_at: Some(updated),
            updated_at: Some(updated),
            event_count: Some(100),
            has_events: true,
            has_session_db: false,
            has_plan: false,
            has_checkpoints: false,
            checkpoint_count: None,
            turn_count: Some(turns as usize),
            shutdown_metrics: Some(ShutdownMetrics {
                shutdown_type: Some("normal".to_string()),
                total_premium_requests: Some(turns as f64),
                total_api_duration_ms: Some(5000),
                session_start_time: Some(updated.timestamp_millis() as u64 - 300_000),
                current_model: Some(model.to_string()),
                code_changes: Some(CodeChanges {
                    lines_added: Some(50),
                    lines_removed: Some(10),
                    files_modified: Some(vec!["src/main.rs".to_string(), "src/lib.rs".to_string()]),
                }),
                model_metrics,
                session_segments: None,
                shutdown_count: None,
            }),
        },
        turns: None,
    }
}

/// Create a `SessionAnalyticsInput` with specific code change data.
pub(super) fn make_input_with_code(
    id: &str,
    date: &str,
    added: u64,
    removed: u64,
    files: Vec<&str>,
) -> SessionAnalyticsInput {
    let mut input = make_input(id, date, "claude-opus-4.6", 1000, 0.5, 5);
    if let Some(ref mut metrics) = input.summary.shutdown_metrics {
        metrics.code_changes = Some(CodeChanges {
            lines_added: Some(added),
            lines_removed: Some(removed),
            files_modified: Some(files.into_iter().map(String::from).collect()),
        });
    }
    input
}

/// Create a `TurnToolCall` test fixture.
pub(super) fn make_tool_call(
    name: &str,
    success: Option<bool>,
    duration_ms: Option<u64>,
    started_at: Option<chrono::DateTime<Utc>>,
) -> TurnToolCall {
    TurnToolCall {
        tool_call_id: Some("tc1".to_string()),
        parent_tool_call_id: None,
        tool_name: name.to_string(),
        event_index: None,
        arguments: None,
        success,
        error: None,
        started_at,
        completed_at: None,
        duration_ms,
        mcp_server_name: None,
        mcp_tool_name: None,
        is_complete: true,
        is_subagent: false,
        agent_display_name: None,
        agent_description: None,
        model: None,
        intention_summary: None,
        result_content: None,
        args_summary: None,
    }
}

/// Create a `ConversationTurn` with the given tool calls.
pub(super) fn make_turn_with_tools(tool_calls: Vec<TurnToolCall>) -> ConversationTurn {
    ConversationTurn {
        turn_index: 0,
        event_index: None,
        turn_id: None,
        interaction_id: None,
        user_message: Some("test".to_string()),
        assistant_messages: vec![AttributedMessage {
            content: "response".to_string(),
            parent_tool_call_id: None,
            agent_display_name: None,
        }],
        model: Some("model".to_string()),
        timestamp: None,
        end_timestamp: None,
        tool_calls,
        duration_ms: None,
        is_complete: true,
        reasoning_texts: Vec::new(),
        output_tokens: None,
        transformed_user_message: None,
        attachments: None,
        session_events: Vec::new(),
    }
}
