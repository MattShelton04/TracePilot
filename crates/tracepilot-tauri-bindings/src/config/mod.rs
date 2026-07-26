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
//! - [`AlertsConfig`] — notification/toast/sound preferences.
//! - [`PerformanceConfig`] — bounded runtime cache retention.
//!
//! Wire-format rule: every sub-config must carry `#[serde(default)]` on its
//! field in [`TracePilotConfig`] so missing TOML sections round-trip cleanly.
//! Add new sub-configs behind a default-bearing field and bump
//! `CURRENT_VERSION` with a no-op migration entry.

use crate::error::BindingsError;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

mod alerts;
mod defaults;
mod features;
mod general;
mod logging;
mod paths;
mod performance;
mod pricing;
mod tool_rendering;
mod ui;

#[cfg(test)]
mod persistence_tests;
#[cfg(test)]
mod tests;

pub use alerts::AlertsConfig;
pub use features::FeaturesConfig;
pub use general::GeneralConfig;
pub use logging::LoggingConfig;
pub use paths::PathsConfig;
pub use performance::{
    DEFAULT_SESSION_CACHE_SIZE, MAX_SESSION_CACHE_SIZE, MIN_SESSION_CACHE_SIZE, PerformanceConfig,
    clamp_session_cache_size,
};
pub use pricing::{ModelPriceEntry, PricingConfig};
pub use tool_rendering::ToolRenderingConfig;
pub use ui::UiConfig;

pub fn config_file_path() -> Option<PathBuf> {
    tracepilot_core::paths::TracePilotPaths::try_default().map(|p| p.config_toml())
}

pub(crate) fn config_backup_file_path(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_os_string();
    backup.push(".bak");
    PathBuf::from(backup)
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
    pub alerts: AlertsConfig,
    #[serde(default)]
    pub performance: PerformanceConfig,
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
            alerts: AlertsConfig::default(),
            performance: PerformanceConfig::default(),
        }
    }
}

impl TracePilotConfig {
    /// Current schema version. Bump this when adding migrations.
    pub const CURRENT_VERSION: u32 = 11;

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

        // Migration from v3 → v4: legacy version bump.
        if self.version < 4 {
            self.version = 4;
            tracing::info!("Migrated config from v3 → v4");
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

        // Migration from v6 → v7: removed the experimental AI Tasks config
        // section. Serde ignores the old TOML table on read; saving the
        // migrated config drops it from disk.
        if self.version < 7 {
            self.version = 7;
            tracing::info!("Migrated config from v6 → v7 (removed AI Tasks config)");
        }

        // Migration from v7 → v8: removed a retired experimental feature flag.
        // Unknown TOML fields are ignored on read; saving the migrated config
        // drops the old key from disk.
        if self.version < 8 {
            self.version = 8;
            tracing::info!("Migrated config from v7 → v8 (removed retired feature config)");
        }

        // Migration from v8 → v9: added pricing context tiers and removal state.
        if self.version < 9 {
            self.version = 9;
            tracing::info!("Migrated config from v8 → v9 (pricing tiers and removal state)");
        }

        // Migration from v9 → v10: added the opt-in exact context capture flag.
        if self.version < 10 {
            self.version = 10;
            tracing::info!("Migrated config from v9 → v10 (exact context capture flag)");
        }

        // Migration from v10 → v11: added performance.sessionCacheSize.
        if self.version < 11 {
            self.version = 11;
            tracing::info!("Migrated config from v10 → v11 (session cache size setting)");
        }

        self.performance.normalize();

        self.version != original
    }

