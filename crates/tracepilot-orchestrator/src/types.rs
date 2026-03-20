//! Shared types for the orchestrator.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Worktree Types ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub head_commit: String,
    pub is_main_worktree: bool,
    pub is_bare: bool,
    pub disk_usage_bytes: Option<u64>,
    pub status: WorktreeStatus,
    pub is_locked: bool,
    pub locked_reason: Option<String>,
    pub linked_session_id: Option<String>,
    pub created_at: Option<String>,
    pub repo_root: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorktreeStatus {
    Active,
    Stale,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDetails {
    pub path: String,
    pub uncommitted_count: usize,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeRequest {
    pub repo_path: String,
    pub branch: String,
    pub base_branch: Option<String>,
    pub target_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    pub pruned_count: usize,
    pub messages: Vec<String>,
}

// ─── Repository Registry Types ────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredRepo {
    pub path: String,
    pub name: String,
    pub added_at: String,
    pub last_used_at: Option<String>,
    pub source: RepoSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RepoSource {
    Manual,
    SessionDiscovery,
}

// ─── Launcher Types ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchConfig {
    pub repo_path: String,
    pub branch: Option<String>,
    pub base_branch: Option<String>,
    pub model: Option<String>,
    pub prompt: Option<String>,
    pub headless: bool,
    pub reasoning_effort: Option<String>,
    pub custom_instructions: Option<String>,
    #[serde(default)]
    pub env_vars: HashMap<String, String>,
    #[serde(default)]
    pub create_worktree: bool,
    #[serde(default)]
    pub auto_approve: bool,
    /// The CLI command to use (e.g. "copilot", "gh copilot-cli"). Defaults to "copilot".
    #[serde(default = "default_cli_command")]
    pub cli_command: String,
}

fn default_cli_command() -> String {
    "copilot".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchedSession {
    pub pid: u32,
    pub worktree_path: Option<String>,
    pub command: String,
    pub launched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub tier: String,
}

// ─── Config Injector Types ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinition {
    pub name: String,
    pub file_path: String,
    pub model: String,
    pub description: String,
    pub tools: Vec<String>,
    pub prompt_excerpt: String,
    pub raw_yaml: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotConfig {
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub trusted_folders: Vec<String>,
    pub raw: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub id: String,
    pub label: String,
    pub source_path: String,
    pub backup_path: String,
    pub created_at: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDiff {
    pub file_name: String,
    pub diff_text: String,
    pub has_changes: bool,
}

// ─── Version Management Types ─────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotVersion {
    pub version: String,
    pub path: String,
    pub is_active: bool,
    pub is_complete: bool,
    pub modified_at: String,
    pub has_customizations: bool,
    pub lock_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationDiff {
    pub file_name: String,
    pub agent_name: String,
    pub from_version: String,
    pub to_version: String,
    pub diff: String,
    pub has_conflicts: bool,
}

// ─── Template Types ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub config: LaunchConfig,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    #[serde(default)]
    pub usage_count: u32,
}

// ─── Active Session Discovery Types ───────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSessionInfo {
    pub session_id: String,
    pub pid: u32,
    pub cwd: Option<String>,
    pub branch: Option<String>,
    pub repository: Option<String>,
    pub started_at: Option<String>,
    pub copilot_version: Option<String>,
}

// ─── Dependency Check Types ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDependencies {
    pub git_available: bool,
    pub git_version: Option<String>,
    pub copilot_available: bool,
    pub copilot_version: Option<String>,
    pub copilot_home_exists: bool,
}
