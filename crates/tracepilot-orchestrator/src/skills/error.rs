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
    /// File I/O error.
    #[error("Skills I/O error: {0}")]
    Io(String),
    /// Import error.
    #[error("Skills import error: {0}")]
    Import(String),
    /// Asset error.
    #[error("Skills asset error: {0}")]
    Asset(String),
    /// GitHub operation error.
    #[error("Skills GitHub error: {0}")]
    GitHub(String),
    /// YAML serialization error.
    #[error("Skills YAML error: {0}")]
    Yaml(String),
    /// Path traversal / containment violation.
    #[error("Path not allowed: {0}")]
    PathTraversal(String),
}

// Manual `From` impls convert source errors to String because many call sites
// construct these variants with custom string messages directly.

impl From<std::io::Error> for SkillsError {
    fn from(e: std::io::Error) -> Self {
        SkillsError::Io(e.to_string())
    }
}

impl From<serde_yml::Error> for SkillsError {
    fn from(e: serde_yml::Error) -> Self {
        SkillsError::Yaml(e.to_string())
    }
}

impl SkillsError {
    /// Construct a GitHub error with context and source error.
    pub fn github_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        SkillsError::GitHub(format!("{context}: {source}"))
    }

    /// Construct an Import error with context and source error.
    pub fn import_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        SkillsError::Import(format!("{context}: {source}"))
    }

    /// Construct an Io error with context and source error.
    pub fn io_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        SkillsError::Io(format!("{context}: {source}"))
    }

    /// Construct an Asset error with context and source error.
    pub fn asset_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        SkillsError::Asset(format!("{context}: {source}"))
    }

    /// Construct a Yaml error with context and source error.
    pub fn yaml_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        SkillsError::Yaml(format!("{context}: {source}"))
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
    fn display_io() {
        let err = SkillsError::Io("disk full".into());
        assert!(err.to_string().contains("disk full"));
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
    fn display_yaml() {
        let err = SkillsError::Yaml("bad indent".into());
        assert!(err.to_string().contains("bad indent"));
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
        assert!(matches!(skills_err, SkillsError::Io(_)));
        assert!(skills_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_serde_yml_error() {
        let yaml = "{{invalid";
        let yml_err = serde_yml::from_str::<serde_yml::Value>(yaml).unwrap_err();
        let skills_err: SkillsError = yml_err.into();
        assert!(matches!(skills_err, SkillsError::Yaml(_)));
        assert!(!skills_err.to_string().is_empty());
    }

    #[test]
    fn github_ctx_creates_formatted_error() {
        let err = SkillsError::github_ctx("Failed to fetch SKILL.md", "404 not found");
        let msg = err.to_string();
        assert!(msg.contains("GitHub error"));
        assert!(msg.contains("Failed to fetch SKILL.md"));
        assert!(msg.contains("404 not found"));
    }

    #[test]
    fn import_ctx_creates_formatted_error() {
        let err = SkillsError::import_ctx("Failed to read", "file not found");
        let msg = err.to_string();
        assert!(msg.contains("import error"));
        assert!(msg.contains("Failed to read"));
        assert!(msg.contains("file not found"));
    }

    #[test]
    fn io_ctx_creates_formatted_error() {
        let err = SkillsError::io_ctx("Failed to write", "disk full");
        let msg = err.to_string();
        assert!(msg.contains("I/O error"));
        assert!(msg.contains("Failed to write"));
        assert!(msg.contains("disk full"));
    }

    #[test]
    fn asset_ctx_creates_formatted_error() {
        let err = SkillsError::asset_ctx("Failed to load asset", "too large");
        let msg = err.to_string();
        assert!(msg.contains("asset error"));
        assert!(msg.contains("Failed to load asset"));
        assert!(msg.contains("too large"));
    }

    #[test]
    fn yaml_ctx_creates_formatted_error() {
        let err = SkillsError::yaml_ctx("Parse error", "invalid indent");
        let msg = err.to_string();
        assert!(msg.contains("YAML error"));
        assert!(msg.contains("Parse error"));
        assert!(msg.contains("invalid indent"));
    }
}
