//! Task orchestrator — launch, manifest, prompt, and lifecycle management.
//!
//! Responsible for spinning up the Copilot CLI orchestrator session that
//! continuously polls for tasks and delegates to subagents.

pub mod launcher;
pub mod manifest;
pub mod prompt;

pub use launcher::*;
pub use manifest::{ManifestInput, ManifestTask, TaskManifest};
