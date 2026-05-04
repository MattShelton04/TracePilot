//! Test data builders for turn reconstruction tests.
//!
//! This module provides fluent builder APIs for constructing test events
//! with sensible defaults, reducing boilerplate in test code.
//!
// Builder methods exist for completeness and future test coverage.
#![allow(dead_code, clippy::wrong_self_convention)]
//! # Example
//! ```ignore
//! use super::builders::*;
//!
//! // Build a complete event sequence
//! let events = vec![
//!     user_msg("Hello").id("evt-1").build_event(),
//!     turn_start().id("evt-2").turn_id("t1").parent("evt-1").build_event(),
//!     asst_msg("Hi!").id("evt-3").parent("evt-2").build_event(),
//!     turn_end().id("evt-4").parent("evt-2").build_event(),
//! ];
//! ```

use super::*;
use crate::models::event_types::*;
use crate::parsing::events::TypedEvent;
use serde_json::Value;

// ============================================================================
// Core Event Builder
// ============================================================================

/// High-level event builder that produces TypedEvent instances.
#[must_use = "builders do nothing unless consumed"]
pub struct EventBuilder {
    event_type: SessionEventType,
    typed_data: TypedEventData,
    id: String,
    timestamp: String,
    parent_id: Option<String>,
}

impl EventBuilder {
    fn new(event_type: SessionEventType, typed_data: TypedEventData) -> Self {
        Self {
            event_type,
            typed_data,
            id: "evt".to_string(),
            timestamp: "2026-03-10T07:00:00.000Z".to_string(),
            parent_id: None,
        }
    }

    pub fn id(mut self, id: impl Into<String>) -> Self {
        self.id = id.into();
        self
    }

    pub fn timestamp(mut self, ts: impl Into<String>) -> Self {
        self.timestamp = ts.into();
        self
    }

    pub fn parent(mut self, parent_id: impl Into<String>) -> Self {
        self.parent_id = Some(parent_id.into());
        self
    }

    pub fn build_event(self) -> TypedEvent {
        make_event(
            self.event_type,
            self.typed_data,
            &self.id,
            &self.timestamp,
            self.parent_id.as_deref(),
        )
    }
}

// ============================================================================
// User Message Builder
// ============================================================================

/// Builder for user message events.
#[must_use = "builders do nothing unless consumed"]
pub struct UserMessageBuilder {
    content: String,
    interaction_id: Option<String>,
    transformed_content: Option<String>,
    attachments: Option<Vec<Value>>,
    source: Option<String>,
    agent_mode: Option<String>,
}

impl UserMessageBuilder {
    fn new(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            interaction_id: None,
            transformed_content: None,
            attachments: None,
            source: None,
            agent_mode: None,
        }
    }

    pub fn interaction_id(mut self, id: impl Into<String>) -> Self {
        self.interaction_id = Some(id.into());
        self
    }

    pub fn transformed_content(mut self, content: impl Into<String>) -> Self {
        self.transformed_content = Some(content.into());
        self
    }

    pub fn attachments(mut self, attachments: Vec<Value>) -> Self {
        self.attachments = Some(attachments);
        self
    }

    pub fn source(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }

    pub fn agent_mode(mut self, mode: impl Into<String>) -> Self {
        self.agent_mode = Some(mode.into());
        self
    }

    fn build_data(self) -> UserMessageData {
        UserMessageData {
            content: Some(self.content),
            interaction_id: self.interaction_id,
            transformed_content: self.transformed_content,
            attachments: self.attachments,
            supported_native_document_mime_types: None,
            native_document_path_fallback_paths: None,
            source: self.source,
            agent_mode: self.agent_mode,
            parent_agent_task_id: None,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(self.build_data()),
        )
    }
}

// ============================================================================
// Assistant Message Builder
// ============================================================================

