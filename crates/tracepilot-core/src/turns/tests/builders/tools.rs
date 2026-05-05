use serde_json::Value;

use crate::models::event_types::{SessionEventType, ToolExecCompleteData, ToolExecStartData};
use crate::parsing::events::TypedEventData;

use super::core::EventBuilder;

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

    pub(super) fn into_event_builder(self) -> EventBuilder {
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

    pub(super) fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(self.build_data()),
        )
    }
}

/// Create a tool execution start builder.
pub fn tool_start(tool_name: impl Into<String>) -> ToolExecStartBuilder {
    ToolExecStartBuilder::new(tool_name)
}

/// Create a tool execution complete builder.
pub fn tool_complete(tool_call_id: impl Into<String>) -> ToolExecCompleteBuilder {
    ToolExecCompleteBuilder::new(tool_call_id)
}
