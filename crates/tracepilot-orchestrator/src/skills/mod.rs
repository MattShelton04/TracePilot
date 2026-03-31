//! Skills management module for Copilot CLI custom skills.
//!
//! Provides SKILL.md parsing, writing, discovery (local + GitHub),
//! import/copy, asset management, and lifecycle operations.

pub mod assets;
pub mod discovery;
pub mod error;
pub mod import;
pub mod manager;
pub mod parser;
pub mod types;
pub mod writer;

pub use error::SkillsError;
