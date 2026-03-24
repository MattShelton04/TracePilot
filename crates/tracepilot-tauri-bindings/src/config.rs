//! TracePilot configuration — loaded from `~/.copilot/tracepilot/config.toml`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

/// The canonical config file location.
fn config_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".copilot").join("tracepilot"))
}

pub fn config_file_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("config.toml"))
}

fn home_dir() -> Option<PathBuf> {
    tracepilot_core::utils::home_dir_opt()
}

/// Top-level configuration.
///
/// Note: `rename_all = "camelCase"` ensures JSON (Tauri IPC) uses camelCase to
/// match the TypeScript `TracePilotConfig` type.  The TOML file on disk will
/// also use camelCase keys — this is intentional so a single struct serves both
/// serialization targets without a separate DTO layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracePilotConfig {
    pub version: u32,
    pub paths: PathsConfig,
    #[serde(default)]
    pub general: GeneralConfig,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub pricing: PricingConfig,
    #[serde(default)]
    pub tool_rendering: ToolRenderingConfig,
    #[serde(default)]
    pub features: FeaturesConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsConfig {
    pub session_state_dir: String,
    pub index_db_path: String,
}

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
            cli_command: "copilot".to_string(),
            setup_complete: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    #[serde(default)]
    pub check_for_updates: bool,
    #[serde(default = "default_favourite_models")]
    pub favourite_models: Vec<String>,
    #[serde(default)]
    pub recent_repo_paths: Vec<String>,
    #[serde(default = "default_content_max_width")]
    pub content_max_width: u32,
    #[serde(default = "default_ui_scale")]
    pub ui_scale: f64,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            hide_empty_sessions: true,
            auto_refresh_enabled: false,
            auto_refresh_interval_seconds: 5,
            check_for_updates: false,
            favourite_models: default_favourite_models(),
            recent_repo_paths: Vec::new(),
            content_max_width: 1600,
            ui_scale: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingConfig {
    #[serde(default = "default_cost_per_premium_request")]
    pub cost_per_premium_request: f64,
    #[serde(default = "default_model_prices")]
    pub models: Vec<ModelPriceEntry>,
}

