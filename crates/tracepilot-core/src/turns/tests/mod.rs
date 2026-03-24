//! Turn reconstruction test suite.
//!
//! This module contains comprehensive tests for the turn reconstruction state machine.
//! Tests are organized by functional domain:
//!
//! - `turn_reconstruction`: Basic turn lifecycle tests
//! - `message_handling`: Message filtering, reasoning extraction
//! - `tool_execution`: Tool call lifecycle tests
//! - `subagent_lifecycle`: Subagent state machine tests
//! - `model_tracking`: Model inference and propagation tests
//! - `session_events`: Session-level event handling (errors, warnings, compaction, etc.)
//! - `performance`: Performance regression tests (marked with #[ignore])

use super::*;
use crate::models::conversation::{AttributedMessage, SessionEventSeverity};
use crate::models::event_types::{
    AbortData, AssistantMessageData, AssistantReasoningData, CompactionCompleteData,
    CompactionStartData, ModelChangeData, PlanChangedData, SessionErrorData,
    SessionModeChangedData, SessionResumeData, SessionStartData, SessionTruncationData,
    SessionWarningData, SubagentCompletedData, SubagentFailedData, SubagentStartedData,
    ToolExecCompleteData, ToolExecStartData, TurnEndData, TurnStartData, UserMessageData,
};
use crate::parsing::events::{RawEvent, TypedEvent};
use serde_json::{Value, json};

// Declare test submodules
mod turn_reconstruction;
mod message_handling;
mod tool_execution;
mod subagent_lifecycle;
mod model_tracking;
mod session_events;
mod performance;

// ============================================================================
// Common Test Helpers
// ============================================================================

/// Helper: extract message content strings for easy assertion.
pub(super) fn msg_contents(messages: &[AttributedMessage]) -> Vec<&str> {
    messages.iter().map(|m| m.content.as_str()).collect()
}

/// Helper: build a TypedEvent with convenient defaults.
pub(super) fn make_event(
    event_type: SessionEventType,
    data: TypedEventData,
    id: &str,
    ts: &str,
    parent: Option<&str>,
) -> TypedEvent {
    let raw_data = typed_data_to_value(&data);
    TypedEvent {
        raw: RawEvent {
            event_type: event_type.to_string(),
            data: raw_data,
            id: Some(id.to_string()),
            timestamp: Some(
                chrono::DateTime::parse_from_rfc3339(ts)
                    .unwrap()
                    .with_timezone(&Utc),
            ),
            parent_id: parent.map(str::to_string),
        },
        event_type,
        typed_data: data,
    }
}

/// Helper: convert TypedEventData to JSON Value.
pub(super) fn typed_data_to_value(data: &TypedEventData) -> Value {
    match data {
        TypedEventData::SessionStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionShutdown(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::UserMessage(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::AssistantMessage(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::TurnStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::TurnEnd(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ToolExecutionStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ToolExecutionComplete(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentStarted(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentCompleted(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentFailed(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::CompactionComplete(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::CompactionStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ModelChange(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionError(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionResume(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SystemNotification(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SkillInvoked(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::Abort(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::PlanChanged(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionInfo(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ContextChanged(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::WorkspaceFileChanged(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::ToolUserRequested(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionTruncation(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::AssistantReasoning(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SystemMessage(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionWarning(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionModeChanged(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionTaskComplete(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentSelected(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SubagentDeselected(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::HookStart(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::HookEnd(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionHandoff(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::SessionImportLegacy(value) => serde_json::to_value(value).unwrap(),
        TypedEventData::Other(value) => value.clone(),
    }
}

/// Helper: base subagent event sequence for lifecycle tests.
///
/// Returns a tuple of (UserMessage, TurnStart, ToolExecStart, SubagentStarted)
/// with consistent IDs and timestamps for testing subagent event merging.
pub(super) fn base_subagent_events() -> (TypedEvent, TypedEvent, TypedEvent, TypedEvent) {
    let user_msg = make_event(
        SessionEventType::UserMessage,
        TypedEventData::UserMessage(UserMessageData {
            content: Some("Do something".to_string()),
            transformed_content: None,
            attachments: None,
            interaction_id: Some("int-1".to_string()),
            source: None,
            agent_mode: None,
        }),
        "evt-1",
        "2026-03-18T00:00:00.000Z",
        None,
    );
    let turn_start = make_event(
        SessionEventType::AssistantTurnStart,
        TypedEventData::TurnStart(TurnStartData {
            turn_id: Some("turn-1".to_string()),
            interaction_id: Some("int-1".to_string()),
        }),
        "evt-2",
        "2026-03-18T00:00:00.100Z",
        Some("evt-1"),
    );
    let tool_start = make_event(
        SessionEventType::ToolExecutionStart,
        TypedEventData::ToolExecutionStart(ToolExecStartData {
            tool_call_id: Some("tc-sub".to_string()),
            tool_name: Some("task".to_string()),
            arguments: Some(json!({"agent_type": "explore", "prompt": "Find files"})),
            parent_tool_call_id: None,
            mcp_server_name: None,
            mcp_tool_name: None,
        }),
        "evt-3",
        "2026-03-18T00:00:01.000Z",
        Some("evt-2"),
    );
    let sub_started = make_event(
        SessionEventType::SubagentStarted,
        TypedEventData::SubagentStarted(SubagentStartedData {
            tool_call_id: Some("tc-sub".to_string()),
            agent_name: Some("explore".to_string()),
            agent_display_name: Some("Explore Agent".to_string()),
            agent_description: Some("Explores the codebase".to_string()),
        }),
        "evt-4",
        "2026-03-18T00:00:01.100Z",
        Some("evt-3"),
    );
    (user_msg, turn_start, tool_start, sub_started)
}
