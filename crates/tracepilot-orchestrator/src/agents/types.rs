//! Agent definition, catalog and settings types.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Where an agent definition comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentScope {
    /// Installed with the Copilot CLI (`pkg/<platform>/<version>/definitions`).
    Builtin,
    /// `<COPILOT_HOME>/agents`.
    Personal,
    /// `<repo>/.github/agents` or `<repo>/.claude/agents`.
    Project,
    /// An installed plugin's `agents` directory.
    Plugin,
}

/// File format of a definition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentFormat {
    /// Built-in `*.agent.yaml` with the prompt in a `prompt` key.
    Yaml,
    /// `*.agent.md` / `*.md` with YAML frontmatter and the prompt as the body.
    Markdown,
}

/// The fields TracePilot edits. Absent keys are `None`, so a save only
/// rewrites keys the user actually changed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFields {
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    /// Ordered model preferences: one entry for a plain `model:` string, or
    /// the fallback list (1.0.83+).
    pub models: Vec<String>,
    /// `model-policy` (e.g. `required`: never fall back to another model).
    pub model_policy: Option<String>,
    pub reasoning_effort: Option<String>,
    pub context_tier: Option<String>,
    /// `None` means the key is absent: the agent gets every tool.
    pub tools: Option<Vec<String>>,
    pub include_custom_instructions: Option<bool>,
    pub deferred_tool_loading: Option<bool>,
    pub disable_model_invocation: Option<bool>,
    pub user_invocable: Option<bool>,
    /// Legacy spelling of "allow automatic delegation".
    pub infer: Option<bool>,
}

/// A frontmatter key TracePilot does not edit; preserved on save.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOtherField {
    pub key: String,
    /// The value re-rendered as compact YAML/JSON for display.
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDiagnostic {
    pub path: String,
    pub message: String,
    /// `error` | `warning` | `info`
    pub severity: String,
}

/// Catalog entry for the Agents manager.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionSummary {
    /// Stable identifier: the definition's file path.
    pub id: String,
    /// Name the CLI dispatches by (frontmatter `name`, else the file stem).
    pub name: String,
    /// File stem without `.agent`, which older CLIs use as the agent type.
    pub file_stem: String,
    pub display_name: Option<String>,
    pub description: String,
    pub scope: AgentScope,
    pub format: AgentFormat,
    pub path: String,
    /// Human label for the source (CLI version, repo, plugin, folder).
    pub source_label: String,
    pub repo_root: Option<String>,
    pub fields: AgentFields,
    pub has_mcp_servers: bool,
    /// Why the definition cannot be edited in place, if it cannot.
    pub read_only_reason: Option<String>,
    pub modified_at: Option<String>,
}

/// Full definition for the editor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionDetail {
    pub summary: AgentDefinitionSummary,
    pub raw_content: String,
    /// The prompt: Markdown body, or the YAML `prompt` value.
    pub body: String,
    pub other_fields: Vec<AgentOtherField>,
    /// `mcp-servers` as JSON, for read-only display.
    pub mcp_servers: Option<serde_json::Value>,
    pub diagnostics: Vec<AgentDiagnostic>,
}

/// Per-agent `/subagents` override (`subagents.agents.<agent_type>`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentOverride {
    /// A model ID, or `inherit` (use the session model).
    pub model: Option<String>,
    pub effort_level: Option<String>,
    /// `inherit` | `default` | `long_context`
    pub context_tier: Option<String>,
    /// Keys TracePilot preserves but does not edit (e.g. `autoInvoke`).
    #[serde(default)]
    pub other_keys: Vec<String>,
}

/// The `subagents` block of the user's `settings.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSettings {
    pub settings_path: String,
    /// Keyed by agent type as written by the CLI.
    pub overrides: BTreeMap<String, SubagentOverride>,
    pub disabled: Vec<String>,
    pub max_concurrency: Option<u64>,
    pub max_depth: Option<u64>,
    /// Session defaults the `inherit` values resolve to.
    pub session_model: Option<String>,
    pub session_effort: Option<String>,
    /// Set when the file or the block has an unexpected shape: overrides are
    /// then read-only and never written.
    pub shape_error: Option<String>,
    /// The raw `subagents` value, for display when the shape is unexpected.
    pub raw: Option<serde_json::Value>,
}

/// Everything the Agents manager needs in one call.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalog {
    pub definitions: Vec<AgentDefinitionSummary>,
    pub diagnostics: Vec<AgentDiagnostic>,
    pub settings: SubagentSettings,
    /// CLI version whose built-in definitions were read.
    pub cli_version: Option<String>,
    pub personal_dir: String,
    /// Repositories scanned for project agents.
    pub repo_roots: Vec<String>,
}

/// Where a new custom agent is created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentCreateScope {
    Personal,
    Project,
}

/// Result of a save, create or delete.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWriteResult {
    pub path: String,
    /// Backup of the previous content, when there was one.
    pub backup_path: Option<String>,
}
