//! Skills type definitions.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Skill scope — where the skill is stored/active.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SkillScope {
    Global,
    Repository,
    Builtin,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SkillDisabledReason {
    User,
    Repository,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SkillAllowedTools {
    Text(String),
    List(Vec<String>),
}

impl std::fmt::Display for SkillScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkillScope::Global => write!(f, "global"),
            SkillScope::Repository => write!(f, "repository"),
            SkillScope::Builtin => write!(f, "builtin"),
        }
    }
}

/// Parsed SKILL.md frontmatter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFrontmatter {
    pub name: String,
    pub description: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "argument-hint"
    )]
    pub argument_hint: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "allowed-tools"
    )]
    pub allowed_tools: Option<SkillAllowedTools>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "user-invocable"
    )]
    pub user_invocable: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "disable-model-invocation"
    )]
    pub disable_model_invocation: Option<bool>,
    /// Optional list of resource glob patterns (e.g., "src/**/*.ts").
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resource_globs: Vec<String>,
    /// Whether the skill auto-attaches to conversations.
    #[serde(default)]
    pub auto_attach: bool,
}

/// Complete skill data — frontmatter + body + metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub frontmatter: SkillFrontmatter,
    /// The markdown body (instructions).
    pub body: String,
    /// The raw content of the SKILL.md file.
    pub raw_content: String,
    /// Where this skill lives.
    pub scope: SkillScope,
    /// Directory path containing the SKILL.md file.
    pub directory: String,
    /// Estimated token count for frontmatter loaded during discovery.
    pub frontmatter_tokens: u32,
    /// Estimated token count for instructions loaded when invoked.
    pub instruction_tokens: u32,
    /// Whether the skill is enabled.
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_reason: Option<SkillDisabledReason>,
    /// File modification time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<DateTime<Utc>>,
}

/// Summary info for listing skills without full body content.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
    pub scope: SkillScope,
    pub directory: String,
    pub frontmatter_tokens: u32,
    pub instruction_tokens: u32,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_reason: Option<SkillDisabledReason>,
    pub has_assets: bool,
    pub asset_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiagnostic {
    pub path: String,
    pub message: String,
    pub severity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoveryResult {
    pub skills: Vec<SkillSummary>,
    pub diagnostics: Vec<SkillDiagnostic>,
}

/// A skill's asset file (non-SKILL.md file in the skill directory).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillAsset {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub is_directory: bool,
}

/// Frontmatter token budget summary across all active skills.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillTokenBudget {
    pub total_skills: usize,
    pub enabled_skills: usize,
    pub total_tokens: u32,
    pub enabled_tokens: u32,
    pub skills: Vec<SkillTokenEntry>,
}

/// Per-skill token entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillTokenEntry {
    pub name: String,
    pub tokens: u32,
    pub enabled: bool,
}

/// Result of importing a skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillImportResult {
    pub skill_name: String,
    pub destination: String,
    pub warnings: Vec<String>,
    pub files_copied: usize,
}

/// Preview information for a skill found in a GitHub repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubSkillPreview {
    /// Path within the repo (e.g., ".github/skills/my-skill" or "skills/python-helper")
    pub path: String,
    /// Skill name from frontmatter
    pub name: String,
    /// Skill description from frontmatter
    pub description: String,
    /// Number of files in the skill directory
    pub file_count: usize,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

/// Preview information for a skill found within a local directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSkillPreview {
    /// Full path to the skill directory (contains SKILL.md)
    pub path: String,
    /// Skill name from frontmatter
    pub name: String,
    /// Skill description from frontmatter
    pub description: String,
    /// Number of files in the skill directory
    pub file_count: usize,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

/// Result of scanning a single repository for skills.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSkillsResult {
    /// Repository root path on disk.
    pub repo_path: String,
    /// Repository display name.
    pub repo_name: String,
    /// Skills discovered in this repository.
    pub skills: Vec<LocalSkillPreview>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_serializes_lowercase() {
        let json = serde_json::to_string(&SkillScope::Global).unwrap();
        assert_eq!(json, "\"global\"");
        let json = serde_json::to_string(&SkillScope::Repository).unwrap();
        assert_eq!(json, "\"repository\"");
        let json = serde_json::to_string(&SkillScope::Builtin).unwrap();
        assert_eq!(json, "\"builtin\"");
    }

    #[test]
    fn frontmatter_round_trip() {
        let fm = SkillFrontmatter {
            name: "test-skill".into(),
            description: "A test skill".into(),
            argument_hint: None,
            allowed_tools: None,
            user_invocable: None,
            disable_model_invocation: None,
            resource_globs: vec!["src/**/*.rs".into()],
            auto_attach: true,
        };
        let json = serde_json::to_string(&fm).unwrap();
        let parsed: SkillFrontmatter = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "test-skill");
        assert!(parsed.auto_attach);
        assert_eq!(parsed.resource_globs.len(), 1);
    }

    #[test]
    fn frontmatter_defaults() {
        let json = r#"{"name":"x","description":"y"}"#;
        let fm: SkillFrontmatter = serde_json::from_str(json).unwrap();
        assert!(!fm.auto_attach);
        assert!(fm.resource_globs.is_empty());
    }

    #[test]
    fn skill_summary_round_trip() {
        let summary = SkillSummary {
            name: "test".into(),
            description: "desc".into(),
            scope: SkillScope::Global,
            directory: "/path".into(),
            frontmatter_tokens: 100,
            instruction_tokens: 200,
            enabled: true,
            disabled_reason: None,
            has_assets: false,
            asset_count: 0,
        };
        let json = serde_json::to_string(&summary).unwrap();
        let parsed: SkillSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "test");
    }

    #[test]
    fn repo_skills_result_camel_case_serialization() {
        let result = RepoSkillsResult {
            repo_path: "/home/user/project".into(),
            repo_name: "my-project".into(),
            skills: vec![LocalSkillPreview {
                path: "/home/user/project/.github/skills/test".into(),
                name: "test".into(),
                description: "A test".into(),
                file_count: 2,
                valid: true,
                diagnostic: None,
            }],
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"repoPath\""));
        assert!(json.contains("\"repoName\""));
        assert!(json.contains("\"fileCount\""));

        let parsed: RepoSkillsResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.repo_name, "my-project");
        assert_eq!(parsed.skills.len(), 1);
    }
}
