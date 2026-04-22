//! File-system path locations used by TracePilot.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsConfig {
    pub session_state_dir: String,
    pub index_db_path: String,
}
