//! TracePilot configuration — loaded from `~/.copilot/tracepilot/config.toml`.

use crate::error::BindingsError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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
    #[serde(default)]
    pub tasks: TasksConfig,
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
    #[serde(default = "default_true")]
    pub mcp_servers: bool,
    #[serde(default = "default_true")]
    pub skills: bool,
    #[serde(default)]
    pub ai_tasks: bool,
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
            ai_tasks: false,
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

/// Configuration for the AI Agent Task System (orchestrator + subagents).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksConfig {
    /// Whether the tasks feature is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Model used for the orchestrator session (the polling root agent).
    #[serde(default = "default_orchestrator_model")]
    pub orchestrator_model: String,
    /// Default model for subagent task execution (overridable per-preset/task).
    #[serde(default = "default_subagent_model")]
    pub default_subagent_model: String,
    /// How often the orchestrator polls for new tasks (seconds).
    #[serde(default = "default_poll_interval")]
    pub poll_interval_seconds: u32,
    /// Maximum number of concurrent subagent tasks.
    #[serde(default = "default_max_concurrent_tasks")]
    pub max_concurrent_tasks: u32,
    /// Multiplier applied to poll interval to determine heartbeat staleness.
    /// If heartbeat is older than `poll_interval * this`, orchestrator is dead.
    #[serde(default = "default_heartbeat_stale_multiplier")]
    pub heartbeat_stale_multiplier: u32,
    /// Max consecutive orchestrator crash restarts before circuit-breaking.
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// Whether to auto-start the orchestrator when the app launches.
    #[serde(default)]
    pub auto_start_orchestrator: bool,
    /// Approximate token budget for context assembly per task.
    #[serde(default = "default_context_budget_tokens")]
    pub context_budget_tokens: u32,
}

fn default_orchestrator_model() -> String {
    "claude-haiku-4.5".to_string()
}
fn default_subagent_model() -> String {
    "claude-sonnet-4.6".to_string()
}
fn default_poll_interval() -> u32 {
    30
}
fn default_max_concurrent_tasks() -> u32 {
    3
}
fn default_heartbeat_stale_multiplier() -> u32 {
    6
}
fn default_max_retries() -> u32 {
    3
}
fn default_context_budget_tokens() -> u32 {
    50_000
}

impl Default for TasksConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            orchestrator_model: default_orchestrator_model(),
            default_subagent_model: default_subagent_model(),
            poll_interval_seconds: default_poll_interval(),
            max_concurrent_tasks: default_max_concurrent_tasks(),
            heartbeat_stale_multiplier: default_heartbeat_stale_multiplier(),
            max_retries: default_max_retries(),
            auto_start_orchestrator: false,
            context_budget_tokens: default_context_budget_tokens(),
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
            version: 4,
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
            tasks: TasksConfig::default(),
        }
    }
}

impl TracePilotConfig {
    /// Current schema version. Bump this when adding migrations.
    pub const CURRENT_VERSION: u32 = 4;

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
        // if self.version < 5 { ... self.version = 5; }

        // Migration from v3 → v4: added tasks config section (handled by serde default).
        if self.version < 4 {
            self.version = 4;
            tracing::info!("Migrated config from v3 → v4 (added tasks config)");
        }

