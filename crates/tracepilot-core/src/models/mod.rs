//! Domain models derived from raw session data.

pub mod conversation;
pub mod event_types;
pub mod session_summary;
pub mod tool_transaction;

pub use conversation::ConversationTurn;
pub use conversation::TurnToolCall;
pub use event_types::SessionEventType;
pub use session_summary::{SessionSummary, ShutdownMetrics};
pub use tool_transaction::ToolTransaction;

// Re-export the raw event type for consumers
pub use crate::parsing::events::RawEvent as SessionEvent;
