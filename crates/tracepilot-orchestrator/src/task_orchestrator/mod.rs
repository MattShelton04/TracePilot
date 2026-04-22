//! Task orchestrator — launch, manifest, prompt, and lifecycle management.
//!
//! Responsible for spinning up the Copilot CLI orchestrator session that
//! continuously polls for tasks and delegates to subagents.

pub(crate) mod launcher;
pub mod manifest;
pub(crate) mod prompt;

pub use launcher::*;
pub use manifest::{ManifestInput, ManifestTask, TaskManifest};
