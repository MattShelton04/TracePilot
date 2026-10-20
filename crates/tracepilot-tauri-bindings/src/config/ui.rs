//! UI-related configuration (theme, refresh cadence, favourites, etc).

use serde::{Deserialize, Serialize};

use super::defaults::{
    default_auto_refresh_interval, default_content_max_width, default_favourite_models,
    default_theme, default_true, default_ui_scale,
};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UiConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub hide_empty_sessions: bool,
    #[serde(default)]
    pub auto_refresh_enabled: bool,
    #[serde(default = "default_auto_refresh_interval")]
    pub auto_refresh_interval_seconds: u32,
    #[serde(default = "default_true")]
    pub check_for_updates: bool,
    #[serde(default = "default_favourite_models")]
    pub favourite_models: Vec<String>,
    #[serde(default)]
    pub recent_repo_paths: Vec<String>,
    #[serde(default = "default_content_max_width")]
    pub content_max_width: u32,
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f64,
    /// Look up linked pull requests' state on GitHub with the user's `gh`.
    #[serde(default = "default_true")]
    pub pull_request_lookup: bool,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            hide_empty_sessions: true,
            auto_refresh_enabled: false,
            auto_refresh_interval_seconds: 5,
            check_for_updates: true,
            favourite_models: default_favourite_models(),
            recent_repo_paths: Vec::new(),
            content_max_width: 1600,
            ui_scale: 1.0,
            pull_request_lookup: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::{TracePilotConfig, TracePilotConfigPatch};

    #[test]
    fn pull_request_lookup_defaults_on_round_trips_and_patches() {
        let existing: TracePilotConfig =
            toml::from_str("version = 12\n[paths]\n[ui]\ntheme = \"light\"\n")
                .expect("parse a config saved before the setting existed");
        assert!(existing.ui.pull_request_lookup);
        assert!(TracePilotConfig::default().ui.pull_request_lookup);

        let mut config = TracePilotConfig::default();
        config.ui.pull_request_lookup = false;
        let toml_str = toml::to_string_pretty(&config).expect("serialize");
        assert!(toml_str.contains("pullRequestLookup = false"));
        let parsed: TracePilotConfig = toml::from_str(&toml_str).expect("deserialize");
        assert!(!parsed.ui.pull_request_lookup);

        let patch: TracePilotConfigPatch =
            serde_json::from_value(serde_json::json!({ "ui": { "pullRequestLookup": true } }))
                .expect("patch");
        let mut patched = parsed;
        patch.apply(&mut patched);
        assert!(patched.ui.pull_request_lookup);
        assert_eq!(patched.ui.theme, "dark");
    }
}
