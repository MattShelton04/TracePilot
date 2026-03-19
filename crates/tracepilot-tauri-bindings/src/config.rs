//! TracePilot configuration — loaded from `~/.copilot/tracepilot/config.toml`.

use serde::{Deserialize, Serialize};
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
    pub general: GeneralConfig,
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
    pub auto_index_on_launch: bool,
}

impl Default for TracePilotConfig {
    fn default() -> Self {
        // home_dir() can fail if env vars are missing; use empty strings as
        // sentinel values — the setup wizard will prompt the user for paths.
        let home = home_dir().unwrap_or_default();
        Self {
            version: 1,
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
            general: GeneralConfig {
                auto_index_on_launch: true,
            },
        }
    }
}

impl TracePilotConfig {
    /// Load config from the standard location, or return None if it doesn't exist.
    pub fn load() -> Option<Self> {
        let path = config_file_path()?;
        let content = std::fs::read_to_string(&path).ok()?;
        match toml::from_str(&content) {
            Ok(config) => Some(config),
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
