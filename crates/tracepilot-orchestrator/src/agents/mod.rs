//! Copilot CLI agent definitions: discovery, parsing, safe edits and the
//! `/subagents` settings that override them.
//!
//! Built-in agents ship with the CLI and are read-only unless the Config
//! Injector's advanced mode is on; the supported way to change them is a
//! `/subagents` override, which survives CLI updates. Custom agents
//! (personal and project `*.agent.md`) are edited in place with backups.
//! Plugin agents are read-only because plugin updates replace them.

pub mod discovery;
pub(crate) mod parse;
pub mod settings;
pub mod types;
pub mod write;

pub use discovery::{AgentRoots, builtin_definition_paths, discover, load_definition};
pub use types::*;

#[cfg(test)]
mod tests;
