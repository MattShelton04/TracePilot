//! Backup-before-migrate helpers.
//!
//! Uses SQLite's online backup API (`rusqlite::backup::Backup`) to produce a
//! consistent snapshot even when the source DB is in WAL mode with live
//! connections.

use super::types::MigrationError;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub(super) enum BackupError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
}

pub(super) fn map_backup_err(version: u32, err: BackupError) -> MigrationError {
    match err {
        BackupError::Io(source) => MigrationError::Backup { version, source },
        BackupError::Sqlite(source) => MigrationError::BackupSqlite { version, source },
    }
}

/// Compute the backup path for a given target migration version.
pub fn backup_path_for(db_path: &Path, version: u32, backup_dir: Option<&Path>) -> PathBuf {
    let file_name = db_path
        .file_name()
        .map(|s| s.to_os_string())
        .unwrap_or_else(|| std::ffi::OsString::from("db"));
    let mut stem = file_name;
    stem.push(format!(".pre-v{}.bak", version));

    let dir = backup_dir
        .map(Path::to_path_buf)
        .or_else(|| db_path.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));

    dir.join(stem)
}

/// Write a consistent snapshot of `conn`'s main database to `dest_path`.
///
/// Uses `rusqlite::backup::Backup` (SQLite online backup API) rather than
/// `std::fs::copy` so WAL-mode databases include all committed pages.
/// Overwrites any pre-existing backup at the destination.
pub(super) fn write_backup(conn: &Connection, dest_path: &Path) -> Result<(), BackupError> {
    if let Some(parent) = dest_path.parent() && !parent.as_os_str().is_empty() {
        std::fs::create_dir_all(parent).map_err(BackupError::Io)?;
    }

    if dest_path.exists() {
        std::fs::remove_file(dest_path).map_err(BackupError::Io)?;
    }

    let mut dest = Connection::open(dest_path).map_err(BackupError::Sqlite)?;
    {
        let backup = rusqlite::backup::Backup::new(conn, &mut dest).map_err(BackupError::Sqlite)?;
        backup
            .run_to_completion(64, std::time::Duration::from_millis(0), None)
            .map_err(BackupError::Sqlite)?;
    }
    dest.close().map_err(|(_, e)| BackupError::Sqlite(e))?;
    Ok(())
}

/// Keep only the `keep` most recent `*.pre-v*.bak` files for this DB by mtime.
pub(super) fn prune_backups(db_path: &Path, backup_dir: Option<&Path>, keep: usize) {
    let dir = match backup_dir {
        Some(d) => d.to_path_buf(),
        None => match db_path.parent() {
            Some(p) => p.to_path_buf(),
            None => return,
        },
    };
    let db_stem = match db_path.file_name().and_then(|n| n.to_str()) {
        Some(s) => s.to_string(),
        None => return,
    };
    let prefix = format!("{}.pre-v", db_stem);

    let read_dir = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return,
    };

    let mut entries: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in read_dir.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if !name_str.starts_with(&prefix) || !name_str.ends_with(".bak") {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            entries.push((mtime, entry.path()));
        }
    }

    if entries.len() <= keep {
        return;
    }

    entries.sort_by_key(|b| std::cmp::Reverse(b.0));
    for (_, path) in entries.into_iter().skip(keep) {
        if let Err(e) = std::fs::remove_file(&path) {
            tracing::warn!(path = %path.display(), error = %e, "Failed to prune old backup");
        }
    }
}
