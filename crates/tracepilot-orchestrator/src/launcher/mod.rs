//! Copilot CLI session launcher.
//!
//! Public surface is intentionally narrow: the module is split into
//! submodules by concern (path canonicalisation, dependency probing,
//! model validation, per-OS terminal spawning) but external callers
//! continue to use `tracepilot_orchestrator::launcher::X` paths.

mod deps;
mod models;
mod paths;
mod terminal;

pub use deps::{check_dependencies, copilot_home};
pub use models::available_models;
pub use paths::{open_in_explorer, open_in_terminal};
pub use terminal::{launch_sdk_session, launch_session};

pub(crate) use paths::canonicalize_user_path;

// Re-export process utilities for backward compatibility.
#[cfg(windows)]
pub use crate::process::encode_powershell_command;
#[cfg(windows)]
pub use crate::process::spawn_outside_job;
