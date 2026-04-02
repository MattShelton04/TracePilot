//! Task preset system — reusable task templates for AI agents.
//!
//! Presets define prompts, context sources, output schemas, and execution
//! parameters. Stored as JSON files in `~/.copilot/tracepilot/task-presets/`.

pub mod io;
pub mod types;

pub use io::*;
pub use types::*;
