//! Skills-specific error types.

use std::fmt;

#[derive(Debug)]
pub enum SkillsError {
    /// Skill not found at path or by name.
    NotFound(String),
    /// Skill with this name already exists.
    DuplicateSkill(String),
    /// Frontmatter parsing error.
    FrontmatterParse(String),
    /// Frontmatter validation error.
    FrontmatterValidation(String),
    /// File I/O error.
    Io(String),
    /// Import error.
    Import(String),
    /// Asset error.
    Asset(String),
    /// GitHub operation error.
    GitHub(String),
    /// YAML serialization error.
    Yaml(String),
}

impl fmt::Display for SkillsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SkillsError::NotFound(name) => write!(f, "Skill not found: {name}"),
            SkillsError::DuplicateSkill(name) => write!(f, "Skill '{name}' already exists"),
            SkillsError::FrontmatterParse(msg) => {
                write!(f, "Frontmatter parse error: {msg}")
            }
            SkillsError::FrontmatterValidation(msg) => {
                write!(f, "Frontmatter validation error: {msg}")
            }
            SkillsError::Io(msg) => write!(f, "Skills I/O error: {msg}"),
            SkillsError::Import(msg) => write!(f, "Skills import error: {msg}"),
            SkillsError::Asset(msg) => write!(f, "Skills asset error: {msg}"),
            SkillsError::GitHub(msg) => write!(f, "Skills GitHub error: {msg}"),
            SkillsError::Yaml(msg) => write!(f, "Skills YAML error: {msg}"),
        }
    }
}

impl std::error::Error for SkillsError {}

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
