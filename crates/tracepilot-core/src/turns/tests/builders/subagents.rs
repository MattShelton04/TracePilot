use crate::models::event_types::{
    SessionEventType, SubagentCompletedData, SubagentFailedData, SubagentStartedData,
};
use crate::parsing::events::TypedEventData;

use super::core::EventBuilder;

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

    pub(super) fn into_event_builder(self) -> EventBuilder {
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

    pub(super) fn into_event_builder(self) -> EventBuilder {
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

    pub(super) fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SubagentFailed,
            TypedEventData::SubagentFailed(self.build_data()),
        )
    }
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