/// Builder for assistant message events.
#[must_use = "builders do nothing unless consumed"]
pub struct AssistantMessageBuilder {
    content: Option<String>,
    message_id: Option<String>,
    interaction_id: Option<String>,
    tool_requests: Option<Vec<Value>>,
    output_tokens: Option<u64>,
    parent_tool_call_id: Option<String>,
    reasoning_text: Option<String>,
    reasoning_opaque: Option<String>,
    encrypted_content: Option<String>,
    phase: Option<String>,
}

impl AssistantMessageBuilder {
    fn new() -> Self {
        Self {
            content: None,
            message_id: None,
            interaction_id: None,
            tool_requests: None,
            output_tokens: None,
            parent_tool_call_id: None,
            reasoning_text: None,
            reasoning_opaque: None,
            encrypted_content: None,
            phase: None,
        }
    }

    pub fn content(mut self, content: impl Into<String>) -> Self {
        self.content = Some(content.into());
        self
    }

    pub fn message_id(mut self, id: impl Into<String>) -> Self {
        self.message_id = Some(id.into());
        self
    }

    pub fn interaction_id(mut self, id: impl Into<String>) -> Self {
        self.interaction_id = Some(id.into());
        self
    }

    pub fn tool_requests(mut self, requests: Vec<Value>) -> Self {
        self.tool_requests = Some(requests);
        self
    }

    pub fn output_tokens(mut self, tokens: u64) -> Self {
        self.output_tokens = Some(tokens);
        self
    }

    pub fn parent_tool_call_id(mut self, id: impl Into<String>) -> Self {
        self.parent_tool_call_id = Some(id.into());
        self
    }

    pub fn reasoning_text(mut self, text: impl Into<String>) -> Self {
        self.reasoning_text = Some(text.into());
        self
    }

    pub fn reasoning_opaque(mut self, opaque: impl Into<String>) -> Self {
        self.reasoning_opaque = Some(opaque.into());
        self
    }

    pub fn encrypted_content(mut self, content: impl Into<String>) -> Self {
        self.encrypted_content = Some(content.into());
        self
    }

    pub fn phase(mut self, phase: impl Into<String>) -> Self {
        self.phase = Some(phase.into());
        self
    }

    fn build_data(self) -> AssistantMessageData {
        AssistantMessageData {
            content: self.content,
            message_id: self.message_id,
            turn_id: None,
            interaction_id: self.interaction_id,
            tool_requests: self.tool_requests,
            output_tokens: self.output_tokens,
            parent_tool_call_id: self.parent_tool_call_id,
            reasoning_text: self.reasoning_text,
            reasoning_opaque: self.reasoning_opaque,
            encrypted_content: self.encrypted_content,
            phase: self.phase,
            request_id: None,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(self.build_data()),
        )
    }
}

// ============================================================================
// Turn Start/End Builders
// ============================================================================

/// Builder for turn start events.
#[must_use = "builders do nothing unless consumed"]
pub struct TurnStartBuilder {
    turn_id: Option<String>,
    interaction_id: Option<String>,
}

impl TurnStartBuilder {
    fn new() -> Self {
        Self {
            turn_id: None,
            interaction_id: None,
        }
    }

    pub fn turn_id(mut self, id: impl Into<String>) -> Self {
        self.turn_id = Some(id.into());
        self
    }

    pub fn interaction_id(mut self, id: impl Into<String>) -> Self {
        self.interaction_id = Some(id.into());
        self
    }

    fn build_data(self) -> TurnStartData {
        TurnStartData {
            turn_id: self.turn_id,
            interaction_id: self.interaction_id,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(self.build_data()),
        )
    }
}

/// Builder for turn end events.
#[must_use = "builders do nothing unless consumed"]
pub struct TurnEndBuilder {
    turn_id: Option<String>,
}

impl TurnEndBuilder {
    fn new() -> Self {
        Self { turn_id: None }
    }

    pub fn turn_id(mut self, id: impl Into<String>) -> Self {
        self.turn_id = Some(id.into());
        self
    }

