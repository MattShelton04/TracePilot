//! Central registry for well-known on-disk locations.
//!
//! This module owns product path *shapes* only. User-configurable paths stored in
//! `config.toml` remain authoritative at call sites that already receive config.

use std::path::{Path, PathBuf};

pub const COPILOT_DIR_NAME: &str = ".copilot";
pub const TRACEPILOT_DIR_NAME: &str = "tracepilot";
pub const SESSION_STATE_DIR_NAME: &str = "session-state";
pub const SKILLS_DIR_NAME: &str = "skills";
pub const GITHUB_DIR_NAME: &str = ".github";

pub const COPILOT_SETTINGS_FILE: &str = "settings.json";
pub const COPILOT_CONFIG_FILE: &str = "config.json";
pub const COPILOT_MCP_CONFIG_FILE: &str = "mcp-config.json";

pub const TRACEPILOT_CONFIG_FILE: &str = "config.toml";
pub const TRACEPILOT_INDEX_DB_FILE: &str = "index.db";
pub const TRACEPILOT_REPO_REGISTRY_FILE: &str = "repo-registry.json";
pub const TRACEPILOT_TEMPLATES_DIR: &str = "templates";
pub const TRACEPILOT_BACKUPS_DIR: &str = "backups";
pub const TRACEPILOT_AGENT_BACKUPS_DIR: &str = "agents";
pub const TRACEPILOT_DATABASE_BACKUPS_DIR: &str = "database";

pub const COPILOT_PKG_DIR: &str = "pkg";
pub const COPILOT_UNIVERSAL_DIR: &str = "universal";
pub const COPILOT_DEFINITIONS_DIR: &str = "definitions";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopilotPaths {
    home: PathBuf,
}

impl CopilotPaths {
    pub fn from_home(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }

    pub fn from_user_home(home: impl AsRef<Path>) -> Self {
        Self::from_home(home.as_ref().join(COPILOT_DIR_NAME))
    }

    pub fn default() -> Option<Self> {
        crate::utils::home_dir_opt().map(Self::from_user_home)
    }

    pub fn home(&self) -> &Path {
        &self.home
    }

    pub fn settings_json(&self) -> PathBuf {
        self.home.join(COPILOT_SETTINGS_FILE)
    }

    pub fn config_json(&self) -> PathBuf {
        self.home.join(COPILOT_CONFIG_FILE)
    }

    pub fn mcp_config_json(&self) -> PathBuf {
        self.home.join(COPILOT_MCP_CONFIG_FILE)
    }

    pub fn session_state_dir(&self) -> PathBuf {
        self.home.join(SESSION_STATE_DIR_NAME)
    }

    pub fn global_skills_dir(&self) -> PathBuf {
        self.home.join(SKILLS_DIR_NAME)
    }

    pub fn pkg_universal_dir(&self) -> PathBuf {
        self.home.join(COPILOT_PKG_DIR).join(COPILOT_UNIVERSAL_DIR)
    }

    pub fn version_dir(&self, version: &str) -> PathBuf {
        self.pkg_universal_dir().join(version)
    }

    pub fn tracepilot(&self) -> TracePilotPaths {
        TracePilotPaths::from_root(self.home.join(TRACEPILOT_DIR_NAME))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TracePilotPaths {
    root: PathBuf,
}

impl TracePilotPaths {
    pub fn from_root(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn from_copilot_home(copilot_home: impl AsRef<Path>) -> Self {
        Self::from_root(copilot_home.as_ref().join(TRACEPILOT_DIR_NAME))
    }

    pub fn default() -> Option<Self> {
        CopilotPaths::default().map(|p| p.tracepilot())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn config_toml(&self) -> PathBuf {
        self.root.join(TRACEPILOT_CONFIG_FILE)
    }

    pub fn index_db(&self) -> PathBuf {
        self.root.join(TRACEPILOT_INDEX_DB_FILE)
    }

    pub fn repo_registry_json(&self) -> PathBuf {
        self.root.join(TRACEPILOT_REPO_REGISTRY_FILE)
    }

    pub fn templates_dir(&self) -> PathBuf {
        self.root.join(TRACEPILOT_TEMPLATES_DIR)
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.root.join(TRACEPILOT_BACKUPS_DIR)
    }

    pub fn agent_backups_dir(&self) -> PathBuf {
        self.backups_dir().join(TRACEPILOT_AGENT_BACKUPS_DIR)
    }

    pub fn database_backups_dir(&self) -> PathBuf {
        self.backups_dir().join(TRACEPILOT_DATABASE_BACKUPS_DIR)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoPaths {
    root: PathBuf,
}

impl RepoPaths {
    pub fn from_root(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn copilot_dir(&self) -> PathBuf {
        self.root.join(COPILOT_DIR_NAME)
    }

    pub fn github_dir(&self) -> PathBuf {
        self.root.join(GITHUB_DIR_NAME)
    }

    pub fn copilot_skills_dir(&self) -> PathBuf {
        self.copilot_dir().join(SKILLS_DIR_NAME)
    }

    pub fn github_skills_dir(&self) -> PathBuf {
        self.github_dir().join(SKILLS_DIR_NAME)
    }
}

pub fn default_copilot_home() -> PathBuf {
    CopilotPaths::from_user_home(crate::utils::home_dir())
        .home()
        .to_path_buf()
}

pub fn default_copilot_home_opt() -> Option<PathBuf> {
    CopilotPaths::default().map(|p| p.home().to_path_buf())
}

pub fn default_session_state_dir() -> PathBuf {
    CopilotPaths::from_user_home(crate::utils::home_dir()).session_state_dir()
}

pub fn default_tracepilot_root() -> PathBuf {
    CopilotPaths::from_user_home(crate::utils::home_dir())
        .tracepilot()
        .root()
        .to_path_buf()
}

pub fn default_index_db_path() -> PathBuf {
    CopilotPaths::from_user_home(crate::utils::home_dir())
        .tracepilot()
        .index_db()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copilot_paths_are_derived_from_home() {
        let paths = CopilotPaths::from_user_home(Path::new("/home/alice"));
        assert_eq!(paths.home(), Path::new("/home/alice/.copilot"));
        assert_eq!(
            paths.session_state_dir(),
            Path::new("/home/alice/.copilot/session-state")
        );
        assert_eq!(
            paths.mcp_config_json(),
            Path::new("/home/alice/.copilot/mcp-config.json")
        );
    }

    #[test]
    fn tracepilot_paths_are_derived_from_copilot_home() {
        let paths = TracePilotPaths::from_copilot_home(Path::new("/home/alice/.copilot"));
        assert_eq!(paths.root(), Path::new("/home/alice/.copilot/tracepilot"));
        assert_eq!(
            paths.config_toml(),
            Path::new("/home/alice/.copilot/tracepilot/config.toml")
        );
        assert_eq!(
            paths.agent_backups_dir(),
            Path::new("/home/alice/.copilot/tracepilot/backups/agents")
        );
    }

    #[test]
    fn repo_paths_cover_supported_skill_roots() {
        let paths = RepoPaths::from_root(Path::new("/repo"));
        assert_eq!(
            paths.copilot_skills_dir(),
            Path::new("/repo/.copilot/skills")
        );
        assert_eq!(paths.github_skills_dir(), Path::new("/repo/.github/skills"));
    }
}
