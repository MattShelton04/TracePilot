//! Session sources other than Copilot. Copilot's paths stay in
//! [`super::PathsConfig`]; whether a source runs is a feature flag.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SourcesConfig {
    #[serde(default)]
    pub claude_code: ClaudeCodeSourceConfig,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeSourceConfig {
    /// Claude Code's config directory (`projects/` lives under it). Empty
    /// until normalized to `CLAUDE_CONFIG_DIR`, else `~/.claude`.
    #[serde(default)]
    pub config_dir: String,
}
