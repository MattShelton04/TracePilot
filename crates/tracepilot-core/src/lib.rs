//! tracepilot-core: Core library for parsing and modeling Copilot CLI sessions.
//!
//! This crate provides:
//! - Session discovery (scanning `~/.copilot/session-state/`)
//! - Parsing of `workspace.yaml`, `events.jsonl`, and `session.db`
//! - Derived models: `SessionSummary`, `ConversationTurn`, `ToolTransaction`
//! - Health scoring and anomaly detection
//! - Analytics aggregation across sessions (tokens, tools, code impact)

pub mod analytics;
pub mod error;
pub mod health;
pub mod models;
pub mod parsing;
pub mod session;
pub mod summary;
pub mod turns;

pub use error::{Result, TracePilotError};
pub use models::{ConversationTurn, SessionEvent, SessionSummary, ShutdownMetrics, ToolTransaction, TurnToolCall};
pub use session::discovery::{discover_sessions, resolve_session_path};
pub use summary::load_session_summary;
pub use turns::{TurnStats, reconstruct_turns, turn_stats};
