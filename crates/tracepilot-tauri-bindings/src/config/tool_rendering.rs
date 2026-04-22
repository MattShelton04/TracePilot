//! Tool-rendering toggles (global switch + per-tool overrides).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::defaults::default_true;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRenderingConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub tool_overrides: HashMap<String, bool>,
}

impl Default for ToolRenderingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            tool_overrides: HashMap::new(),
        }
    }
}
