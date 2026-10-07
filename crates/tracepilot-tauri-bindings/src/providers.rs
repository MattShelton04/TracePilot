//! The session providers a configuration enables.

use std::sync::Arc;

use tracepilot_core::provider::{CopilotProvider, ProviderRegistry};

use crate::config::TracePilotConfig;

/// The registry for `config`. Copilot is always registered; other sources
/// join it once their experimental flag exists (F8).
pub fn registry_for(config: &TracePilotConfig) -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::new(CopilotProvider::new(config.session_state_dir())));
    registry
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracepilot_core::provider::SessionSource;

    #[test]
    fn registers_only_copilot_at_the_configured_root() {
        let mut config = TracePilotConfig::default();
        config.paths.session_state_dir = "C:\\sessions".into();
        let registry = registry_for(&config);
        let sources: Vec<_> = registry.providers().iter().map(|p| p.source()).collect();
        assert_eq!(sources, [SessionSource::Copilot]);
        assert!(registry.get(SessionSource::ClaudeCode).is_none());
    }
}
