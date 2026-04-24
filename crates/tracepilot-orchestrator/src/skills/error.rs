//! Skills-specific error types.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SkillsError {
    /// Skill not found at path or by name.
    #[error("Skill not found: {0}")]
    NotFound(String),
    /// Skill with this name already exists.
    #[error("Skill '{0}' already exists")]
    DuplicateSkill(String),
    /// Frontmatter parsing error.
    #[error("Frontmatter parse error: {0}")]
    FrontmatterParse(String),
    /// Frontmatter validation error.
    #[error("Frontmatter validation error: {0}")]
    FrontmatterValidation(String),
    /// Import error.
    #[error("Skills import error: {0}")]
    Import(String),
    /// Asset error.
    #[error("Skills asset error: {0}")]
    Asset(String),
    /// GitHub operation error.
    #[error("Skills GitHub error: {0}")]
    GitHub(String),
    /// Path traversal / containment violation.
    #[error("Path not allowed: {0}")]
    PathTraversal(String),
    /// I/O error with preserved source chain. Catches `?` on bare
    /// [`std::io::Error`].
    #[error("Skills I/O error: {0}")]
    IoSource(#[from] std::io::Error),
    /// I/O error with operation context. Preferred over the bare
    /// [`Self::IoSource`] variant at call sites that already know the
    /// target path / operation, so the message + source chain stay
    /// structured (FU-12 rollup of the old `Io(String)` bucket).
    #[error("Skills I/O error ({context}): {source}")]
    IoContext {
        context: String,
        #[source]
        source: std::io::Error,
    },
    /// YAML error with preserved source chain.
    #[error("Skills YAML error: {0}")]
    YamlSource(#[from] serde_yml::Error),
}

impl SkillsError {
    /// Construct a GitHub error with context and source error.
    pub fn github_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        SkillsError::GitHub(format!("{context}: {source}"))
    }

    /// Construct an I/O error with operation context, preserving the
    /// original `io::Error` as the `#[source]` chain. Prefer this over
    /// `SkillsError::IoSource` when the call site already carries useful
    /// operation context (e.g. "Failed to create staging directory").
    pub fn io_ctx(context: impl Into<String>, source: std::io::Error) -> Self {
        SkillsError::IoContext {
            context: context.into(),
            source,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_not_found() {
        let err = SkillsError::NotFound("my-skill".into());
        let msg = err.to_string();
        assert!(msg.contains("my-skill"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn display_duplicate_skill() {
        let err = SkillsError::DuplicateSkill("dup-skill".into());
        let msg = err.to_string();
        assert!(msg.contains("dup-skill"));
        assert!(msg.contains("already exists"));
    }

    #[test]
    fn display_frontmatter_parse() {
        let err = SkillsError::FrontmatterParse("invalid YAML".into());
        let msg = err.to_string();
        assert!(msg.contains("Frontmatter parse error"));
        assert!(msg.contains("invalid YAML"));
    }

    #[test]
    fn display_frontmatter_validation() {
        let err = SkillsError::FrontmatterValidation("name is empty".into());
        let msg = err.to_string();
        assert!(msg.contains("Frontmatter validation error"));
        assert!(msg.contains("name is empty"));
    }

    #[test]
    fn display_io_context_preserves_context_and_source() {
        use std::error::Error;
        let err = SkillsError::io_ctx(
            "Failed to create staging dir",
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied"),
        );
        let msg = err.to_string();
        assert!(msg.contains("Failed to create staging dir"));
        assert!(msg.contains("denied"));
        assert!(err.source().is_some());
    }

    #[test]
    fn display_import() {
        let err = SkillsError::Import("no SKILL.md".into());
        assert!(err.to_string().contains("no SKILL.md"));
    }

    #[test]
    fn display_asset() {
        let err = SkillsError::Asset("too large".into());
        assert!(err.to_string().contains("too large"));
    }

    #[test]
    fn display_github() {
        let err = SkillsError::GitHub("rate limited".into());
        assert!(err.to_string().contains("rate limited"));
    }

    #[test]
    fn display_path_traversal() {
        let err = SkillsError::PathTraversal("../etc/passwd".into());
        let msg = err.to_string();
        assert!(msg.contains("Path not allowed"));
        assert!(msg.contains("../etc/passwd"));
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let skills_err: SkillsError = io_err.into();
        assert!(matches!(skills_err, SkillsError::IoSource(_)));
        assert!(skills_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_yml_error() {
        let yaml = "{{invalid";
        let yml_err = serde_yml::from_str::<serde_yml::Value>(yaml).unwrap_err();
        let skills_err: SkillsError = yml_err.into();
        assert!(matches!(skills_err, SkillsError::YamlSource(_)));
        assert!(!skills_err.to_string().is_empty());
    }

    #[test]
    fn io_error_preserves_source_chain() {
        use std::error::Error;
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "read error");
        let skills_err: SkillsError = io_err.into();
        assert!(matches!(skills_err, SkillsError::IoSource(_)));
        assert!(
            skills_err.source().is_some(),
            "source chain should be preserved"
        );
        assert!(skills_err.to_string().contains("Skills I/O error"));
    }

    #[test]
    fn yaml_error_preserves_source_chain() {
        use std::error::Error;
        let yaml = "bad: {{unclosed";
        let yml_err = serde_yml::from_str::<serde_yml::Value>(yaml).unwrap_err();
        let skills_err: SkillsError = yml_err.into();
        assert!(matches!(skills_err, SkillsError::YamlSource(_)));
        assert!(
            skills_err.source().is_some(),
            "source chain should be preserved"
        );
        assert!(skills_err.to_string().contains("Skills YAML error"));
    }

    #[test]
    fn github_ctx_creates_formatted_error() {
        let err = SkillsError::github_ctx("Failed to fetch SKILL.md", "404 not found");
        let msg = err.to_string();
        assert!(msg.contains("GitHub error"));
        assert!(msg.contains("Failed to fetch SKILL.md"));
        assert!(msg.contains("404 not found"));
    }
}
