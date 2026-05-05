use crate::models::event_types::{
    CompactionCompleteData, CompactionStartData, ModelChangeData, SessionErrorData,
    SessionEventType, SessionWarningData, SystemMessageData,
};
use crate::parsing::events::TypedEventData;

use super::core::EventBuilder;

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

    pub(super) fn into_event_builder(self) -> EventBuilder {
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

    pub(super) fn into_event_builder(self) -> EventBuilder {
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

    pub(super) fn into_event_builder(self) -> EventBuilder {
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

    pub(super) fn into_event_builder(self) -> EventBuilder {
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

    pub(super) fn into_event_builder(self) -> EventBuilder {
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

    pub(super) fn into_event_builder(self) -> EventBuilder {
        EventBuilder::new(
            SessionEventType::SessionCompactionComplete,
            TypedEventData::CompactionComplete(self.build_data()),
        )
    }
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
