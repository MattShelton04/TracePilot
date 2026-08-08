//! Skills management module for Copilot CLI custom skills.
//!
//! Provides SKILL.md parsing, writing, discovery (local + GitHub),
//! import/copy, asset management, and lifecycle operations.

pub mod assets;
pub mod discovery;
mod error;
pub mod import;
pub mod manager;
pub(crate) mod parser;
pub mod types;
pub(crate) mod writer;

pub use error::SkillsError;

/// Estimate the tokens used by the frontmatter that advertises a skill before invocation.
///
/// The Markdown instruction body is loaded only when the skill is invoked, so it is
/// intentionally excluded from this estimate.
pub fn estimate_skill_frontmatter_tokens(content: &str) -> Result<u32, SkillsError> {
    let (frontmatter_yaml, _) = parser::split_frontmatter(content)?;
    Ok(crate::tokens::estimate_skill_tokens(&frontmatter_yaml))
}

/// Estimate both the always-loaded discovery metadata and lazily-loaded instructions.
pub fn estimate_skill_token_usage(content: &str) -> Result<(u32, u32), SkillsError> {
    let (frontmatter_yaml, body) = parser::split_frontmatter(content)?;
    Ok((
        crate::tokens::estimate_skill_tokens(&frontmatter_yaml),
        crate::tokens::estimate_tokens(&body),
    ))
}
