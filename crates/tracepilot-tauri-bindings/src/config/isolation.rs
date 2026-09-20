//! Validation for configuration paths under an explicit isolation boundary.

use std::path::Path;

use super::TracePilotConfig;
use crate::error::BindingsError;

impl TracePilotConfig {
    pub(crate) fn validate_isolation_boundary(&self) -> Result<(), BindingsError> {
        let root = tracepilot_core::paths::isolated_data_root()
            .map_err(|error| BindingsError::Validation(error.to_string()))?;
        let Some(root) = root else {
            return Ok(());
        };
        self.validate_paths_within_data_root(&root)
    }

    pub(crate) fn validate_paths_within_data_root(&self, root: &Path) -> Result<(), BindingsError> {
        for (label, path) in [
            ("Copilot home", self.copilot_home()),
            ("TracePilot data directory", self.tracepilot_home()),
            ("session-state directory", self.session_state_dir()),
            ("index database", self.index_db_path()),
        ] {
            if !tracepilot_core::paths::path_is_within_data_root(root, &path) {
                return Err(BindingsError::Validation(format!(
                    "{label} must stay within {} while TRACEPILOT_DATA_ROOT is set: {}",
                    root.display(),
                    path.display()
                )));
            }
        }
        Ok(())
    }

    pub(super) fn validate_explicit_paths_within_data_root(
        &self,
        root: &Path,
    ) -> Result<(), BindingsError> {
        for (label, configured) in [
            ("Copilot home", self.paths.copilot_home.as_str()),
            (
                "TracePilot data directory",
                self.paths.tracepilot_home.as_str(),
            ),
            (
                "session-state directory",
                self.paths.session_state_dir.as_str(),
            ),
            ("index database", self.paths.index_db_path.as_str()),
        ] {
            if configured.trim().is_empty() {
                continue;
            }
            let path = Path::new(configured);
            if !tracepilot_core::paths::path_is_within_data_root(root, path) {
                return Err(BindingsError::Validation(format!(
                    "{label} must stay within {} while TRACEPILOT_DATA_ROOT is set: {}",
                    root.display(),
                    path.display()
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_config_paths_must_stay_inside_data_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("isolated");
        let mut config = TracePilotConfig::default();
        config.paths.copilot_home = root.join("copilot").to_string_lossy().to_string();
        config.paths.tracepilot_home = root.join("tracepilot").to_string_lossy().to_string();
        config.paths.session_state_dir = root
            .join("copilot/session-state")
            .to_string_lossy()
            .to_string();
        config.normalize_paths();

        assert!(config.validate_paths_within_data_root(&root).is_ok());

        config.paths.session_state_dir = dir
            .path()
            .join("real-session-state")
            .to_string_lossy()
            .to_string();
        let error = config.validate_paths_within_data_root(&root).unwrap_err();
        assert!(error.to_string().contains("must stay within"));
    }

    #[test]
    fn isolated_config_rejects_parent_traversal_even_when_prefix_matches() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("isolated");
        let mut config = TracePilotConfig::default();
        config.paths.copilot_home = root.join("copilot").to_string_lossy().to_string();
        config.paths.tracepilot_home = root.join("tracepilot").to_string_lossy().to_string();
        config.paths.session_state_dir = root
            .join("copilot/../../real-session-state")
            .to_string_lossy()
            .to_string();
        config.normalize_paths();

        assert!(config.validate_paths_within_data_root(&root).is_err());
    }
}