impl Default for PricingConfig {
    fn default() -> Self {
        Self {
            cost_per_premium_request: 0.04,
            models: default_model_prices(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceEntry {
    pub model: String,
    pub input_per_m: f64,
    pub cached_input_per_m: f64,
    pub output_per_m: f64,
    pub premium_requests: f64,
}

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
}

impl Default for FeaturesConfig {
    fn default() -> Self {
        Self {
            export_view: false,
            health_scoring: false,
            session_replay: false,
            render_markdown: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggingConfig {
    #[serde(default = "default_log_level")]
    pub level: String,
}

fn default_log_level() -> String {
    "info".to_string()
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: default_log_level(),
        }
    }
}

// ── Serde default helpers ────────────────────────────────────────

fn default_true() -> bool {
    true
}
fn default_theme() -> String {
    "dark".to_string()
}
fn default_cli_command() -> String {
    "copilot".to_string()
}
fn default_auto_refresh_interval() -> u32 {
    5
}
fn default_content_max_width() -> u32 {
    1600
}
fn default_ui_scale() -> f64 {
    1.0
}
fn default_cost_per_premium_request() -> f64 {
    0.04
}
fn default_favourite_models() -> Vec<String> {
    vec![
        "claude-opus-4.6".to_string(),
        "gpt-5.4".to_string(),
        "gpt-5.3-codex".to_string(),
    ]
}

fn default_model_prices() -> Vec<ModelPriceEntry> {
    vec![
        ModelPriceEntry { model: "claude-sonnet-4.6".into(), input_per_m: 3.0, cached_input_per_m: 0.3, output_per_m: 15.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "claude-sonnet-4.5".into(), input_per_m: 3.0, cached_input_per_m: 0.3, output_per_m: 15.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "claude-haiku-4.5".into(), input_per_m: 1.0, cached_input_per_m: 0.1, output_per_m: 5.0, premium_requests: 0.33 },
        ModelPriceEntry { model: "claude-opus-4.6".into(), input_per_m: 5.0, cached_input_per_m: 0.5, output_per_m: 25.0, premium_requests: 3.0 },
        ModelPriceEntry { model: "claude-opus-4.6-fast".into(), input_per_m: 5.0, cached_input_per_m: 0.5, output_per_m: 25.0, premium_requests: 30.0 },
        ModelPriceEntry { model: "claude-opus-4.5".into(), input_per_m: 5.0, cached_input_per_m: 0.5, output_per_m: 25.0, premium_requests: 3.0 },
        ModelPriceEntry { model: "claude-sonnet-4".into(), input_per_m: 3.0, cached_input_per_m: 0.3, output_per_m: 15.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gemini-3-pro-preview".into(), input_per_m: 3.0, cached_input_per_m: 0.3, output_per_m: 16.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gpt-5.4".into(), input_per_m: 2.5, cached_input_per_m: 0.25, output_per_m: 15.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gpt-5.3-codex".into(), input_per_m: 1.75, cached_input_per_m: 0.175, output_per_m: 14.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gpt-5.2-codex".into(), input_per_m: 1.75, cached_input_per_m: 0.175, output_per_m: 14.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gpt-5.2".into(), input_per_m: 2.5, cached_input_per_m: 0.25, output_per_m: 15.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gpt-5.1-codex-max".into(), input_per_m: 1.75, cached_input_per_m: 0.175, output_per_m: 14.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gpt-5.1-codex".into(), input_per_m: 1.75, cached_input_per_m: 0.175, output_per_m: 14.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gpt-5.1".into(), input_per_m: 10.0, cached_input_per_m: 1.0, output_per_m: 40.0, premium_requests: 1.0 },
        ModelPriceEntry { model: "gpt-5.4-mini".into(), input_per_m: 0.4, cached_input_per_m: 0.04, output_per_m: 1.6, premium_requests: 0.33 },
        ModelPriceEntry { model: "gpt-5.1-codex-mini".into(), input_per_m: 0.4, cached_input_per_m: 0.04, output_per_m: 1.6, premium_requests: 0.33 },
        ModelPriceEntry { model: "gpt-5-mini".into(), input_per_m: 0.4, cached_input_per_m: 0.04, output_per_m: 1.6, premium_requests: 0.0 },
        ModelPriceEntry { model: "gpt-4.1".into(), input_per_m: 8.0, cached_input_per_m: 0.8, output_per_m: 24.0, premium_requests: 0.0 },
    ]
}

impl Default for TracePilotConfig {
    fn default() -> Self {
        // home_dir() can fail if env vars are missing; use empty strings as
        // sentinel values — the setup wizard will prompt the user for paths.
        let home = home_dir().unwrap_or_default();
        Self {
            version: 3,
            paths: PathsConfig {
                session_state_dir: home
                    .join(".copilot")
                    .join("session-state")
                    .to_string_lossy()
                    .to_string(),
                index_db_path: home
                    .join(".copilot")
                    .join("tracepilot")
                    .join("index.db")
                    .to_string_lossy()
                    .to_string(),
            },
            general: GeneralConfig::default(),
            ui: UiConfig::default(),
            pricing: PricingConfig::default(),
            tool_rendering: ToolRenderingConfig::default(),
            features: FeaturesConfig::default(),
            logging: LoggingConfig::default(),
        }
    }
}

impl TracePilotConfig {
    /// Current schema version. Bump this when adding migrations.
    pub const CURRENT_VERSION: u32 = 3;

    /// Apply any pending migrations to bring the config up to the current version.
    /// Returns true if any migrations were applied.
    pub fn migrate(&mut self) -> bool {
        let original = self.version;

        // Migration from v1 → v2: added features.render_markdown (handled by serde default)
        if self.version < 2 {
            self.version = 2;
            tracing::info!("Migrated config from v1 → v2");
        }

        // Migration from v2 → v3: backfill setupComplete for existing installs.
        // The setupComplete field was added without a migration, so existing configs
        // deserialize with setup_complete=false even though setup was already done.
        if self.version < 3 {
            if !self.general.setup_complete {
                let db_exists = std::path::Path::new(&self.paths.index_db_path).exists();
                if db_exists {
                    self.general.setup_complete = true;
                    tracing::info!("Backfilled setupComplete=true (index DB exists)");
                }
            }
            self.version = 3;
            tracing::info!("Migrated config from v2 → v3");
        }

        // Future migrations go here:
        // if self.version < 4 { ... self.version = 4; }

        self.version != original
    }

    /// Load config from the standard location, or return None if it doesn't exist.
    /// Applies pending migrations and auto-saves if the version was bumped.
    pub fn load() -> Option<Self> {
        let path = config_file_path()?;
        let content = std::fs::read_to_string(&path).ok()?;
        match toml::from_str::<Self>(&content) {
            Ok(mut config) => {
                tracing::info!(path = %path.display(), version = config.version, "Loaded config.toml");
                if config.migrate() {
                    tracing::info!(new_version = config.version, "Config migrated — saving");
                    if let Err(e) = config.save() {
                        tracing::warn!(error = %e, "Failed to save migrated config");
                    }
                }
                Some(config)
            }
            Err(e) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "Failed to parse config.toml; using defaults"
                );
                None
            }
        }
    }

    /// Save config to the standard location.
    pub fn save(&self) -> Result<(), String> {
        let path = config_file_path()
            .ok_or_else(|| "Cannot determine home directory for config file".to_string())?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {e}"))?;
        }
        let content =
            toml::to_string_pretty(self).map_err(|e| format!("Failed to serialize config: {e}"))?;
        std::fs::write(&path, content).map_err(|e| format!("Failed to write config file: {e}"))?;
        Ok(())
    }

    pub fn session_state_dir(&self) -> PathBuf {
        PathBuf::from(&self.paths.session_state_dir)
    }

    pub fn index_db_path(&self) -> PathBuf {
        PathBuf::from(&self.paths.index_db_path)
    }
}

/// Thread-safe shared config state for Tauri managed state.
pub type SharedConfig = Arc<RwLock<Option<TracePilotConfig>>>;

pub fn create_shared_config() -> SharedConfig {
    let config = TracePilotConfig::load();
    Arc::new(RwLock::new(config))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_version_matches_default() {
        let config = TracePilotConfig::default();
        assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
    }

    #[test]
    fn migrate_v1_to_v3() {
        let mut config = TracePilotConfig::default();
        config.version = 1;
        assert!(config.migrate());
        assert_eq!(config.version, 3);
    }

    #[test]
    fn migrate_current_version_is_noop() {
        let mut config = TracePilotConfig::default();
        assert!(!config.migrate());
        assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
    }

    #[test]
    fn migrate_future_version_is_noop() {
        let mut config = TracePilotConfig::default();
        config.version = 999;
        assert!(!config.migrate());
        assert_eq!(config.version, 999);
    }

    #[test]
    fn migrate_v0_bumps_through_all_versions() {
        let mut config = TracePilotConfig::default();
        config.version = 0;
        assert!(config.migrate());
        assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
    }

    #[test]
    fn roundtrip_toml_serialization() {
        let config = TracePilotConfig::default();
        let toml_str = toml::to_string_pretty(&config).expect("serialize");
        let parsed: TracePilotConfig = toml::from_str(&toml_str).expect("deserialize");
        assert_eq!(parsed.version, config.version);
        assert_eq!(parsed.paths.index_db_path, config.paths.index_db_path);
    }

    #[test]
    fn deserialize_missing_optional_sections_uses_defaults() {
        let minimal = r#"
            version = 2

            [paths]
            indexDbPath = "~/.copilot/tracepilot/index.db"
            sessionStateDir = "~/.copilot/tracepilot"
        "#;
        let config: TracePilotConfig = toml::from_str(minimal).expect("parse minimal config");
        assert_eq!(config.version, 2); // still v2 in TOML, migration upgrades it
        assert_eq!(config.general.auto_index_on_launch, true);
        assert_eq!(config.ui.theme, "dark");
        assert_eq!(config.features.render_markdown, true);
    }

    #[test]
    fn deserialize_v1_config_and_migrate() {
        let v1_toml = r#"
            version = 1

            [paths]
            indexDbPath = "/custom/path/index.db"
            sessionStateDir = "/custom/path"

            [ui]
            theme = "light"
        "#;
        let mut config: TracePilotConfig = toml::from_str(v1_toml).expect("parse v1 config");
        assert_eq!(config.version, 1);
        assert!(config.migrate());
        assert_eq!(config.version, 3);
        // Preserved user settings survive migration
        assert_eq!(config.paths.index_db_path, "/custom/path/index.db");
        assert_eq!(config.ui.theme, "light");
        // New v2 field gets default value
        assert_eq!(config.features.render_markdown, true);
    }
}
