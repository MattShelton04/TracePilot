//! tracepilot-orchestrator: Session orchestration capabilities for TracePilot.
//!
//! Provides git worktree management, session launching, config injection,
//! version management, repository registry, and session templates.

pub mod config_injector;
pub mod error;
pub mod github;
pub mod json_io;
pub mod launcher;
pub mod mcp;
pub mod models;
pub mod presets;
pub mod process;
pub mod repo_registry;
pub mod skills;
pub mod task_attribution;
pub mod task_context;
pub mod task_db;
pub mod task_ipc;
pub mod task_orchestrator;
pub mod task_recovery;
pub mod templates;
pub mod tokens;
pub mod types;
pub(crate) mod validation;
pub mod version_manager;
pub mod worktrees;

pub use error::{OrchestratorError, Result};
pub use types::*;

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
