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
    /// Prompt-cache countdown, resume markers and cache-break causes.
    #[serde(default = "default_true")]
    pub prompt_cache_insights: bool,
    /// Agents explorer: agent definitions, overrides and cross-session usage.
    #[serde(default = "default_true")]
    pub agents: bool,
    /// Use the Copilot CLI's session store as an extra source of evidence:
    /// per-request billing, timings, cache counters and linked work.
    ///
    /// The preference means "use this source when available". A missing store
    /// must never rewrite it to false — the user may install or update the
    /// CLI later, and the store would then be silently ignored.
    #[serde(default = "default_true")]
    pub session_store_enrichment: bool,
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
            prompt_cache_insights: true,
            agents: true,
            session_store_enrichment: true,
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
