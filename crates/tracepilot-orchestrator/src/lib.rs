//! tracepilot-orchestrator: Session orchestration capabilities for TracePilot.
//!
//! Provides git worktree management, session launching, config injection,
//! version management, repository registry, and session templates.

pub mod config_injector;
mod error;
pub mod github;
pub(crate) mod json_io;
pub mod launcher;
mod launcher_sdk;
pub mod mcp;
pub mod models;
pub mod process;
pub mod repo_registry;
pub mod skills;
pub mod templates;
pub(crate) mod tokens;
mod types;
pub mod validation;
pub mod version_manager;
pub mod worktrees;

pub mod bridge;

pub use error::{OrchestratorError, Result};
pub use types::*;

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