    fn build_data(self) -> TurnEndData {
        TurnEndData {
            turn_id: self.turn_id,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(self.build_data()),
        )
    }
}

// ============================================================================
// Tool Execution Builders
// ============================================================================

/// Builder for tool execution start events.
#[must_use = "builders do nothing unless consumed"]
pub struct ToolExecStartBuilder {
    tool_call_id: Option<String>,
    tool_name: Option<String>,
    arguments: Option<Value>,
    parent_tool_call_id: Option<String>,
    mcp_server_name: Option<String>,
    mcp_tool_name: Option<String>,
}

impl ToolExecStartBuilder {
    fn new(tool_name: impl Into<String>) -> Self {
        Self {
            tool_call_id: None,
            tool_name: Some(tool_name.into()),
            arguments: None,
            parent_tool_call_id: None,
            mcp_server_name: None,
            mcp_tool_name: None,
        }
    }

    pub fn tool_call_id(mut self, id: impl Into<String>) -> Self {
        self.tool_call_id = Some(id.into());
        self
    }

    pub fn arguments(mut self, args: Value) -> Self {
        self.arguments = Some(args);
        self
    }

    pub fn parent_tool_call_id(mut self, id: impl Into<String>) -> Self {
        self.parent_tool_call_id = Some(id.into());
        self
    }

    pub fn mcp_server(mut self, name: impl Into<String>) -> Self {
        self.mcp_server_name = Some(name.into());
        self
    }

    pub fn mcp_tool(mut self, name: impl Into<String>) -> Self {
        self.mcp_tool_name = Some(name.into());
        self
    }

    fn build_data(self) -> ToolExecStartData {
        ToolExecStartData {
            tool_call_id: self.tool_call_id,
            turn_id: None,
            tool_name: self.tool_name,
            arguments: self.arguments,
            parent_tool_call_id: self.parent_tool_call_id,
            mcp_server_name: self.mcp_server_name,
            mcp_tool_name: self.mcp_tool_name,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(self.build_data()),
        )
    }
}

/// Builder for tool execution complete events.
#[must_use = "builders do nothing unless consumed"]
pub struct ToolExecCompleteBuilder {
    tool_call_id: Option<String>,
    parent_tool_call_id: Option<String>,
    model: Option<String>,
    interaction_id: Option<String>,
    success: Option<bool>,
    result: Option<Value>,
    error: Option<Value>,
    tool_telemetry: Option<Value>,
    is_user_requested: Option<bool>,
}

impl ToolExecCompleteBuilder {
    fn new(tool_call_id: impl Into<String>) -> Self {
        Self {
            tool_call_id: Some(tool_call_id.into()),
            parent_tool_call_id: None,
            model: None,
            interaction_id: None,
            success: None,
            result: None,
            error: None,
            tool_telemetry: None,
            is_user_requested: None,
        }
    }

    pub fn parent_tool_call_id(mut self, id: impl Into<String>) -> Self {
        self.parent_tool_call_id = Some(id.into());
        self
    }

    pub fn model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    pub fn interaction_id(mut self, id: impl Into<String>) -> Self {
        self.interaction_id = Some(id.into());
        self
    }

    pub fn success(mut self, success: bool) -> Self {
        self.success = Some(success);
        self
    }

    pub fn result(mut self, result: Value) -> Self {
        self.result = Some(result);
        self
    }

    pub fn error(mut self, error: Value) -> Self {
        self.error = Some(error);
        self
    }

    pub fn tool_telemetry(mut self, telemetry: Value) -> Self {
        self.tool_telemetry = Some(telemetry);
        self
    }

    pub fn is_user_requested(mut self, requested: bool) -> Self {
        self.is_user_requested = Some(requested);
        self
    }

