//! Connection identity shared by the runtime lifecycle methods.
use super::BridgeManager;
use super::sdk_client::requested_connection_mode;
use crate::bridge::BridgeConnectConfig;

impl BridgeManager {
    pub(super) fn is_same_connection_config(&self, config: &BridgeConnectConfig) -> bool {
        self.connection_mode == Some(requested_connection_mode(config))
            && self.cli_url.as_deref() == config.cli_url.as_deref()
            && self.connection_cwd.as_deref() == config.cwd.as_deref()
    }
}
