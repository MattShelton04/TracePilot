//! A scheduled indexing pass belongs to the configuration that created it.
use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::providers::registry_for;
use std::path::PathBuf;
use tracepilot_indexer::IndexScope;

/// The configuration a pass indexes: the provider registry built from it and
/// each source's configuration generation, captured together.
#[derive(Clone)]
pub(super) struct IndexTarget {
    state: SharedConfig,
    pub generation: u64,
    session_state_dir: PathBuf,
    pub index_path: PathBuf,
    pub scope: IndexScope,
}

impl IndexTarget {
    /// Call after acquiring the relevant indexing permit, with the generation
    /// captured before waiting. Never synthesize default config after reset.
    pub fn capture(
        state: &SharedConfig,
        gates: &IndexingSemaphores,
        generation: u64,
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
        let scope = IndexScope::new(
            registry_for(config),
            gates.jobs().source_generations().clone(),
        );
        Ok(Self {
            state: state.clone(),
            generation,
            session_state_dir: config.session_state_dir(),
            index_path: config.index_db_path(),
            scope,
        })
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
    use crate::config::TracePilotConfig;
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
}