    fn build_data(self) -> ToolExecCompleteData {
        ToolExecCompleteData {
            tool_call_id: self.tool_call_id,
            turn_id: None,
            parent_tool_call_id: self.parent_tool_call_id,
            model: self.model,
            interaction_id: self.interaction_id,
            success: self.success,
            result: self.result,
            error: self.error,
            tool_telemetry: self.tool_telemetry,
            is_user_requested: self.is_user_requested,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(self.build_data()),
        )
    }
}

// ============================================================================
// Subagent Builders
// ============================================================================

/// Builder for subagent started events.
#[must_use = "builders do nothing unless consumed"]
pub struct SubagentStartedBuilder {
    tool_call_id: Option<String>,
    agent_name: Option<String>,
    agent_display_name: Option<String>,
    agent_description: Option<String>,
}

impl SubagentStartedBuilder {
    fn new(agent_name: impl Into<String>) -> Self {
        Self {
            tool_call_id: None,
            agent_name: Some(agent_name.into()),
            agent_display_name: None,
            agent_description: None,
        }
    }

    pub fn tool_call_id(mut self, id: impl Into<String>) -> Self {
        self.tool_call_id = Some(id.into());
        self
    }

    pub fn agent_display_name(mut self, name: impl Into<String>) -> Self {
        self.agent_display_name = Some(name.into());
        self
    }

    pub fn agent_description(mut self, desc: impl Into<String>) -> Self {
        self.agent_description = Some(desc.into());
        self
    }

    fn build_data(self) -> SubagentStartedData {
        SubagentStartedData {
            tool_call_id: self.tool_call_id,
            agent_name: self.agent_name,
            agent_display_name: self.agent_display_name,
            agent_description: self.agent_description,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(self.build_data()),
        )
    }
}

/// Builder for subagent completed events.
#[must_use = "builders do nothing unless consumed"]
pub struct SubagentCompletedBuilder {
    tool_call_id: Option<String>,
    agent_name: Option<String>,
    agent_display_name: Option<String>,
    model: Option<String>,
}

impl SubagentCompletedBuilder {
    fn new(agent_name: impl Into<String>) -> Self {
        Self {
            tool_call_id: None,
            agent_name: Some(agent_name.into()),
            agent_display_name: None,
            model: None,
        }
    }

    pub fn tool_call_id(mut self, id: impl Into<String>) -> Self {
        self.tool_call_id = Some(id.into());
        self
    }

    pub fn agent_display_name(mut self, name: impl Into<String>) -> Self {
        self.agent_display_name = Some(name.into());
        self
    }

    pub fn model(mut self, model: impl Into<String>) -> Self {
        self.model = Some(model.into());
        self
    }

    fn build_data(self) -> SubagentCompletedData {
        SubagentCompletedData {
            tool_call_id: self.tool_call_id,
            agent_name: self.agent_name,
            agent_display_name: self.agent_display_name,
            duration_ms: None,
            model: self.model,
            total_tokens: None,
            total_tool_calls: None,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(self.build_data()),
        )
    }
}

/// Builder for subagent failed events.
#[must_use = "builders do nothing unless consumed"]
pub struct SubagentFailedBuilder {
    tool_call_id: Option<String>,
    agent_name: Option<String>,
    agent_display_name: Option<String>,
    error: Option<String>,
}

impl SubagentFailedBuilder {
    fn new(agent_name: impl Into<String>) -> Self {
        Self {
            tool_call_id: None,
            agent_name: Some(agent_name.into()),
            agent_display_name: None,
            error: None,
        }
    }

    pub fn tool_call_id(mut self, id: impl Into<String>) -> Self {
        self.tool_call_id = Some(id.into());
        self
    }

    pub fn agent_display_name(mut self, name: impl Into<String>) -> Self {
        self.agent_display_name = Some(name.into());
        self
    }

    pub fn error(mut self, msg: impl Into<String>) -> Self {
        self.error = Some(msg.into());
        self
    }

