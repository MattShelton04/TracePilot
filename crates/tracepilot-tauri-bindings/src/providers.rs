//! The session providers the app reads from, built from config.

use std::path::PathBuf;
use std::sync::Arc;

use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{CopilotProvider, ProviderRegistry, SessionSource};

use crate::config::TracePilotConfig;

/// The enabled providers for `config`: Copilot always, Claude Code while its
/// experimental flag is on.
pub(crate) fn registry_for(config: &TracePilotConfig) -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::new(CopilotProvider::new(config.session_state_dir())));
    if let Some(root) = claude_code_root(config) {
        registry.register(Arc::new(ClaudeCodeProvider::new(root).with_process_start(
            Arc::new(tracepilot_orchestrator::process::process_start_time),
        )));
    }
    registry
}

/// `registry_for`, limited to `source`.
pub(crate) fn registry_for_source(
    config: &TracePilotConfig,
    source: SessionSource,
) -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();
    if let Some(provider) = registry_for(config).get(source) {
        registry.register(Arc::clone(provider));
    }
    registry
}

/// Claude Code's root while its source is enabled.
pub(crate) fn claude_code_root(config: &TracePilotConfig) -> Option<PathBuf> {
    config
        .features
        .claude_code_sessions
        .then(|| config.claude_config_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(config: &TracePilotConfig) -> Vec<SessionSource> {
        registry_for(config)
            .providers()
            .iter()
            .map(|provider| provider.source())
            .collect()
    }

    #[test]
    fn claude_code_is_registered_only_while_its_flag_is_on() {
        let mut config = TracePilotConfig::default();
        assert_eq!(sources(&config), [SessionSource::Copilot]);

        config.features.claude_code_sessions = true;
        assert_eq!(
            sources(&config),
            [SessionSource::Copilot, SessionSource::ClaudeCode]
        );
        let only = registry_for_source(&config, SessionSource::ClaudeCode);
        assert_eq!(only.providers().len(), 1);
        assert_eq!(only.providers()[0].source(), SessionSource::ClaudeCode);
    }
}
