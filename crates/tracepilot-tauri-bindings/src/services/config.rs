//! Configuration service: validation, persistence and TracePilot-home migration.
//!
//! Owns the orchestration that used to live inline in
//! `commands::config_cmds::save_config` / `factory_reset` so the command shells
//! become thin adapters. Copying a moved TracePilot home lives in
//! [`super::config_home`].

use std::sync::Arc;

use tokio::sync::OwnedSemaphorePermit;

use crate::concurrency::IndexingSemaphores;
use crate::config::{
    self, ConfigCoordinator, SharedConfig, TracePilotConfig, TracePilotConfigPatch,
};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{mutex_poisoned, read_config, remove_index_db_files};
use crate::services::config_home::copy_tracepilot_home_if_moved;
#[cfg(test)]
use crate::services::config_home::{
    copy_file_if_absent, copy_file_if_absent_with, copy_sqlite_db_if_absent,
    copy_sqlite_db_if_absent_with,
};
use crate::services::source_change::SourceChanges;

/// Remove index database files through the shared filesystem helper.
pub(crate) fn delete_index_db_files(path: &std::path::Path) -> Result<(), BindingsError> {
    remove_index_db_files(path)
}

/// Hold both indexing permits until a changed source or database path is
/// published, including any on-disk migration of the data root.
struct IndexingChangePermits {
    _sessions: OwnedSemaphorePermit,
    _search: OwnedSemaphorePermit,
}

enum ConfigMutation {
    Replace(TracePilotConfig),
    Patch(TracePilotConfigPatch),
}

/// A published configuration and what it did to the optional sources.
pub(crate) struct SavedConfig {
    pub config: TracePilotConfig,
    pub sources: SourceChanges,
}

pub(crate) async fn save_config(
    shared_config: &SharedConfig,
    gates: Arc<IndexingSemaphores>,
    coordinator: &ConfigCoordinator,
    config: TracePilotConfig,
) -> CmdResult<SavedConfig> {
    mutate_config(
        shared_config,
        gates,
        coordinator,
        ConfigMutation::Replace(config),
        TracePilotConfig::save,
    )
    .await
}

pub(crate) async fn update_config(
    shared_config: &SharedConfig,
    gates: Arc<IndexingSemaphores>,
    coordinator: &ConfigCoordinator,
    patch: TracePilotConfigPatch,
) -> CmdResult<SavedConfig> {
    mutate_config(
        shared_config,
        gates,
        coordinator,
        ConfigMutation::Patch(patch),
        TracePilotConfig::save,
    )
    .await
}

// The ordering guard survives cancellation of the IPC future: once filesystem
// work starts, that worker retains both mutation and relocation ownership until
// disk and in-memory state agree. Patches merge only after acquiring the guard.
async fn mutate_config(
    shared_config: &SharedConfig,
    gates: Arc<IndexingSemaphores>,
    coordinator: &ConfigCoordinator,
    mutation: ConfigMutation,
    persist: impl FnOnce(&TracePilotConfig) -> CmdResult<()> + Send + 'static,
) -> CmdResult<SavedConfig> {
    let mutation_guard = coordinator.mutation().await;
    let loaded = shared_config
        .read()
        .map_err(|_poisoned| mutex_poisoned())?
        .clone();
    // A preference write queued behind factory reset belongs to the previous
    // configuration. Only an explicit setup save may create a new one.
    if matches!(&mutation, ConfigMutation::Patch(_)) && loaded.is_none() {
        return Err(BindingsError::Validation(
            "TracePilot is not configured. Complete setup before updating preferences.".into(),
        ));
    }
    // Missing config (first run or reset) has no previous root to migrate.
    let old_tracepilot_home = loaded.as_ref().map(TracePilotConfig::tracepilot_home);
    let old_index_paths = loaded
        .as_ref()
        .map(|config| (config.session_state_dir(), config.index_db_path()));
    let loaded_config = loaded.clone();
    let previous = loaded.unwrap_or_default();
    let mut cfg = match mutation {
        ConfigMutation::Replace(config) => config,
        ConfigMutation::Patch(patch) => {
            let mut config = previous;
            patch.apply(&mut config);
            config
        }
    };
    cfg.normalize_paths();
    validate_configured_roots(&cfg)?;
    let sources = SourceChanges::between(loaded_config.as_ref(), &cfg);
    let new_tracepilot_home = cfg.tracepilot_home();

    let root_moved = old_tracepilot_home
        .as_ref()
        .is_some_and(|old| old != &new_tracepilot_home);
    let index_paths_changed =
        old_index_paths.is_some_and(|old| old != (cfg.session_state_dir(), cfg.index_db_path()));
    let (index_permits, root_guard) = if index_paths_changed {
        let sessions = gates
            .try_acquire_sessions()
            .map_err(|_busy| BindingsError::AlreadyIndexing)?;
        let search = gates.cancel_and_acquire_search().await;
        let root = if root_moved {
            Some(coordinator.root_write().await)
        } else {
            None
        };
        gates.jobs().invalidate();
        (
            Some(IndexingChangePermits {
                _sessions: sessions,
                _search: search,
            }),
            root,
        )
    } else {
        (None, None)
    };
    let config_state = Arc::clone(shared_config);
    let generations = Arc::clone(gates.jobs().source_generations());
    tokio::task::spawn_blocking(move || {
        let _guards = (mutation_guard, index_permits, root_guard);
        if let Some(old_root) = old_tracepilot_home {
            copy_tracepilot_home_if_moved(&old_root, &new_tracepilot_home)?;
        }
        persist(&cfg)?;
        {
            let mut state = config_state.write().map_err(|_poisoned| mutex_poisoned())?;
            *state = Some(cfg.clone());
            // Under the lock passes capture their registry under, so none
            // can pair the new configuration with an old generation.
            sources.bump(&generations);
        }
        sources.purge(&cfg.index_db_path());
        Ok(SavedConfig {
            config: cfg,
            sources,
        })
    })
    .await?
}

