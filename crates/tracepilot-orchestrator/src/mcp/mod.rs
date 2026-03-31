//! MCP (Model Context Protocol) server management module.
//!
//! Provides configuration, health checking, import and diff operations
//! for managing MCP servers used by Copilot CLI.

pub mod config;
pub mod diff;
pub mod error;
pub mod health;
pub mod import;
pub mod types;

pub use error::McpError;
