//! Feature-flag toggles exposed to the UI.

use serde::{Deserialize, Serialize};

use super::defaults::default_true;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FeaturesConfig {
    #[serde(default = "default_true")]
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
    /// Index and view Claude Code sessions next to Copilot CLI sessions.
    #[serde(default)]
    pub claude_code_sessions: bool,
}

impl Default for FeaturesConfig {
    fn default() -> Self {
        Self {
            export_view: true,
            session_replay: false,
            render_markdown: true,
            mcp_servers: false,
            skills: true,
            copilot_sdk: false,
            exact_context_capture: false,
            config_injector: false,
            prompt_cache_insights: true,
            agents: true,
            claude_code_sessions: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::FeaturesConfig;
    use std::collections::BTreeMap;

    const TS_DEFAULTS: &str = include_str!("../../../../packages/types/src/defaults.ts");

    /// `DEFAULT_FEATURES` from `packages/types/src/defaults.ts`, by camelCase key.
    fn ts_default_features() -> BTreeMap<String, bool> {
        let start = TS_DEFAULTS
            .find("export const DEFAULT_FEATURES")
            .expect("defaults.ts exports DEFAULT_FEATURES");
        let body = &TS_DEFAULTS[start..];
        let body = &body[body.find('{').unwrap() + 1..body.find("};").unwrap()];
        body.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with("//"))
            .map(|line| {
                let (key, value) = line
                    .trim_end_matches(',')
                    .split_once(':')
                    .unwrap_or_else(|| panic!("unexpected DEFAULT_FEATURES line {line:?}"));
                let value = value
                    .trim()
                    .parse()
                    .unwrap_or_else(|_| panic!("{key} is not a boolean literal"));
                (key.trim().to_string(), value)
            })
            .collect()
    }

    fn as_map(features: &FeaturesConfig) -> BTreeMap<String, bool> {
        serde_json::from_value(serde_json::to_value(features).unwrap()).unwrap()
    }

    /// The frontend's defaults, `Default` and a config missing every key all
    /// agree, so a config written without a flag shows what Settings promises.
    #[test]
    fn defaults_match_the_frontend_and_missing_keys() {
        let ts = ts_default_features();
        assert_eq!(
            as_map(&FeaturesConfig::default()),
            ts,
            "Default vs defaults.ts"
        );
        let missing: FeaturesConfig = toml::from_str("").unwrap();
        assert_eq!(as_map(&missing), ts, "serde defaults vs defaults.ts");
    }

    #[test]
    fn experimental_configuration_features_default_off() {
        let defaults = FeaturesConfig::default();
        assert!(!defaults.mcp_servers);
        assert!(!defaults.config_injector);
        assert!(!defaults.claude_code_sessions);

        let missing_fields: FeaturesConfig =
            toml::from_str("").expect("an empty features table should use field defaults");
        assert!(!missing_fields.mcp_servers);
        assert!(!missing_fields.config_injector);
        assert!(!missing_fields.claude_code_sessions);
    }
}