        self.version != original
    }

    /// Load config from the standard location, or return None if it doesn't exist.
    /// Applies pending migrations and auto-saves if the version was bumped.
    pub fn load() -> Option<Self> {
        let path = config_file_path()?;
        match Self::load_from(&path) {
            Ok(mut config) => {
                tracing::info!(path = %path.display(), version = config.version, "Loaded config.toml");
                if config.migrate() {
                    tracing::info!(new_version = config.version, "Config migrated — saving");
                    if let Err(e) = config.save_to(&path) {
                        tracing::warn!(error = %e, "Failed to save migrated config");
                    }
                }
                Some(config)
            }
            Err(BindingsError::Io(ref io_err)) if io_err.kind() == std::io::ErrorKind::NotFound => {
                // Config file doesn't exist yet — normal on first run.
                None
            }
            Err(e) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "Failed to load config.toml; using defaults"
                );
                None
            }
        }
    }

    /// Read and parse a config file from an arbitrary path.
    ///
    /// Unlike [`load()`](Self::load) this does **not** apply migrations or
    /// auto-save.  It is the low-level "read + deserialize" primitive used by
    /// `load()` and available directly for testing.
    pub fn load_from(path: &Path) -> Result<Self, BindingsError> {
        let content = std::fs::read_to_string(path)?;
        let config = toml::from_str::<Self>(&content)?;
        Ok(config)
    }

    /// Save config to the standard location.
    pub fn save(&self) -> Result<(), BindingsError> {
        let path = config_file_path()
            .ok_or_else(|| BindingsError::Validation("Cannot determine home directory for config file".into()))?;
        self.save_to(&path)
    }

    /// Write the config to an arbitrary path, creating parent directories as
    /// needed.
    ///
    /// This is the low-level "serialize + write" primitive used by [`save()`](Self::save)
    /// and available directly for testing.
    ///
    /// Note: this is **not** atomic — a crash mid-write could leave a truncated
    /// file.  A future improvement could use write-to-temp + rename for
    /// crash-safety.
    pub fn save_to(&self, path: &Path) -> Result<(), BindingsError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = toml::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    pub fn session_state_dir(&self) -> PathBuf {
        PathBuf::from(&self.paths.session_state_dir)
    }

    pub fn index_db_path(&self) -> PathBuf {
        PathBuf::from(&self.paths.index_db_path)
    }

    /// Path to the task presets directory (derived from copilot home).
    pub fn presets_dir(&self) -> PathBuf {
        // Presets live alongside the index DB: ~/.copilot/tracepilot/presets/
        PathBuf::from(&self.paths.index_db_path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("presets")
    }

    /// Path to the jobs directory for orchestrator IPC.
    pub fn jobs_dir(&self) -> PathBuf {
        // Jobs dir: ~/.copilot/tracepilot/jobs/
        PathBuf::from(&self.paths.index_db_path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("jobs")
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
        assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
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
        assert!(config.general.auto_index_on_launch);
        assert_eq!(config.ui.theme, "dark");
        assert!(config.features.render_markdown);
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
        assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
        assert_eq!(config.paths.index_db_path, "/custom/path/index.db");
        assert_eq!(config.ui.theme, "light");
        // New v2 field gets default value
        assert!(config.features.render_markdown);
    }

    // ── File I/O tests (use tempfile) ──────────────────────────────

    #[test]
    fn save_to_load_from_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let config = TracePilotConfig::default();
        config.save_to(&path).expect("save_to should succeed");

        let loaded = TracePilotConfig::load_from(&path).expect("load_from should succeed");
        assert_eq!(loaded.version, config.version);
        assert_eq!(loaded.paths.session_state_dir, config.paths.session_state_dir);
        assert_eq!(loaded.paths.index_db_path, config.paths.index_db_path);
        assert_eq!(loaded.ui.theme, config.ui.theme);
        assert_eq!(loaded.pricing.cost_per_premium_request, config.pricing.cost_per_premium_request);
    }

    #[test]
    fn save_to_creates_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a").join("b").join("c").join("config.toml");

        let config = TracePilotConfig::default();
        config.save_to(&nested).expect("save_to should create parent dirs");

        assert!(nested.exists());
        let loaded = TracePilotConfig::load_from(&nested).expect("load_from nested path");
        assert_eq!(loaded.version, config.version);
    }

    #[test]
    fn save_to_preserves_user_settings_through_io() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let mut config = TracePilotConfig::default();
        config.ui.theme = "midnight-aurora".to_string();
        config.ui.check_for_updates = false;
        config.pricing.cost_per_premium_request = 0.08;
        config.features.export_view = true;
        config.general.cli_command = "gh-copilot".to_string();

        config.save_to(&path).expect("save");
        let loaded = TracePilotConfig::load_from(&path).expect("load");

        assert_eq!(loaded.ui.theme, "midnight-aurora");
        assert!(!loaded.ui.check_for_updates);
        assert_eq!(loaded.pricing.cost_per_premium_request, 0.08);
        assert!(loaded.features.export_view);
        assert_eq!(loaded.general.cli_command, "gh-copilot");
    }

    #[test]
    fn save_to_overwrites_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let mut config = TracePilotConfig::default();
        config.save_to(&path).expect("initial save");

        config.ui.theme = "arctic".to_string();
        config.save_to(&path).expect("overwrite save");

        let loaded = TracePilotConfig::load_from(&path).expect("load after overwrite");
        assert_eq!(loaded.ui.theme, "arctic");
    }

    #[test]
    fn load_from_nonexistent_file_returns_io_error() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does_not_exist.toml");

        let err = TracePilotConfig::load_from(&missing).unwrap_err();
        assert!(
            matches!(err, BindingsError::Io(_)),
            "expected Io error, got: {err:?}"
        );
    }

    #[test]
    fn load_from_empty_file_returns_toml_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.toml");
        std::fs::write(&path, "").unwrap();

        let err = TracePilotConfig::load_from(&path).unwrap_err();
        assert!(
            matches!(err, BindingsError::TomlDeserialize(_)),
            "expected TomlDeserialize error, got: {err:?}"
        );
    }

    #[test]
    fn load_from_corrupt_toml_returns_toml_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("corrupt.toml");
        std::fs::write(&path, "this is not {{valid}} toml!!!").unwrap();

        let err = TracePilotConfig::load_from(&path).unwrap_err();
        assert!(
            matches!(err, BindingsError::TomlDeserialize(_)),
            "expected TomlDeserialize error, got: {err:?}"
        );
    }

    #[test]
    fn load_from_wrong_schema_returns_toml_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wrong_schema.toml");
        // version should be u32, paths.sessionStateDir should be string
        std::fs::write(&path, r#"
            version = "not_a_number"

            [paths]
            sessionStateDir = 42
            indexDbPath = true
        "#).unwrap();

        let err = TracePilotConfig::load_from(&path).unwrap_err();
        assert!(
            matches!(err, BindingsError::TomlDeserialize(_)),
            "expected TomlDeserialize error, got: {err:?}"
        );
    }

    #[test]
    fn migration_through_file_io_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        // Write a v1 config directly to disk
        let v1_toml = r#"
            version = 1

            [paths]
            indexDbPath = "/test/index.db"
            sessionStateDir = "/test/sessions"

            [ui]
            theme = "solar-flare"
        "#;
        std::fs::write(&path, v1_toml).unwrap();

        // Load, migrate, save
        let mut config = TracePilotConfig::load_from(&path).expect("load v1");
        assert_eq!(config.version, 1);
        assert!(config.migrate());
        assert_eq!(config.version, TracePilotConfig::CURRENT_VERSION);
        config.save_to(&path).expect("save migrated");

        // Reload and verify migration persisted
        let reloaded = TracePilotConfig::load_from(&path).expect("reload");
        assert_eq!(reloaded.version, TracePilotConfig::CURRENT_VERSION);
        assert_eq!(reloaded.ui.theme, "solar-flare");
        assert_eq!(reloaded.paths.index_db_path, "/test/index.db");
        // v2 default applied
        assert!(reloaded.features.render_markdown);
    }
}
