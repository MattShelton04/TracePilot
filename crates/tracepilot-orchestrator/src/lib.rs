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
pub mod process;
pub mod repo_registry;
pub mod skills;
pub mod templates;
pub mod tokens;
pub mod types;
pub mod validation;
pub mod version_manager;
pub mod worktrees;

pub use error::{OrchestratorError, Result};
pub use types::*;
pub use validation::{validate_identifier, ValidationRules, SKILL_NAME_RULES, ENV_VAR_RULES, TEMPLATE_ID_RULES};
