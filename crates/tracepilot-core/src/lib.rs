//! tracepilot-core: Core library for parsing and modeling Copilot CLI sessions.
//!
//! This crate provides:
//! - Session discovery (scanning `~/.copilot/session-state/`)
//! - Parsing of `workspace.yaml`, `events.jsonl`, and `session.db`
//! - Derived models: `SessionSummary`, `ConversationTurn`, `ToolTransaction`
//! - Health scoring and anomaly detection

pub mod error;
pub mod health;
pub mod models;
pub mod parsing;
pub mod session;
pub mod turns;

pub use error::{Result, TracePilotError};
pub use models::{ConversationTurn, SessionEvent, SessionSummary, ToolTransaction};
pub use session::discovery::discover_sessions;
pub use turns::{TurnStats, reconstruct_turns, turn_stats};
