//! MCP (Model Context Protocol) server management module.
//!
//! Provides configuration, health checking, import and diff operations
//! for managing MCP servers used by Copilot CLI.

pub mod config;
pub mod diff;
mod error;
pub(crate) mod headers;
pub mod health;
pub mod import;
pub mod types;
pub(crate) mod url_policy;

pub use error::McpError;
