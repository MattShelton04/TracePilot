//! Domain models derived from raw session data.

pub mod session_summary;
pub mod conversation;
pub mod tool_transaction;

pub use conversation::ConversationTurn;
pub use session_summary::SessionSummary;
pub use tool_transaction::ToolTransaction;

// Re-export the raw event type for consumers
pub use crate::parsing::events::RawEvent as SessionEvent;
