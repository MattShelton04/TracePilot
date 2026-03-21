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
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            auto_index_on_launch: true,
            cli_command: "copilot".to_string(),
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
}

impl Default for FeaturesConfig {
    fn default() -> Self {
        Self {
            export_view: false,
            health_scoring: false,
            session_replay: false,
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
            version: 2,
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
    /// Load config from the standard location, or return None if it doesn't exist.
    pub fn load() -> Option<Self> {
        let path = config_file_path()?;
        let content = std::fs::read_to_string(&path).ok()?;
        match toml::from_str(&content) {
            Ok(config) => {
                tracing::info!(path = %path.display(), "Loaded config.toml");
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