/// Orchestrate `factory_reset`: remove index DB files and the config file on a
/// blocking worker, then clear the in-memory `SharedConfig`.
pub(crate) async fn factory_reset(
    shared_config: &SharedConfig,
    gates: &IndexingSemaphores,
    coordinator: &ConfigCoordinator,
) -> CmdResult<()> {
    factory_reset_at(
        shared_config,
        gates,
        coordinator,
        config::config_file_path(),
    )
    .await
}

async fn factory_reset_at(
    shared_config: &SharedConfig,
    gates: &IndexingSemaphores,
    coordinator: &ConfigCoordinator,
    config_path: Option<std::path::PathBuf>,
) -> CmdResult<()> {
    let mutation_guard = coordinator.mutation().await;
    let root_guard = coordinator.root_write().await;
    // Never delete the database under a running indexer: wait for the session
    // job, stop any search pass, and hold both gates until files are removed.
    let sessions_permit = gates.acquire_sessions().await;
    let search_permit = gates.cancel_and_acquire_search().await;
    gates.jobs().invalidate();
    let cfg = read_config(shared_config);
    let index_path = cfg.index_db_path();

    let config_state = Arc::clone(shared_config);
    tokio::task::spawn_blocking(move || {
        let _permits = (mutation_guard, root_guard, sessions_permit, search_permit);
        delete_index_db_files(&index_path)?;

        if let Some(ref path) = config_path {
            // Keep the main config available if removing its backup fails.
            for target in [config::config_backup_file_path(path), path.clone()] {
                match std::fs::remove_file(&target) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        tracing::warn!(
                            path = %target.display(),
                            error = %e,
                            "factory_reset: failed to remove config file"
                        );
                        return Err(e.into());
                    }
                }
            }
        }
        let mut guard = config_state.write().map_err(|_poisoned| mutex_poisoned())?;
        *guard = None;
        Ok::<(), BindingsError>(())
    })
    .await??;
    Ok(())
}

pub(crate) fn validate_configured_roots(config: &TracePilotConfig) -> Result<(), BindingsError> {
    config.validate_isolation_boundary()?;
    validate_absolute_path("Copilot home", &config.copilot_home())?;
    validate_absolute_path("TracePilot data directory", &config.tracepilot_home())?;
    let tracepilot_home = config.tracepilot_home();
    if tracepilot_home.exists() {
        if !tracepilot_home.is_dir() {
            return Err(BindingsError::Validation(format!(
                "TracePilot data directory is not a directory: {}",
                tracepilot_home.display()
            )));
        }
    } else {
        let parent = tracepilot_home.parent().ok_or_else(|| {
            BindingsError::Validation("TracePilot data directory has no parent".into())
        })?;
        if !parent.is_dir() {
            return Err(BindingsError::Validation(format!(
                "TracePilot data directory parent does not exist: {}",
                parent.display()
            )));
        }
    }
    Ok(())
}

fn validate_absolute_path(label: &str, path: &std::path::Path) -> Result<(), BindingsError> {
    if path.as_os_str().is_empty() {
        return Err(BindingsError::Validation(format!(
            "{label} must not be empty"
        )));
    }
    if !path.is_absolute() {
        return Err(BindingsError::Validation(format!(
            "{label} must be an absolute path: {}",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delete_index_db_files_alias_resolves() {
        // The alias `delete_index_db_files` must point at the same function as
        // `helpers::remove_index_db_files` (it's a 1-call wrapper); construct
        // function-pointers and ensure they stay in lockstep.
        let alias: fn(&std::path::Path) -> Result<(), BindingsError> = delete_index_db_files;
        let original: fn(&std::path::Path) -> Result<(), BindingsError> = remove_index_db_files;
        // They are different fn items but must produce the same `Ok(())` for a
        // missing path.
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist.db");
        assert!(alias(&missing).is_ok());
        assert!(original(&missing).is_ok());
    }
}

#[cfg(test)]
#[path = "config_mutation_tests.rs"]
mod mutation_tests;

#[cfg(test)]
#[path = "source_change_tests.rs"]
mod source_change_tests;
