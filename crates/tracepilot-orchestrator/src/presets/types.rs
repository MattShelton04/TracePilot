//! Task preset types.
//!
//! Presets are reusable task templates that define prompts, context sources,
//! output schemas, and execution parameters.

use serde::{Deserialize, Serialize};

/// A complete task preset definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPreset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub task_type: String,
    pub description: String,
    pub version: u32,
    pub prompt: PresetPrompt,
    pub context: PresetContext,
    pub output: PresetOutput,
    pub execution: PresetExecution,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub builtin: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn default_true() -> bool {
    true
}

/// Prompt configuration for a preset.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetPrompt {
    pub system: String,
    pub user: String,
    #[serde(default)]
    pub variables: Vec<PromptVariable>,
}

/// A variable placeholder in a prompt template.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptVariable {
    pub name: String,
    #[serde(rename = "type")]
    pub var_type: VariableType,
    #[serde(default)]
    pub required: bool,
    pub description: String,
    pub default: Option<String>,
}

/// Supported variable types for prompt templates.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VariableType {
    String,
    Number,
    Boolean,
    SessionRef,
    SessionList,
    /// ISO 8601 date string (YYYY-MM-DD), used for digest date pickers.
    Date,
}

/// Context sources and budget configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetContext {
    #[serde(default)]
    pub sources: Vec<ContextSource>,
    #[serde(default = "default_max_chars")]
    pub max_chars: usize,
    #[serde(default)]
    pub format: ContextFormat,
}

fn default_max_chars() -> usize {
    100_000
}

/// A context data source (e.g., session export, analytics).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSource {
    pub id: String,
    #[serde(rename = "type")]
    pub source_type: ContextSourceType,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub config: serde_json::Value,
}

/// Supported context source types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceType {
    SessionExport,
    SessionAnalytics,
    SessionHealth,
    SessionTodos,
    RecentSessions,
    /// Multi-session digest: aggregates summaries from sessions within a
    /// configurable time window (e.g. last 24h, last 7d).
    MultiSessionDigest,
}

/// Context output format.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextFormat {
    #[default]
    Markdown,
    Json,
}

/// Output schema and validation configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetOutput {
    #[serde(default)]
    pub schema: serde_json::Value,
    #[serde(default)]
    pub format: OutputFormat,
    #[serde(default)]
    pub validation: ValidationMode,
}

/// Output format for task results.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputFormat {
    #[default]
    Json,
    Markdown,
    Text,
}

/// Schema validation mode.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationMode {
    #[default]
    Warn,
    Strict,
    None,
}

/// Execution parameters for a preset.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetExecution {
    pub model_override: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    #[serde(default = "default_priority")]
    pub priority: String,
}

fn default_timeout() -> u64 {
    300
}

fn default_max_retries() -> u32 {
    3
}

fn default_priority() -> String {
    "normal".to_string()
}

impl Default for PresetExecution {
    fn default() -> Self {
        Self {
            model_override: None,
            timeout_seconds: default_timeout(),
            max_retries: default_max_retries(),
            priority: default_priority(),
        }
    }
}