    fn build_data(self) -> SubagentFailedData {
        SubagentFailedData {
            tool_call_id: self.tool_call_id,
            agent_name: self.agent_name,
            agent_display_name: self.agent_display_name,
            error: self.error,
            duration_ms: None,
            model: None,
            total_tokens: None,
            total_tool_calls: None,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SubagentFailed,
            TypedEventData::SubagentFailed(self.build_data()),
        )
    }
}

// ============================================================================
// Session Event Builders
// ============================================================================

/// Builder for system message events (system.message).
#[must_use = "builders do nothing unless consumed"]
pub struct SystemMessageBuilder {
    content: Option<String>,
    role: Option<String>,
    name: Option<String>,
}

impl SystemMessageBuilder {
    fn new(content: impl Into<String>) -> Self {
        Self {
            content: Some(content.into()),
            role: Some("system".to_string()),
            name: None,
        }
    }

    fn new_empty() -> Self {
        Self {
            content: None,
            role: None,
            name: None,
        }
    }

    pub fn role(mut self, role: impl Into<String>) -> Self {
        self.role = Some(role.into());
        self
    }

    pub fn name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    fn build_data(self) -> SystemMessageData {
        SystemMessageData {
            content: self.content,
            role: self.role,
            name: self.name,
            metadata: None,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SystemMessage,
            TypedEventData::SystemMessage(self.build_data()),
        )
    }
}

/// Builder for session error events.
#[must_use = "builders do nothing unless consumed"]
pub struct SessionErrorBuilder {
    message: Option<String>,
    error_type: Option<String>,
    stack: Option<String>,
    status_code: Option<u16>,
    provider_call_id: Option<String>,
    url: Option<String>,
}

impl SessionErrorBuilder {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: Some(message.into()),
            error_type: None,
            stack: None,
            status_code: None,
            provider_call_id: None,
            url: None,
        }
    }

    fn new_empty() -> Self {
        Self {
            message: None,
            error_type: None,
            stack: None,
            status_code: None,
            provider_call_id: None,
            url: None,
        }
    }

    pub fn error_type(mut self, err_type: impl Into<String>) -> Self {
        self.error_type = Some(err_type.into());
        self
    }

    pub fn stack(mut self, stack: impl Into<String>) -> Self {
        self.stack = Some(stack.into());
        self
    }

    pub fn status_code(mut self, code: u16) -> Self {
        self.status_code = Some(code);
        self
    }

    pub fn provider_call_id(mut self, id: impl Into<String>) -> Self {
        self.provider_call_id = Some(id.into());
        self
    }

    pub fn url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    fn build_data(self) -> SessionErrorData {
        SessionErrorData {
            message: self.message,
            error_type: self.error_type,
            stack: self.stack,
            status_code: self.status_code,
            provider_call_id: self.provider_call_id,
            error_code: None,
            eligible_for_auto_switch: None,
            url: self.url,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SessionError,
            TypedEventData::SessionError(self.build_data()),
        )
    }
}

/// Builder for session warning events.
#[must_use = "builders do nothing unless consumed"]
pub struct SessionWarningBuilder {
    message: String,
    warning_type: Option<String>,
    url: Option<String>,
}

impl SessionWarningBuilder {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            warning_type: None,
            url: None,
        }
    }

    pub fn warning_type(mut self, warn_type: impl Into<String>) -> Self {
        self.warning_type = Some(warn_type.into());
        self
    }

    pub fn url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    fn build_data(self) -> SessionWarningData {
        SessionWarningData {
            message: Some(self.message),
            warning_type: self.warning_type,
            url: self.url,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SessionWarning,
            TypedEventData::SessionWarning(self.build_data()),
        )
    }
}

/// Builder for model change events.
#[must_use = "builders do nothing unless consumed"]
pub struct ModelChangeBuilder {
    previous_model: Option<String>,
    new_model: Option<String>,
}

impl ModelChangeBuilder {
    fn new() -> Self {
        Self {
            previous_model: None,
            new_model: None,
        }
    }

