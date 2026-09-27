//! Configuration service: validation, persistence and TracePilot-home migration.
//!
//! Owns the orchestration that used to live inline in
//! `commands::config_cmds::save_config` / `factory_reset` so the command shells
//! become thin adapters. Helpers like `copy_tracepilot_home_if_moved` and
//! `validate_configured_roots` were moved here from `commands/config_paths.rs`.

use std::sync::Arc;

use tokio::sync::OwnedSemaphorePermit;

use crate::concurrency::IndexingSemaphores;
use crate::config::{
    self, ConfigCoordinator, SharedConfig, TracePilotConfig, TracePilotConfigPatch,
};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{mutex_poisoned, read_config, remove_index_db_files};

/// Service-layer alias for [`crate::helpers::remove_index_db_files`]. Speaks
/// the verb the docs/refactor brief uses; behaviour is identical.
pub(crate) fn delete_index_db_files(path: &std::path::Path) -> Result<(), BindingsError> {
    remove_index_db_files(path)
}

/// RAII pair of indexing permits held for the duration of a TracePilot-home
/// migration. Both permits must outlive the on-disk copy so reindex jobs
/// cannot race the move.
struct IndexingMovePermits {
    _sessions: OwnedSemaphorePermit,
    _search: OwnedSemaphorePermit,
}

enum ConfigMutation {
    Replace(TracePilotConfig),
    Patch(TracePilotConfigPatch),
}

