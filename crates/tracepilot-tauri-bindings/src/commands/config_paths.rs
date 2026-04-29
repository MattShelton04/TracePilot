use crate::config::TracePilotConfig;
use crate::error::BindingsError;
use crate::types::TaskDbHandle;

pub(super) fn validate_configured_roots(config: &TracePilotConfig) -> Result<(), BindingsError> {
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

pub(super) fn checkpoint_task_db(handle: &TaskDbHandle) -> Result<(), BindingsError> {
    handle
        .conn()
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| {
            BindingsError::Internal(format!(
                "Failed to checkpoint task DB before migration: {e}"
            ))
        })
}

pub(super) fn copy_tracepilot_home_if_moved(
    old_root: &std::path::Path,
    new_root: &std::path::Path,
) -> Result<(), BindingsError> {
    if old_root == new_root || !old_root.exists() {
        return Ok(());
    }

    let old_paths = tracepilot_core::paths::TracePilotPaths::from_root(old_root);
    let new_paths = tracepilot_core::paths::TracePilotPaths::from_root(new_root);
    std::fs::create_dir_all(new_paths.root())?;

    for (old_db, new_db) in [
        (old_paths.index_db(), new_paths.index_db()),
        (old_paths.tasks_db(), new_paths.tasks_db()),
    ] {
        copy_sqlite_db_if_absent(&old_db, &new_db)?;
    }
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
        (old_paths.presets_dir(), new_paths.presets_dir()),
        (old_paths.task_presets_dir(), new_paths.task_presets_dir()),
        (old_paths.jobs_dir(), new_paths.jobs_dir()),
    ]
}

fn copy_file_if_absent(src: &std::path::Path, dst: &std::path::Path) -> Result<(), BindingsError> {
    if !src.exists() || dst.exists() {
        return Ok(());
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
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
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn tracepilot_home_copy_copies_sqlite_db_units_when_destination_empty() {
        let dir = tempfile::tempdir().unwrap();
        let old_root = dir.path().join("old");
        let new_root = dir.path().join("new");
        let old = tracepilot_core::paths::TracePilotPaths::from_root(&old_root);
        let new = tracepilot_core::paths::TracePilotPaths::from_root(&new_root);

        for db in [old.index_db(), old.tasks_db()] {
            write(&db, "main");
            write(&db.with_extension("db-wal"), "wal");
            write(&db.with_extension("db-shm"), "shm");
        }

        copy_tracepilot_home_if_moved(&old_root, &new_root).unwrap();

        for db in [new.index_db(), new.tasks_db()] {
            assert_eq!(std::fs::read_to_string(&db).unwrap(), "main");
            assert_eq!(
                std::fs::read_to_string(db.with_extension("db-wal")).unwrap(),
                "wal"
            );
            assert_eq!(
                std::fs::read_to_string(db.with_extension("db-shm")).unwrap(),
                "shm"
            );
        }
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
}
