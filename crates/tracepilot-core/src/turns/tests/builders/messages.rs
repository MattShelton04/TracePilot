use serde_json::Value;

use crate::models::event_types::{AssistantMessageData, SessionEventType, UserMessageData};
use crate::parsing::events::TypedEventData;

use super::core::EventBuilder;

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

    pub(super) fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(self.build_data()),
        )
    }
}

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

    pub(super) fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(self.build_data()),
        )
    }
}

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
