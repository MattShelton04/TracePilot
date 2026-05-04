use super::super::SearchContentRow;
use tracepilot_core::ids::SessionId;
use tracepilot_core::models::event_types::{
    AbortData, AssistantMessageData, AssistantReasoningData, SessionErrorData, SessionEventType,
    ToolExecCompleteData, ToolExecStartData, TurnEndData, TurnStartData, UserMessageData,
};
use tracepilot_core::parsing::events::{RawEvent, TypedEvent, TypedEventData};

pub(super) fn sid() -> SessionId {
    SessionId::from_validated("s1")
}

/// Build a TypedEvent from its components.
pub(super) fn evt(event_type: SessionEventType, typed_data: TypedEventData) -> TypedEvent {
    TypedEvent {
        raw: RawEvent {
            event_type: String::new(),
            data: serde_json::Value::Null,
            id: None,
            timestamp: None,
            parent_id: None,
        },
        event_type,
        typed_data,
    }
}

pub(super) fn user_message(content: &str) -> TypedEvent {
    evt(
        SessionEventType::UserMessage,
        TypedEventData::UserMessage(UserMessageData {
            content: Some(content.to_string()),
            transformed_content: None,
            attachments: None,
            interaction_id: None,
            source: None,
            agent_mode: None,
            supported_native_document_mime_types: None,
            native_document_path_fallback_paths: None,
            parent_agent_task_id: None,
        }),
    )
}

pub(super) fn assistant_turn_start() -> TypedEvent {
    evt(
        SessionEventType::AssistantTurnStart,
        TypedEventData::TurnStart(TurnStartData {
            turn_id: None,
            interaction_id: None,
        }),
    )
}

pub(super) fn assistant_turn_end() -> TypedEvent {
    evt(
        SessionEventType::AssistantTurnEnd,
        TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
    )
}

pub(super) fn assistant_message(content: &str) -> TypedEvent {
    evt(
        SessionEventType::AssistantMessage,
        TypedEventData::AssistantMessage(AssistantMessageData {
            message_id: None,
            content: Some(content.to_string()),
            interaction_id: None,
            tool_requests: None,
            output_tokens: None,
            parent_tool_call_id: None,
            reasoning_text: None,
            reasoning_opaque: None,
            encrypted_content: None,
            phase: None,
            request_id: None,
            turn_id: None,
        }),
    )
}

pub(super) fn tool_exec_start(name: &str, call_id: &str) -> TypedEvent {
    evt(
        SessionEventType::ToolExecutionStart,
        TypedEventData::ToolExecutionStart(ToolExecStartData {
            tool_name: Some(name.to_string()),
            tool_call_id: Some(call_id.to_string()),
            arguments: Some(serde_json::json!({"path": "test.rs"})),
            parent_tool_call_id: None,
            mcp_server_name: None,
            mcp_tool_name: None,
            turn_id: None,
        }),
    )
}

pub(super) fn reasoning(content: &str) -> TypedEvent {
    evt(
        SessionEventType::AssistantReasoning,
        TypedEventData::AssistantReasoning(AssistantReasoningData {
            reasoning_id: None,
            content: Some(content.to_string()),
        }),
    )
}

pub(super) fn abort() -> TypedEvent {
    evt(
        SessionEventType::Abort,
        TypedEventData::Abort(AbortData { reason: None }),
    )
}

pub(super) fn tool_exec_complete(call_id: &str, result_text: &str) -> TypedEvent {
    evt(
        SessionEventType::ToolExecutionComplete,
        TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
            tool_call_id: Some(call_id.to_string()),
            parent_tool_call_id: None,
            model: None,
            interaction_id: None,
            success: Some(true),
            result: Some(serde_json::json!(result_text)),
            error: None,
            tool_telemetry: None,
            is_user_requested: None,
            turn_id: None,
        }),
    )
}

pub(super) fn session_error(msg: &str) -> TypedEvent {
    evt(
        SessionEventType::SessionError,
        TypedEventData::SessionError(SessionErrorData {
            error_type: Some("TestError".to_string()),
            message: Some(msg.to_string()),
            stack: None,
            status_code: None,
            provider_call_id: None,
            url: None,
            error_code: None,
            eligible_for_auto_switch: None,
        }),
    )
}

/// Collect (turn_number, content_type) pairs from extracted rows.
pub(super) fn turn_map(rows: &[SearchContentRow]) -> Vec<(Option<i64>, &str)> {
    rows.iter()
        .map(|r| (r.turn_number, r.content_type))
        .collect()
}
