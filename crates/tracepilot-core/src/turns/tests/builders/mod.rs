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

mod core;
mod messages;
mod session;
mod subagents;
mod tools;
mod turn;

pub use messages::{asst_msg, asst_msg_empty, user_msg};
pub use session::{
    compaction_complete, compaction_start, model_change, session_error, session_error_empty,
    session_warning, system_message, system_message_empty,
};
pub use subagents::{subagent_complete, subagent_failed, subagent_start};
pub use tools::{tool_complete, tool_start};
pub use turn::{turn_end, turn_start};

/// Macro to implement common event builder methods (id, timestamp, parent, build_event).
///
/// This eliminates repetitive boilerplate by generating the same four methods
/// for each builder type that needs to chain into [`core::EventBuilder`].
macro_rules! impl_event_builder_extensions {
    ($builder:ty) => {
        impl $builder {
            pub fn id(self, id: impl Into<String>) -> core::EventBuilder {
                self.into_event_builder().id(id)
            }

            pub fn timestamp(self, ts: impl Into<String>) -> core::EventBuilder {
                self.into_event_builder().timestamp(ts)
            }

            pub fn parent(self, parent_id: impl Into<String>) -> core::EventBuilder {
                self.into_event_builder().parent(parent_id)
            }

            pub fn build_event(self) -> crate::parsing::events::TypedEvent {
                self.into_event_builder().build_event()
            }
        }
    };
}

impl_event_builder_extensions!(messages::UserMessageBuilder);
impl_event_builder_extensions!(messages::AssistantMessageBuilder);
impl_event_builder_extensions!(turn::TurnStartBuilder);
impl_event_builder_extensions!(turn::TurnEndBuilder);
impl_event_builder_extensions!(tools::ToolExecStartBuilder);
impl_event_builder_extensions!(tools::ToolExecCompleteBuilder);
impl_event_builder_extensions!(subagents::SubagentStartedBuilder);
impl_event_builder_extensions!(subagents::SubagentCompletedBuilder);
impl_event_builder_extensions!(subagents::SubagentFailedBuilder);
impl_event_builder_extensions!(session::SessionErrorBuilder);
impl_event_builder_extensions!(session::SessionWarningBuilder);
impl_event_builder_extensions!(session::SystemMessageBuilder);
impl_event_builder_extensions!(session::ModelChangeBuilder);
impl_event_builder_extensions!(session::CompactionStartBuilder);
impl_event_builder_extensions!(session::CompactionCompleteBuilder);