    /// Load config from the standard location, or return None if it doesn't exist.
    /// Applies pending migrations and auto-saves if the version was bumped.
    pub fn load() -> Option<Self> {
        let path = config_file_path()?;
        match Self::load_from_or_backup(&path) {
            Ok((mut config, recovered_from_backup)) => {
                tracing::info!(path = %path.display(), version = config.version, "Loaded config.toml");
                if recovered_from_backup {
                    tracing::warn!(
                        path = %path.display(),
                        backup = %config_backup_file_path(&path).display(),
                        "Recovered config.toml from the last-known-good backup"
                    );
                }
                let migrated = config.migrate();
                if migrated || recovered_from_backup {
                    if migrated {
                        tracing::info!(new_version = config.version, "Config migrated — saving");
                    }
                    if let Err(e) = config.save_to(&path) {
                        tracing::warn!(error = %e, "Failed to save recovered/migrated config");
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

    fn load_from_or_backup(path: &Path) -> Result<(Self, bool), BindingsError> {
        match Self::load_from(path) {
            Ok(config) => Ok((config, false)),
            Err(primary_error) => {
                let backup_path = config_backup_file_path(path);
                Self::load_from(&backup_path)
                    .map(|config| (config, true))
                    .map_err(|_| primary_error)
            }
        }
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
    /// Writes through a same-directory temporary file and keeps the previous
    /// valid configuration as `{path}.bak`. If the existing file is corrupt,
    /// it is replaced without overwriting the last-known-good backup.
    pub fn save_to(&self, path: &Path) -> Result<(), BindingsError> {
        tracepilot_core::utils::fs::ensure_parent_dir(path)?;
        let content = toml::to_string_pretty(self)?;
        let existing_is_valid = Self::load_from(path).is_ok();
        atomic_replace_config(path, content.as_bytes(), existing_is_valid)
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

    fn tracepilot_root_paths(&self) -> tracepilot_core::paths::TracePilotPaths {
        tracepilot_core::paths::TracePilotPaths::from_root(self.tracepilot_home())
    }

    fn derived_session_state_dir(&self) -> PathBuf {
        tracepilot_core::paths::CopilotPaths::from_home(&self.paths.copilot_home)
            .session_state_dir()
    }

    pub fn normalize_paths(&mut self) {
        self.performance.normalize();
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

fn atomic_replace_config(
    path: &Path,
    content: &[u8],
    backup_existing: bool,
) -> Result<(), BindingsError> {
    let mut temp_name = path.as_os_str().to_os_string();
    temp_name.push(format!(".tmp-{}", uuid::Uuid::new_v4()));
    let temp_path = PathBuf::from(temp_name);
    let mut backup_temp_path_to_cleanup = None;

    let write_result = (|| {
        let mut temp = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;
        temp.write_all(content)?;
        temp.sync_all()?;
        drop(temp);

        let backup_path = config_backup_file_path(path);
        if backup_existing {
            let mut backup_temp_name = backup_path.as_os_str().to_os_string();
            backup_temp_name.push(format!(".tmp-{}", uuid::Uuid::new_v4()));
            let backup_temp_path = PathBuf::from(backup_temp_name);
            backup_temp_path_to_cleanup = Some(backup_temp_path.clone());

            std::fs::copy(path, &backup_temp_path)?;
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&backup_temp_path)?
                .sync_all()?;
            replace_file(&backup_temp_path, &backup_path, None)?;
            backup_temp_path_to_cleanup = None;
        }

        replace_file(
            &temp_path,
            path,
            backup_existing.then_some(backup_path.as_path()),
        )
    })();

    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
        if let Some(backup_temp_path) = backup_temp_path_to_cleanup {
            let _ = std::fs::remove_file(backup_temp_path);
        }
    }
    write_result
}

fn replace_file(
    source: &Path,
    destination: &Path,
    recovery: Option<&Path>,
) -> Result<(), BindingsError> {
    #[cfg(windows)]
    if destination.exists() {
        std::fs::remove_file(destination)?;
    }

    if let Err(error) = std::fs::rename(source, destination) {
        if !destination.exists()
            && let Some(recovery) = recovery
            && recovery.exists()
        {
            let _ = std::fs::copy(recovery, destination);
        }
        return Err(error.into());
    }

    Ok(())
}