pub(crate) async fn save_config(
    shared_config: &SharedConfig,
    gates: Arc<IndexingSemaphores>,
    coordinator: &ConfigCoordinator,
    config: TracePilotConfig,
) -> CmdResult<TracePilotConfig> {
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
) -> CmdResult<TracePilotConfig> {
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
) -> CmdResult<TracePilotConfig> {
    let mutation_guard = coordinator.mutation().await;
    let previous = read_config(shared_config);
    let old_tracepilot_home = previous.tracepilot_home();
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
    let new_tracepilot_home = cfg.tracepilot_home();

    let (move_permits, root_guard) = if old_tracepilot_home != new_tracepilot_home {
        let sessions = gates
            .try_acquire_sessions()
            .map_err(|_busy| BindingsError::AlreadyIndexing)?;
        let search = gates.cancel_and_acquire_search().await;
        let root = coordinator.root_write().await;
        (
            Some(IndexingMovePermits {
                _sessions: sessions,
                _search: search,
            }),
            Some(root),
        )
    } else {
        (None, None)
    };
    let config_state = Arc::clone(shared_config);
    tokio::task::spawn_blocking(move || {
        let _guards = (mutation_guard, move_permits, root_guard);
        copy_tracepilot_home_if_moved(&old_tracepilot_home, &new_tracepilot_home)?;
        persist(&cfg)?;
        let mut state = config_state.write().map_err(|_poisoned| mutex_poisoned())?;
        *state = Some(cfg.clone());
        Ok(cfg)
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
    let mutation_guard = coordinator.mutation().await;
    let root_guard = coordinator.root_write().await;
    // Never delete the database under a running indexer: wait for the session
    // job, stop any search pass, and hold both gates until files are removed.
    let sessions_permit = gates.acquire_sessions().await;
    let search_permit = gates.cancel_and_acquire_search().await;
    let cfg = read_config(shared_config);
    let index_path = cfg.index_db_path();
    let config_path = config::config_file_path();

    let config_state = Arc::clone(shared_config);
    tokio::task::spawn_blocking(move || {
        let _permits = (mutation_guard, root_guard, sessions_permit, search_permit);
        if let Err(e) = delete_index_db_files(&index_path) {
            tracing::warn!(error = %e, "factory_reset: failed to remove index DB files");
        }

        if let Some(ref path) = config_path {
            for target in [path.clone(), config::config_backup_file_path(path)] {
                match std::fs::remove_file(&target) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        tracing::warn!(
                            path = %target.display(),
                            error = %e,
                            "factory_reset: failed to remove config file"
                        );
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

pub(crate) fn copy_tracepilot_home_if_moved(
    old_root: &std::path::Path,
    new_root: &std::path::Path,
) -> Result<(), BindingsError> {
    if old_root == new_root || !old_root.exists() {
        return Ok(());
    }

    let old_paths = tracepilot_core::paths::TracePilotPaths::from_root(old_root);
    let new_paths = tracepilot_core::paths::TracePilotPaths::from_root(new_root);
    std::fs::create_dir_all(new_paths.root())?;

    copy_sqlite_db_if_absent(&old_paths.index_db(), &new_paths.index_db())?;
    copy_file_if_absent(
        &old_paths.repo_registry_json(),
        &new_paths.repo_registry_json(),
    )?;
    for (src, dst) in old_paths
        .durable_directories()
        .into_iter()
        .zip(new_paths.durable_directories())
    {
        copy_dir_contents_if_absent(&src, &dst)?;
    }
    Ok(())
}

fn copy_sqlite_db_if_absent(
    src_db: &std::path::Path,
    dst_db: &std::path::Path,
) -> Result<(), BindingsError> {
    copy_sqlite_db_if_absent_with(src_db, dst_db, copy_file_if_absent)
}

fn copy_sqlite_db_if_absent_with(
    src_db: &std::path::Path,
    dst_db: &std::path::Path,
    mut copy: impl FnMut(&std::path::Path, &std::path::Path) -> Result<(), BindingsError>,
) -> Result<(), BindingsError> {
    if !src_db.exists() {
        return Ok(());
    }
    if dst_db.exists() {
        tracing::warn!(
            src = %src_db.display(),
            dst = %dst_db.display(),
            "Skipping SQLite DB migration because destination DB already exists"
        );
        return Ok(());
    }

    // Publish the main database last: its presence is the completion marker
    // checked above. If any copy fails, the next attempt replaces sidecars
    // before publishing the database, so committed WAL data cannot be skipped.
    for (src, dst) in [
        (
            src_db.with_extension("db-wal"),
            dst_db.with_extension("db-wal"),
        ),
        (
            src_db.with_extension("db-shm"),
            dst_db.with_extension("db-shm"),
        ),
    ] {
        if src.exists() {
            if dst.exists() {
                std::fs::remove_file(&dst)?;
            }
            copy(&src, &dst)?;
        } else if dst.exists() {
            // A source checkpoint may remove a sidecar between failed attempts.
            // Never pair the current main database with that stale retry file.
            std::fs::remove_file(&dst)?;
        }
    }
    copy(src_db, dst_db)?;
    Ok(())
}

fn copy_file_if_absent(src: &std::path::Path, dst: &std::path::Path) -> Result<(), BindingsError> {
    copy_file_if_absent_with(src, dst, |source, target| {
        std::io::copy(&mut std::fs::File::open(source)?, target)?;
        Ok(())
    })
}

fn copy_file_if_absent_with(
    src: &std::path::Path,
    dst: &std::path::Path,
    copy: impl FnOnce(&std::path::Path, &mut std::fs::File) -> std::io::Result<()>,
) -> Result<(), BindingsError> {
    if !src.exists() || dst.exists() {
        return Ok(());
    }
    tracepilot_core::utils::fs::ensure_parent_dir(dst)?;
    let mut temp_path = dst.as_os_str().to_os_string();
    temp_path.push(format!(".migration-{}", uuid::Uuid::new_v4()));
    let temp_path = std::path::PathBuf::from(temp_path);
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        copy(src, &mut file)?;
        file.sync_all()?;
        drop(file);
        // Only publish a complete file. All application migrations are serialized;
        // captures hold a root lease. An interrupted worker can leave only a
        // uniquely named scratch file, never a truncated final destination.
        if !dst.exists() {
            std::fs::rename(&temp_path, dst)?;
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(temp_path);
    result.map_err(Into::into)
}

fn copy_dir_contents_if_absent(
    src: &std::path::Path,
    dst: &std::path::Path,
) -> Result<(), BindingsError> {
    if !src.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_contents_if_absent(&src_path, &dst_path)?;
        } else {
            copy_file_if_absent(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &std::path::Path, content: &str) {
        tracepilot_core::utils::fs::ensure_parent_dir(path).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn tracepilot_home_copy_copies_sqlite_db_units_when_destination_empty() {
        let dir = tempfile::tempdir().unwrap();
        let old_root = dir.path().join("old");
        let new_root = dir.path().join("new");
        let old = tracepilot_core::paths::TracePilotPaths::from_root(&old_root);
        let new = tracepilot_core::paths::TracePilotPaths::from_root(&new_root);

        write(&old.index_db(), "main");
        write(&old.index_db().with_extension("db-wal"), "wal");
        write(&old.index_db().with_extension("db-shm"), "shm");

        copy_tracepilot_home_if_moved(&old_root, &new_root).unwrap();

        assert_eq!(std::fs::read_to_string(new.index_db()).unwrap(), "main");
        assert_eq!(
            std::fs::read_to_string(new.index_db().with_extension("db-wal")).unwrap(),
            "wal"
        );
        assert_eq!(
            std::fs::read_to_string(new.index_db().with_extension("db-shm")).unwrap(),
            "shm"
        );
    }

    #[test]
    fn tracepilot_home_copy_skips_sqlite_sidecars_when_destination_db_exists() {
        let dir = tempfile::tempdir().unwrap();
        let old_root = dir.path().join("old");
        let new_root = dir.path().join("new");
        let old = tracepilot_core::paths::TracePilotPaths::from_root(&old_root);
        let new = tracepilot_core::paths::TracePilotPaths::from_root(&new_root);

        write(&old.index_db(), "old-main");
        write(&old.index_db().with_extension("db-wal"), "old-wal");
        write(&old.index_db().with_extension("db-shm"), "old-shm");
        write(&new.index_db(), "new-main");

        copy_tracepilot_home_if_moved(&old_root, &new_root).unwrap();

        assert_eq!(std::fs::read_to_string(new.index_db()).unwrap(), "new-main");
        assert!(!new.index_db().with_extension("db-wal").exists());
        assert!(!new.index_db().with_extension("db-shm").exists());
    }

    #[test]
    fn tracepilot_home_copy_same_path_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("tracepilot");
        let paths = tracepilot_core::paths::TracePilotPaths::from_root(&root);
        write(&paths.index_db(), "main");

        copy_tracepilot_home_if_moved(&root, &root).unwrap();

        assert_eq!(std::fs::read_to_string(paths.index_db()).unwrap(), "main");
    }

    #[test]
    fn tracepilot_home_copy_merges_directories_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let old_root = dir.path().join("old");
        let new_root = dir.path().join("new");
        let old = tracepilot_core::paths::TracePilotPaths::from_root(&old_root);
        let new = tracepilot_core::paths::TracePilotPaths::from_root(&new_root);

        write(&old.templates_dir().join("existing.json"), "old-existing");
        write(&old.templates_dir().join("new.json"), "old-new");
        write(&new.templates_dir().join("existing.json"), "new-existing");

        copy_tracepilot_home_if_moved(&old_root, &new_root).unwrap();

        assert_eq!(
            std::fs::read_to_string(new.templates_dir().join("existing.json")).unwrap(),
            "new-existing"
        );
        assert_eq!(
            std::fs::read_to_string(new.templates_dir().join("new.json")).unwrap(),
            "old-new"
        );
    }

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
