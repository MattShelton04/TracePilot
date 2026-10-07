//! A scheduled indexing pass belongs to the configuration that created it.
use crate::concurrency::IndexingSemaphores;
use crate::config::{SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::providers::{registry_for, registry_for_source};
use std::path::PathBuf;
use tracepilot_core::provider::{ProviderRegistry, SessionSource};
use tracepilot_indexer::IndexScope;
use tracepilot_indexer::index_db::IndexDb;

/// The configuration a pass indexes: the provider registry built from it and
/// each source's configuration generation, captured together.
#[derive(Clone)]
pub(super) struct IndexTarget {
    state: SharedConfig,
    pub generation: u64,
    session_state_dir: PathBuf,
    pub index_path: PathBuf,
    pub scope: IndexScope,
    /// Every source the configuration enables, even when `scope` covers one.
    enabled: Vec<SessionSource>,
}

impl IndexTarget {
    /// Call after acquiring the relevant indexing permit, with the generation
    /// captured before waiting. Never synthesize default config after reset.
    pub fn capture(
        state: &SharedConfig,
        gates: &IndexingSemaphores,
        generation: u64,
    ) -> CmdResult<Self> {
        Self::capture_with(state, gates, generation, registry_for)
    }

    /// This job's target re-read from the current configuration, so a rerun
    /// covers a source enabled or moved since the first capture.
    pub fn refreshed(&self, gates: &IndexingSemaphores) -> CmdResult<Self> {
        Self::capture(&self.state, gates, self.generation)
    }

    /// [`Self::capture`], with a scope limited to `source`.
    pub fn capture_source(
        state: &SharedConfig,
        gates: &IndexingSemaphores,
        generation: u64,
        source: SessionSource,
    ) -> CmdResult<Self> {
        Self::capture_with(state, gates, generation, |config| {
            registry_for_source(config, source)
        })
    }

    fn capture_with(
        state: &SharedConfig,
        gates: &IndexingSemaphores,
        generation: u64,
        registry: impl FnOnce(&TracePilotConfig) -> ProviderRegistry,
    ) -> CmdResult<Self> {
        if gates.jobs().generation() != generation {
            return Err(BindingsError::Validation(
                "Indexing configuration changed; retry after setup.".into(),
            ));
        }
        let guard = state.read().unwrap_or_else(|p| p.into_inner());
        let config = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("Complete setup before indexing.".into()))?;
        // Under the config lock, so a source change cannot land between the
        // registry and the generations it is checked against.
        let scope = IndexScope::new(registry(config), gates.jobs().source_generations().clone());
        let enabled = registry_for(config)
            .providers()
            .iter()
            .map(|provider| provider.source())
            .collect();
        Ok(Self {
            state: state.clone(),
            generation,
            session_state_dir: config.session_state_dir(),
            index_path: config.index_db_path(),
            scope,
            enabled,
        })
    }

    /// Delete the rows of every source this configuration disables. Disabling
    /// a source purges it already; this repairs a purge that failed or was
    /// interrupted. A source enabled since the capture is left alone.
    pub fn purge_disabled_sources(&self) {
        let disabled: Vec<_> = SessionSource::ALL
            .into_iter()
            .filter(|source| !self.enabled.contains(source))
            .collect();
        if disabled.is_empty() || !self.index_path.exists() {
            return;
        }
        let db = match IndexDb::open_or_create(&self.index_path) {
            Ok(db) => db,
            Err(error) => {
                tracing::warn!(error = %error, "Could not open the index to purge sources");
                return;
            }
        };
        for source in disabled {
            match db.purge_source(source, &|| self.scope.is_current(source)) {
                Ok(0) => {}
                Ok(purged) => tracing::info!(
                    source = source.as_str(),
                    purged,
                    "Purged sessions of a disabled source"
                ),
                Err(error) => tracing::debug!(
                    source = source.as_str(),
                    error = %error,
                    "Disabled source not purged this pass"
                ),
            }
        }
    }

    /// Recheck after acquiring the search permit. Reset and relocation own
    /// both permits, so a valid target remains valid until that permit drops.
    pub fn is_current(&self, gates: &IndexingSemaphores) -> bool {
        if gates.jobs().generation() != self.generation {
            return false;
        }
        self.state
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .is_some_and(|config| {
                config.session_state_dir() == self.session_state_dir
                    && config.index_db_path() == self.index_path
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, RwLock};

    #[tokio::test]
    async fn late_phase_two_and_queued_reindex_cannot_recreate_a_reset_database() {
        let temp = tempfile::tempdir().unwrap();
        let mut config = TracePilotConfig::default();
        config.paths.tracepilot_home = temp.path().to_string_lossy().into_owned();
        config.paths.session_state_dir =
            temp.path().join("sessions").to_string_lossy().into_owned();
        let state = Arc::new(RwLock::new(Some(config.clone())));
        let gates = IndexingSemaphores::new();
        let generation = gates.jobs().generation();
        let phase_one = gates.acquire_sessions().await;
        let target = IndexTarget::capture(&state, &gates, generation).unwrap();
        std::fs::write(&target.index_path, b"old index").unwrap();
        drop(phase_one);

        // Reset wins the gap between phase one and its async continuation.
        let reset_sessions = gates.acquire_sessions().await;
        let reset_search = gates.cancel_and_acquire_search().await;
        gates.jobs().invalidate();
        *state.write().unwrap() = None;
        std::fs::remove_file(&target.index_path).unwrap();
        drop((reset_sessions, reset_search));
        let late_search = gates.try_acquire_search().unwrap();
        assert!(!target.is_current(&gates));
        assert!(IndexTarget::capture(&state, &gates, gates.jobs().generation()).is_err());
        assert!(!target.index_path.exists());
        drop(late_search);

        // Even setup at identical paths cannot resurrect pre-reset work.
        *state.write().unwrap() = Some(config);
        let _sessions = gates.acquire_sessions().await;
        assert!(IndexTarget::capture(&state, &gates, generation).is_err());
        assert!(!target.is_current(&gates));
        let fresh = IndexTarget::capture(&state, &gates, gates.jobs().generation()).unwrap();
        assert!(fresh.is_current(&gates));
    }

    #[test]
    fn a_refreshed_target_covers_a_source_enabled_after_capture() {
        let temp = tempfile::tempdir().unwrap();
        let mut config = TracePilotConfig::default();
        config.paths.tracepilot_home = temp.path().to_string_lossy().into_owned();
        config.sources.claude_code.config_dir =
            temp.path().join("claude").to_string_lossy().into_owned();
        config.normalize_paths();
        let state = Arc::new(RwLock::new(Some(config)));
        let gates = IndexingSemaphores::new();
        let target = IndexTarget::capture(&state, &gates, gates.jobs().generation()).unwrap();
        assert!(!target.enabled.contains(&SessionSource::ClaudeCode));

        state
            .write()
            .unwrap()
            .as_mut()
            .unwrap()
            .features
            .claude_code_sessions = true;
        gates
            .jobs()
            .source_generations()
            .bump(SessionSource::ClaudeCode);
        assert!(!target.scope.is_current(SessionSource::ClaudeCode));

        let refreshed = target.refreshed(&gates).unwrap();
        assert!(refreshed.enabled.contains(&SessionSource::ClaudeCode));
        assert!(refreshed.scope.is_current(SessionSource::ClaudeCode));
    }

    #[tokio::test]
    async fn a_full_pass_sweeps_rows_of_disabled_sources_only() {
        let temp = tempfile::tempdir().unwrap();
        let mut config = TracePilotConfig::default();
        config.paths.tracepilot_home = temp.path().to_string_lossy().into_owned();
        config.paths.session_state_dir =
            temp.path().join("sessions").to_string_lossy().into_owned();
        config.normalize_paths();
        let index = config.index_db_path();
        IndexDb::open_or_create(&index).unwrap();
        let conn = rusqlite::Connection::open(&index).unwrap();
        for (id, source) in [("copilot-1", "copilot"), ("claude-1", "claudeCode")] {
            conn.execute(
                "INSERT INTO sessions (id, path, source) VALUES (?1, ?1, ?2)",
                [id, source],
            )
            .unwrap();
        }
        let count = |source: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM sessions WHERE source = ?1",
                [source],
                |row| row.get(0),
            )
            .unwrap()
        };
        let state = Arc::new(RwLock::new(Some(config.clone())));
        let gates = IndexingSemaphores::new();

        // Claude Code is re-enabled after this pass captured its target:
        // the pass must not delete what the new configuration owns.
        let stale = IndexTarget::capture(&state, &gates, gates.jobs().generation()).unwrap();
        gates
            .jobs()
            .source_generations()
            .bump(SessionSource::ClaudeCode);
        stale.purge_disabled_sources();
        assert_eq!(count("claudeCode"), 1);

        let target = IndexTarget::capture(&state, &gates, gates.jobs().generation()).unwrap();
        let claude_only = IndexTarget::capture_source(
            &state,
            &gates,
            gates.jobs().generation(),
            SessionSource::ClaudeCode,
        )
        .unwrap();
        assert!(claude_only.scope.registry().providers().is_empty());
        target.purge_disabled_sources();
        assert_eq!(count("claudeCode"), 0);
        assert_eq!(count("copilot"), 1);

        // While enabled, a target never sweeps it.
        conn.execute(
            "INSERT INTO sessions (id, path, source) VALUES ('claude-2', 'p', 'claudeCode')",
            [],
        )
        .unwrap();
        config.features.claude_code_sessions = true;
        *state.write().unwrap() = Some(config);
        IndexTarget::capture(&state, &gates, gates.jobs().generation())
            .unwrap()
            .purge_disabled_sources();
        assert_eq!(count("claudeCode"), 1);
    }
}
