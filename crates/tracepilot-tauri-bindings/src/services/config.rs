//! Configuration service: validation, persistence and TracePilot-home migration.
//!
//! Owns the orchestration that used to live inline in
//! `commands::config_cmds::save_config` / `factory_reset` so the command shells
//! become thin adapters. Helpers like `copy_tracepilot_home_if_moved` and
//! `validate_configured_roots` were moved here from `commands/config_paths.rs`.

use std::sync::Arc;

use tokio::sync::OwnedSemaphorePermit;

use crate::concurrency::IndexingSemaphores;
use crate::config::{self, SharedConfig, TracePilotConfig};
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

/// Orchestrate `save_config`:
///
/// 1. Read the previous on-disk `tracepilot_home`.
/// 2. Normalise the incoming config and validate configured roots.
/// 3. If `tracepilot_home` changed, acquire the sessions + search indexing
///    permits up-front so we fail fast (`AlreadyIndexing`) instead of starting
///    a half-done migration.
/// 4. On a blocking worker, hold the permits, copy the old home into the new
///    home, save the config to disk, and only then publish the new in-memory
///    `SharedConfig`.
///
/// The blocking closure owns the permits via [`IndexingMovePermits`] so the
/// invariant "hold both permits until the copy completes" is encoded in a type
/// rather than relying on `let _ = …` bindings (which drop immediately).
///
/// Cancellation: even if the `tauri::command` future is dropped, the
/// `spawn_blocking` task continues to completion, so the migration cannot be
/// left half-done.
pub(crate) async fn save_config(
    shared_config: &SharedConfig,
    gates: Arc<IndexingSemaphores>,
    config: TracePilotConfig,
) -> CmdResult<()> {
    let old_tracepilot_home = read_config(shared_config).tracepilot_home();
    let mut cfg = config;
    cfg.normalize_paths();
    validate_configured_roots(&cfg)?;
    let new_tracepilot_home = cfg.tracepilot_home();

    let move_permits = if old_tracepilot_home != new_tracepilot_home {
        let sessions = gates
            .try_acquire_sessions()
            .map_err(|_| BindingsError::AlreadyIndexing)?;
        let search = gates
            .try_acquire_search()
            .map_err(|_| BindingsError::AlreadyIndexing)?;
        Some(IndexingMovePermits {
            _sessions: sessions,
            _search: search,
        })
    } else {
        None
    };

    let cfg_for_disk = cfg.clone();
    let cfg_for_state = cfg;
    let config_state = Arc::clone(shared_config);

    tokio::task::spawn_blocking(move || {
        let _move_permits = move_permits;
        copy_tracepilot_home_if_moved(&old_tracepilot_home, &new_tracepilot_home)?;
        cfg_for_disk.save()?;

        let mut config_guard = config_state.write().map_err(|_| mutex_poisoned())?;
        *config_guard = Some(cfg_for_state);
        Ok::<_, BindingsError>(())
    })
    .await??;
    Ok(())
}

/// Orchestrate `factory_reset`: remove index DB files and the config file on a
/// blocking worker, then clear the in-memory `SharedConfig`.
pub(crate) async fn factory_reset(shared_config: &SharedConfig) -> CmdResult<()> {
    let cfg = read_config(shared_config);
    let index_path = cfg.index_db_path();
    let config_path = config::config_file_path();

    tokio::task::spawn_blocking(move || {
        if let Err(e) = delete_index_db_files(&index_path) {
            tracing::warn!(error = %e, "factory_reset: failed to remove index DB files");
        }

        if let Some(ref path) = config_path {
            match std::fs::remove_file(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    tracing::warn!(error = %e, "factory_reset: failed to remove config file");
                }
            }
        }
        Ok::<(), BindingsError>(())
    })
    .await??;

    let mut guard = shared_config.write().map_err(|_| mutex_poisoned())?;
    *guard = None;
    Ok(())
}

pub(crate) fn validate_configured_roots(config: &TracePilotConfig) -> Result<(), BindingsError> {
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
    for (src, dst) in tracepilot_data_dirs(&old_paths, &new_paths) {
        copy_dir_contents_if_absent(&src, &dst)?;
    }
    Ok(())
}

fn copy_sqlite_db_if_absent(
    src_db: &std::path::Path,
    dst_db: &std::path::Path,
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

    copy_file_if_absent(src_db, dst_db)?;
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
            copy_file_if_absent(&src, &dst)?;
        }
    }
    Ok(())
}

fn tracepilot_data_dirs(
    old_paths: &tracepilot_core::paths::TracePilotPaths,
    new_paths: &tracepilot_core::paths::TracePilotPaths,
) -> Vec<(std::path::PathBuf, std::path::PathBuf)> {
    vec![
        (old_paths.backups_dir(), new_paths.backups_dir()),
        (old_paths.templates_dir(), new_paths.templates_dir()),
    ]
}

fn copy_file_if_absent(src: &std::path::Path, dst: &std::path::Path) -> Result<(), BindingsError> {
    if !src.exists() || dst.exists() {
        return Ok(());
    }
    tracepilot_core::utils::fs::ensure_parent_dir(dst)?;
    std::fs::copy(src, dst)?;
    Ok(())
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
