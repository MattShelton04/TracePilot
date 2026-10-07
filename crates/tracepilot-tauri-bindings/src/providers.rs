//! The session providers the app reads from, built from config.

use std::sync::Arc;

use tracepilot_core::provider::{CopilotProvider, ProviderRegistry};

use crate::config::TracePilotConfig;

/// The enabled providers for `config`. Copilot only until Claude Code is
/// registered behind its feature flag (F8).
pub(crate) fn registry_for(config: &TracePilotConfig) -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();
    registry.register(Arc::new(CopilotProvider::new(config.session_state_dir())));
    registry
}
