//! Copying TracePilot's data root when the configured home moves.

use crate::error::BindingsError;

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

pub(super) fn copy_sqlite_db_if_absent(
    src_db: &std::path::Path,
    dst_db: &std::path::Path,
) -> Result<(), BindingsError> {
    copy_sqlite_db_if_absent_with(src_db, dst_db, copy_file_if_absent)
}

pub(super) fn copy_sqlite_db_if_absent_with(
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

pub(super) fn copy_file_if_absent(
    src: &std::path::Path,
    dst: &std::path::Path,
) -> Result<(), BindingsError> {
    copy_file_if_absent_with(src, dst, |source, target| {
        std::io::copy(&mut std::fs::File::open(source)?, target)?;
        Ok(())
    })
}

pub(super) fn copy_file_if_absent_with(
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
        // Preserve source permissions before staging private capture contents.
        file.set_permissions(std::fs::metadata(src)?.permissions())?;
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
}
