//! Field-level configuration updates. Omitted fields retain their latest value;
//! collections replace atomically rather than merging stale frontend snapshots.

use super::*;
use std::collections::HashMap;

macro_rules! section_patch {
    ($name:ident, $config:ty, { $($(#[$meta:meta])* $field:ident: $type:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name {
            $(#[serde(default, skip_serializing_if = "Option::is_none")]
            $(#[$meta])*
            pub $field: Option<$type>,)*
        }
        impl $name {
            fn apply(self, config: &mut $config) {
                $(if let Some(value) = self.$field { config.$field = value; })*
            }
        }
    };
}

section_patch!(PathsPatch, PathsConfig, {
    copilot_home: String, tracepilot_home: String, session_state_dir: String,
    index_db_path: String,
});
section_patch!(GeneralPatch, GeneralConfig, {
    auto_index_on_launch: bool, cli_command: String, setup_complete: bool,
});
section_patch!(UiPatch, UiConfig, {
    theme: String, hide_empty_sessions: bool, auto_refresh_enabled: bool,
    auto_refresh_interval_seconds: u32, check_for_updates: bool,
    favourite_models: Vec<String>, recent_repo_paths: Vec<String>,
    content_max_width: u32, ui_scale: f64,
});
section_patch!(PricingPatch, PricingConfig, {
    cost_per_premium_request: f64, models: Vec<ModelPriceEntry>, removed_models: Vec<String>,
});
section_patch!(ToolRenderingPatch, ToolRenderingConfig, {
    enabled: bool, tool_overrides: HashMap<String, bool>,
});
section_patch!(FeaturesPatch, FeaturesConfig, {
    export_view: bool, session_replay: bool, render_markdown: bool, mcp_servers: bool,
    skills: bool, copilot_sdk: bool, exact_context_capture: bool, config_injector: bool,
    prompt_cache_insights: bool, agents: bool, claude_code_sessions: bool,
});
section_patch!(LoggingPatch, LoggingConfig, { level: String });
section_patch!(AlertsPatch, AlertsConfig, {
    enabled: bool, scope: String, native_notifications: bool, taskbar_flash: bool,
    sound_enabled: bool, on_session_end: bool, on_ask_user: bool,
    on_session_error: bool, cooldown_seconds: u32,
});
section_patch!(PerformancePatch, PerformanceConfig, {
    #[specta(type = Option<f64>)]
    session_cache_size: usize,
});
section_patch!(LivePatch, LiveConfig, { auto_attach: bool, launch_attachable: bool });
section_patch!(ClaudeCodeSourcePatch, ClaudeCodeSourceConfig, {
    config_dir: String, cli_command: String,
});

/// Field-level like the other sections, one level deeper: changing the
/// Claude Code folder keeps its CLI command, and the reverse.
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourcesPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_code: Option<ClaudeCodeSourcePatch>,
}

impl SourcesPatch {
    fn apply(self, config: &mut SourcesConfig) {
        if let Some(patch) = self.claude_code {
            patch.apply(&mut config.claude_code);
        }
    }
}

macro_rules! config_patch {
    ($($field:ident: $type:ty),* $(,)?) => {
        #[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct TracePilotConfigPatch {
            $(#[serde(default, skip_serializing_if = "Option::is_none")]
            pub $field: Option<$type>,)*
        }
        impl TracePilotConfigPatch {
            pub fn apply(self, config: &mut TracePilotConfig) {
                $(if let Some(patch) = self.$field { patch.apply(&mut config.$field); })*
            }
        }
    };
}

config_patch! {
    paths: PathsPatch, general: GeneralPatch, ui: UiPatch, pricing: PricingPatch,
    tool_rendering: ToolRenderingPatch, features: FeaturesPatch, logging: LoggingPatch,
    alerts: AlertsPatch, performance: PerformancePatch, live: LivePatch, sources: SourcesPatch,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_preserve_unrelated_fields_and_replace_collections() {
        let mut config = TracePilotConfig::default();
        config.paths.session_state_dir = "latest-session-directory".into();
        config
            .tool_rendering
            .tool_overrides
            .insert("view".into(), false);
        let patch: TracePilotConfigPatch = serde_json::from_value(serde_json::json!({
            "ui": { "theme": "light" }, "toolRendering": { "toolOverrides": {} }
        }))
        .unwrap();
        patch.apply(&mut config);
        assert_eq!(config.ui.theme, "light");
        assert_eq!(config.paths.session_state_dir, "latest-session-directory");
        assert!(config.tool_rendering.tool_overrides.is_empty());
    }

    #[test]
    fn a_claude_code_patch_keeps_the_fields_it_omits() {
        let mut config = TracePilotConfig::default();
        config.sources.claude_code.config_dir = "C:/claude".into();
        config.sources.claude_code.cli_command = "npx claude".into();
        let patch: TracePilotConfigPatch = serde_json::from_value(serde_json::json!({
            "sources": { "claudeCode": { "configDir": "D:/claude" } }
        }))
        .unwrap();
        patch.apply(&mut config);
        assert_eq!(config.sources.claude_code.config_dir, "D:/claude");
        assert_eq!(config.sources.claude_code.cli_command, "npx claude");
        let patch: TracePilotConfigPatch = serde_json::from_value(serde_json::json!({
            "sources": { "claudeCode": { "cliCommand": "claude" } }
        }))
        .unwrap();
        patch.apply(&mut config);
        assert_eq!(config.sources.claude_code.config_dir, "D:/claude");
        assert_eq!(config.sources.claude_code.cli_command, "claude");
    }

    #[test]
    fn unknown_fields_and_schema_version_updates_are_rejected() {
        for patch in [
            serde_json::json!({"version": 0}),
            serde_json::json!({"ui": {"typo": true}}),
        ] {
            assert!(serde_json::from_value::<TracePilotConfigPatch>(patch).is_err());
        }
    }
}
