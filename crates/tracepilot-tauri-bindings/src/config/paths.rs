//! File-system path locations used by TracePilot.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsConfig {
    #[serde(default)]
    pub copilot_home: String,
    #[serde(default)]
    pub tracepilot_home: String,
    #[serde(default)]
    pub session_state_dir: String,
    /// Compatibility field for older frontends/config files. New writes keep
    /// this synchronized to `{tracepilotHome}/index.db`; users choose the
    /// TracePilot home directory, not this file path directly.
    #[serde(default)]
    pub index_db_path: String,
}