    pub fn previous_model(mut self, model: impl Into<String>) -> Self {
        self.previous_model = Some(model.into());
        self
    }

    pub fn new_model(mut self, model: impl Into<String>) -> Self {
        self.new_model = Some(model.into());
        self
    }

    fn build_data(self) -> ModelChangeData {
        ModelChangeData {
            previous_model: self.previous_model,
            new_model: self.new_model,
            previous_reasoning_effort: None,
            reasoning_effort: None,
            cause: None,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SessionModelChange,
            TypedEventData::ModelChange(self.build_data()),
        )
    }
}

/// Builder for compaction start events.
#[must_use = "builders do nothing unless consumed"]
pub struct CompactionStartBuilder {}

impl CompactionStartBuilder {
    fn new() -> Self {
        Self {}
    }

    fn build_data(self) -> CompactionStartData {
        CompactionStartData {
            system_tokens: None,
            conversation_tokens: None,
            tool_definitions_tokens: None,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SessionCompactionStart,
            TypedEventData::CompactionStart(self.build_data()),
        )
    }
}

/// Builder for compaction complete events.
#[must_use = "builders do nothing unless consumed"]
pub struct CompactionCompleteBuilder {
    success: Option<bool>,
    error: Option<String>,
    pre_compaction_tokens: Option<u64>,
    pre_compaction_messages_length: Option<u64>,
    checkpoint_number: Option<u64>,
}

impl CompactionCompleteBuilder {
    fn new() -> Self {
        Self {
            success: None,
            error: None,
            pre_compaction_tokens: None,
            pre_compaction_messages_length: None,
            checkpoint_number: None,
        }
    }

    pub fn success(mut self, success: bool) -> Self {
        self.success = Some(success);
        self
    }

    pub fn error(mut self, error: impl Into<String>) -> Self {
        self.error = Some(error.into());
        self
    }

    pub fn pre_compaction_tokens(mut self, tokens: u64) -> Self {
        self.pre_compaction_tokens = Some(tokens);
        self
    }

    pub fn pre_compaction_messages_length(mut self, length: u64) -> Self {
        self.pre_compaction_messages_length = Some(length);
        self
    }

    pub fn checkpoint_number(mut self, n: u64) -> Self {
        self.checkpoint_number = Some(n);
        self
    }

    fn build_data(self) -> CompactionCompleteData {
        CompactionCompleteData {
            success: self.success,
            error: self.error,
            pre_compaction_tokens: self.pre_compaction_tokens,
            pre_compaction_messages_length: self.pre_compaction_messages_length,
            summary_content: None,
            checkpoint_number: self.checkpoint_number,
            checkpoint_path: None,
            compaction_tokens_used: None,
            request_id: None,
            system_tokens: None,
            conversation_tokens: None,
            tool_definitions_tokens: None,
        }
    }

    fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SessionCompactionComplete,
            TypedEventData::CompactionComplete(self.build_data()),
        )
    }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/// Create a user message builder.
pub fn user_msg(content: impl Into<String>) -> UserMessageBuilder {
    UserMessageBuilder::new(content)
}

/// Create an assistant message builder with content.
pub fn asst_msg(content: impl Into<String>) -> AssistantMessageBuilder {
    AssistantMessageBuilder::new().content(content)
}

/// Create an assistant message builder (no content).
pub fn asst_msg_empty() -> AssistantMessageBuilder {
    AssistantMessageBuilder::new()
}

/// Create a turn start builder.
pub fn turn_start() -> TurnStartBuilder {
    TurnStartBuilder::new()
}

/// Create a turn end builder.
pub fn turn_end() -> TurnEndBuilder {
    TurnEndBuilder::new()
}

/// Create a tool execution start builder.
pub fn tool_start(tool_name: impl Into<String>) -> ToolExecStartBuilder {
    ToolExecStartBuilder::new(tool_name)
}

