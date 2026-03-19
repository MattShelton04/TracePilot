//! tracepilot-orchestrator: Session orchestration capabilities for TracePilot.
//!
//! Provides git worktree management, session launching, config injection,
//! version management, and session templates.

pub mod config_injector;
pub mod error;
pub mod launcher;
pub mod templates;
pub mod types;
pub mod version_manager;
pub mod worktrees;

pub use error::{OrchestratorError, Result};
pub use types::*;
