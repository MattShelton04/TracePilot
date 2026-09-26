//! Live session preferences (Copilot SDK live attach, ADR-0016).

use serde::{Deserialize, Serialize};

use super::defaults::default_true;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveConfig {
    /// Attach automatically when a session view opens on a session that is
    /// running in an attachable (`--ui-server`) terminal. Each attach appends
    /// one `session.resume` event to the session's history.
    #[serde(default = "default_true")]
    pub auto_attach: bool,
    /// Start terminals that TracePilot launches or resumes with `--ui-server`
    /// so they can be attached to. Only applies while live sessions
    /// (`features.copilotSdk`) are enabled.
    #[serde(default = "default_true")]
    pub launch_attachable: bool,
}

impl Default for LiveConfig {
    fn default() -> Self {
        Self {
            auto_attach: true,
            launch_attachable: true,
        }
    }
}
