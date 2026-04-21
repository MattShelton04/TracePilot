//! General (top-level misc) configuration.

use serde::{Deserialize, Serialize};

use super::defaults::{default_cli_command, default_true};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralConfig {
    #[serde(default = "default_true")]
    pub auto_index_on_launch: bool,
    #[serde(default = "default_cli_command")]
    pub cli_command: String,
    /// Set to true only after the first full indexing run completes.
    /// If false on startup, the setup wizard/indexing screen is shown.
    #[serde(default)]
    pub setup_complete: bool,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            auto_index_on_launch: true,
            cli_command: tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string(),
            setup_complete: false,
        }
    }
}
