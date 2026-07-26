//! Feature-flag toggles exposed to the UI.

use serde::{Deserialize, Serialize};

use super::defaults::default_true;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturesConfig {
    #[serde(default)]
    pub export_view: bool,
    #[serde(default)]
    pub session_replay: bool,
    #[serde(default = "default_true")]
    pub render_markdown: bool,
    #[serde(default)]
    pub mcp_servers: bool,
    #[serde(default = "default_true")]
    pub skills: bool,
    #[serde(default)]
    pub copilot_sdk: bool,
    #[serde(default)]
    pub exact_context_capture: bool,
    #[serde(default)]
    pub config_injector: bool,
}

impl Default for FeaturesConfig {
    fn default() -> Self {
        Self {
            export_view: false,
            session_replay: false,
            render_markdown: true,
            mcp_servers: false,
            skills: true,
            copilot_sdk: false,
            exact_context_capture: false,
            config_injector: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::FeaturesConfig;

    #[test]
    fn experimental_configuration_features_default_off() {
        let defaults = FeaturesConfig::default();
        assert!(!defaults.mcp_servers);
        assert!(!defaults.config_injector);

        let missing_fields: FeaturesConfig =
            toml::from_str("").expect("an empty features table should use field defaults");
        assert!(!missing_fields.mcp_servers);
        assert!(!missing_fields.config_injector);
    }
}
