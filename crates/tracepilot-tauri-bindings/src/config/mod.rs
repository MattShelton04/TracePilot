//! TracePilot configuration — loaded from `~/.copilot/tracepilot/config.toml`.
//!
//! The top-level [`TracePilotConfig`] aggregates a handful of per-concern
//! sub-configs which live in dedicated sibling modules. Re-exports below
//! preserve the pre-split public API byte-for-byte.
//!
//! Sub-config roster (keep each sibling file < 200 LOC):
//! - [`PathsConfig`] — on-disk roots (Copilot home, TracePilot home, session-state dir).
//! - [`GeneralConfig`] — CLI command, setup-complete flag, misc top-level.
//! - [`UiConfig`] — theme, refresh cadence, favourite-model list, scaling.
//! - [`PricingConfig`] — model-pricing table + premium-request cost.
//! - [`ToolRenderingConfig`] — per-tool render toggles.
//! - [`FeaturesConfig`] — feature-flag booleans exposed to the frontend.
//! - [`LoggingConfig`] — log-level wiring.
//! - [`TasksConfig`] — AI orchestrator/subagent knobs.
//! - [`AlertsConfig`] — notification/toast/sound preferences.
//!
//! Wire-format rule: every sub-config must carry `#[serde(default)]` on its
//! field in [`TracePilotConfig`] so missing TOML sections round-trip cleanly.
//! Add new sub-configs behind a default-bearing field and bump
//! `CURRENT_VERSION` with a no-op migration entry.

use crate::error::BindingsError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

mod alerts;
mod defaults;
mod features;
mod general;
mod logging;
mod paths;
mod pricing;
mod tasks;
mod tool_rendering;
mod ui;

#[cfg(test)]
mod tests;

pub use alerts::AlertsConfig;
pub use features::FeaturesConfig;
pub use general::GeneralConfig;
pub use logging::LoggingConfig;
pub use paths::PathsConfig;
pub use pricing::{ModelPriceEntry, PricingConfig};
pub use tasks::TasksConfig;
pub use tool_rendering::ToolRenderingConfig;
pub use ui::UiConfig;

pub fn config_file_path() -> Option<PathBuf> {
    tracepilot_core::paths::TracePilotPaths::default().map(|p| p.config_toml())
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
    #[serde(default)]
    pub alerts: AlertsConfig,
}

impl Default for TracePilotConfig {
    fn default() -> Self {
        // home_dir() can fail if env vars are missing; use empty strings as
        // sentinel values — the setup wizard will prompt the user for paths.
        let copilot_paths =
            tracepilot_core::paths::CopilotPaths::from_user_home(home_dir().unwrap_or_default());
        let tracepilot_paths = copilot_paths.tracepilot();
        Self {
            version: Self::CURRENT_VERSION,
            paths: PathsConfig {
                copilot_home: copilot_paths.home().to_string_lossy().to_string(),
                tracepilot_home: tracepilot_paths.root().to_string_lossy().to_string(),
                session_state_dir: copilot_paths
                    .session_state_dir()
                    .to_string_lossy()
                    .to_string(),
                index_db_path: tracepilot_paths.index_db().to_string_lossy().to_string(),
            },
            general: GeneralConfig::default(),
            ui: UiConfig::default(),
            pricing: PricingConfig::default(),
            tool_rendering: ToolRenderingConfig::default(),
            features: FeaturesConfig::default(),
            logging: LoggingConfig::default(),
            tasks: TasksConfig::default(),
            alerts: AlertsConfig::default(),
        }
    }
}

impl TracePilotConfig {
    /// Current schema version. Bump this when adding migrations.
    pub const CURRENT_VERSION: u32 = 6;

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

        // Migration from v4 → v5: added alerts config section (handled by serde default).
        if self.version < 5 {
            self.version = 5;
            tracing::info!("Migrated config from v4 → v5 (added alerts config)");
        }

        // Migration from v5 → v6: make Copilot home and TracePilot home explicit.
        // Existing custom indexDbPath values seed tracepilotHome from their
        // parent, then indexDbPath becomes the derived compatibility field.
        if self.version < 6 {
            self.normalize_paths();
            self.version = 6;
            tracing::info!("Migrated config from v5 → v6 (explicit path homes)");
        } else {
            self.normalize_paths();
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
        let path = config_file_path().ok_or_else(|| {
            BindingsError::Validation("Cannot determine home directory for config file".into())
        })?;
        let mut normalized = self.clone();
        normalized.normalize_paths();
        normalized.save_to(&path)
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
        if self.paths.session_state_dir.trim().is_empty() {
            self.derived_session_state_dir()
        } else {
            PathBuf::from(&self.paths.session_state_dir)
        }
    }

    pub fn copilot_home(&self) -> PathBuf {
        PathBuf::from(&self.paths.copilot_home)
    }

    pub fn tracepilot_home(&self) -> PathBuf {
        PathBuf::from(&self.paths.tracepilot_home)
    }

    pub fn index_db_path(&self) -> PathBuf {
        self.tracepilot_root_paths().index_db()
    }

    /// Path to the task presets directory (derived from TracePilot home).
    pub fn presets_dir(&self) -> PathBuf {
        self.tracepilot_root_paths().presets_dir()
    }

    /// Path to the task database (derived from TracePilot home).
    pub fn task_db_path(&self) -> PathBuf {
        self.tracepilot_root_paths().tasks_db()
    }

    /// Path to the jobs directory for orchestrator IPC.
    pub fn jobs_dir(&self) -> PathBuf {
        self.tracepilot_root_paths().jobs_dir()
    }

    fn tracepilot_root_paths(&self) -> tracepilot_core::paths::TracePilotPaths {
        tracepilot_core::paths::TracePilotPaths::from_root(self.tracepilot_home())
    }

    fn derived_session_state_dir(&self) -> PathBuf {
        tracepilot_core::paths::CopilotPaths::from_home(&self.paths.copilot_home)
            .session_state_dir()
    }

    pub fn normalize_paths(&mut self) {
        let defaults = Self::default();
        if self.paths.copilot_home.trim().is_empty() {
            self.paths.copilot_home = defaults.paths.copilot_home;
        }

        if self.paths.tracepilot_home.trim().is_empty() {
            let legacy_parent = PathBuf::from(&self.paths.index_db_path)
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .map(Path::to_path_buf);
            self.paths.tracepilot_home = legacy_parent
                .unwrap_or_else(|| {
                    tracepilot_core::paths::CopilotPaths::from_home(&self.paths.copilot_home)
                        .tracepilot()
                        .root()
                        .to_path_buf()
                })
                .to_string_lossy()
                .to_string();
        }

        if self.paths.session_state_dir.trim().is_empty() {
            self.paths.session_state_dir = self
                .derived_session_state_dir()
                .to_string_lossy()
                .to_string();
        }
        self.paths.index_db_path = self.index_db_path().to_string_lossy().to_string();
    }
}

/// Thread-safe shared config state for Tauri managed state.
pub type SharedConfig = Arc<RwLock<Option<TracePilotConfig>>>;

pub fn create_shared_config() -> SharedConfig {
    let config = TracePilotConfig::load();
    Arc::new(RwLock::new(config))
}
