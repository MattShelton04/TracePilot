//! Feature-flag toggles exposed to the UI.

use serde::{Deserialize, Serialize};

use super::defaults::default_true;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturesConfig {
    #[serde(default)]
    pub export_view: bool,
    #[serde(default)]
    pub health_scoring: bool,
    #[serde(default)]
    pub session_replay: bool,
    #[serde(default = "default_true")]
    pub render_markdown: bool,
    #[serde(default = "default_true")]
    pub mcp_servers: bool,
    #[serde(default = "default_true")]
    pub skills: bool,
    #[serde(default)]
    pub copilot_sdk: bool,
}

impl Default for FeaturesConfig {
    fn default() -> Self {
        Self {
            export_view: false,
            health_scoring: false,
            session_replay: false,
            render_markdown: true,
            mcp_servers: true,
            skills: true,
            copilot_sdk: false,
        }
    }
}
