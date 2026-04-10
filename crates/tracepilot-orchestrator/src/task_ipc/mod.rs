//! File-based IPC protocol for AI agent tasks.
//!
//! The app writes context files; subagents write result files. This module
//! handles monitoring, parsing, and ingesting results back into the task DB.

mod monitor;
pub mod protocol;

pub use monitor::*;
pub use protocol::*;