/// Create a tool execution complete builder.
pub fn tool_complete(tool_call_id: impl Into<String>) -> ToolExecCompleteBuilder {
    ToolExecCompleteBuilder::new(tool_call_id)
}

/// Create a subagent started builder.
pub fn subagent_start(agent_name: impl Into<String>) -> SubagentStartedBuilder {
    SubagentStartedBuilder::new(agent_name)
}

/// Create a subagent completed builder.
pub fn subagent_complete(agent_name: impl Into<String>) -> SubagentCompletedBuilder {
    SubagentCompletedBuilder::new(agent_name)
}

/// Create a subagent failed builder.
pub fn subagent_failed(agent_name: impl Into<String>) -> SubagentFailedBuilder {
    SubagentFailedBuilder::new(agent_name)
}

/// Create a session error builder.
pub fn session_error(message: impl Into<String>) -> SessionErrorBuilder {
    SessionErrorBuilder::new(message)
}

/// Create a session error builder with no message (for fallback tests).
pub fn session_error_empty() -> SessionErrorBuilder {
    SessionErrorBuilder::new_empty()
}

/// Create a session warning builder.
pub fn session_warning(message: impl Into<String>) -> SessionWarningBuilder {
    SessionWarningBuilder::new(message)
}

/// Create a system message builder.
pub fn system_message(content: impl Into<String>) -> SystemMessageBuilder {
    SystemMessageBuilder::new(content)
}

/// Create a system message builder with no content.
pub fn system_message_empty() -> SystemMessageBuilder {
    SystemMessageBuilder::new_empty()
}

/// Create a model change builder.
pub fn model_change() -> ModelChangeBuilder {
    ModelChangeBuilder::new()
}

/// Create a compaction start builder.
pub fn compaction_start() -> CompactionStartBuilder {
    CompactionStartBuilder::new()
}

/// Create a compaction complete builder.
pub fn compaction_complete() -> CompactionCompleteBuilder {
    CompactionCompleteBuilder::new()
}

// ============================================================================
// Builder Extensions for Chaining
// ============================================================================

/// Macro to implement common event builder methods (id, timestamp, parent, build_event).
///
/// This eliminates ~230 lines of repetitive boilerplate by generating the same 4 methods
/// for each builder type that needs to chain into EventBuilder.
macro_rules! impl_event_builder_extensions {
    ($builder:ty) => {
        impl $builder {
            pub fn id(self, id: impl Into<String>) -> EventBuilder {
                self.into_event_builder().id(id)
            }

            pub fn timestamp(self, ts: impl Into<String>) -> EventBuilder {
                self.into_event_builder().timestamp(ts)
            }

            pub fn parent(self, parent_id: impl Into<String>) -> EventBuilder {
                self.into_event_builder().parent(parent_id)
            }

            pub fn build_event(self) -> TypedEvent {
                self.into_event_builder().build_event()
            }
        }
    };
}

// Apply the macro to all builder types
impl_event_builder_extensions!(UserMessageBuilder);
impl_event_builder_extensions!(AssistantMessageBuilder);
impl_event_builder_extensions!(TurnStartBuilder);
impl_event_builder_extensions!(TurnEndBuilder);
impl_event_builder_extensions!(ToolExecStartBuilder);
impl_event_builder_extensions!(ToolExecCompleteBuilder);
impl_event_builder_extensions!(SubagentStartedBuilder);
impl_event_builder_extensions!(SubagentCompletedBuilder);
impl_event_builder_extensions!(SubagentFailedBuilder);
impl_event_builder_extensions!(SessionErrorBuilder);
impl_event_builder_extensions!(SessionWarningBuilder);
impl_event_builder_extensions!(SystemMessageBuilder);
impl_event_builder_extensions!(ModelChangeBuilder);
impl_event_builder_extensions!(CompactionStartBuilder);
impl_event_builder_extensions!(CompactionCompleteBuilder);
