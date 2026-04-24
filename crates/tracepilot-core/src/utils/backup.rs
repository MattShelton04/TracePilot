//! Shared file-level backup utilities for TracePilot.
//!
//! [`BackupStore`] is a typed handle to a backup directory that provides
//! common operations used by both the database migration framework and the
//! agent/config backup system:
//!
//! - Creating the backup directory on demand.
//! - Copying a source file into the store (used by agent backups).
//! - Listing stored backup files sorted newest-first by mtime.
//! - Atomically restoring a backup to a destination path.
//! - Deleting a backup file (and an optional JSON sidecar).
//! - Pruning the oldest files when a retention limit is exceeded.
//! - Verifying that a caller-supplied path is contained within the store
//!   (path-traversal guard used before any destructive operation).
//!
//! # What this module does NOT do
//!
//! SQLite-level backups (the `rusqlite::backup::Backup` online API) are
//! handled separately in [`crate::utils::migrator::backup`] because they
//! require an open database connection and a different write path.  The
//! SQLite backup code was intentionally left in the migrator module; only its
//! *file-management* helpers (pruning, path computation) delegate to
//! [`BackupStore`].
//!
//! # Directory layout
//!
//! Both callers keep their backups in separate sub-directories under the
//! shared `backups/` root:
//!
//! ```text
//! ~/.copilot/tracepilot/backups/
//!   ├── database/          ← DB migration snapshots  (*.pre-v*.bak)
//!   └── agents/            ← Agent / config backups  ({stem}-{label}-{ts})
//! ```

use std::cmp::Reverse;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

// ─── Error ────────────────────────────────────────────────────────

/// Errors produced by [`BackupStore`] operations.
#[derive(Debug, thiserror::Error)]
pub enum BackupError {
    /// An I/O error occurred while reading or writing the filesystem.
    #[error("backup I/O error: {0}")]
    Io(#[from] io::Error),

    /// The supplied path resolves outside the backup store directory.
    ///
    /// This is a path-traversal guard: callers should reject any
    /// user-supplied path that fails this check.
    #[error("path is outside the backup directory")]
    PathEscape,

    /// The requested backup file does not exist.
    #[error("backup not found: {0}")]
    NotFound(PathBuf),
}

pub type BackupResult<T> = Result<T, BackupError>;

// ─── BackupFile ───────────────────────────────────────────────────

/// Metadata about a single file inside a [`BackupStore`].
#[derive(Debug, Clone)]
pub struct BackupFile {
    /// Absolute path to the file.
    pub path: PathBuf,
    /// Last-modified time (may be `UNIX_EPOCH` if the OS does not support it).
    pub modified: SystemTime,
    /// Size of the file in bytes.
    pub size_bytes: u64,
}

// ─── BackupStore ──────────────────────────────────────────────────

/// A typed handle to a backup directory.
///
/// All operations are path-scoped: methods that accept a [`Path`] from
/// external callers validate it via [`BackupStore::contains`] before acting.
#[derive(Debug, Clone)]
pub struct BackupStore {
    dir: PathBuf,
}

impl BackupStore {
    /// Create a handle for the given directory.
    ///
    /// The directory does not need to exist yet; call [`BackupStore::ensure_dir`]
    /// before writing if you need to guarantee it is present.
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// The directory path this store is rooted at.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    // ─── Directory management ─────────────────────────────────────

    /// Create the store directory (and any parents) if it does not exist.
    pub fn ensure_dir(&self) -> BackupResult<()> {
        std::fs::create_dir_all(&self.dir).map_err(BackupError::Io)
    }

    // ─── Path security ────────────────────────────────────────────

    /// Return `true` if `path` is located inside this store's directory.
    ///
    /// Uses [`Path::canonicalize`] when the path exists, and falls back to a
    /// lexical prefix check when canonicalization fails (e.g. the file was
    /// just deleted).  Callers should prefer [`BackupStore::guard`] which
    /// returns an error on failure.
    pub fn contains(&self, path: &Path) -> bool {
        // Attempt canonical comparison first (resolves symlinks).
        let canonical_dir = self.dir.canonicalize().unwrap_or_else(|_| self.dir.clone());
        if let Ok(canonical_path) = path.canonicalize() {
            return canonical_path.starts_with(&canonical_dir);
        }
        // Fallback: lexical prefix check (e.g. after deletion).
        path.starts_with(&self.dir)
    }

    /// Validate that `path` is within this store, returning `BackupError::PathEscape`
    /// if it is not.
    pub fn guard(&self, path: &Path) -> BackupResult<()> {
        if self.contains(path) {
            Ok(())
        } else {
            Err(BackupError::PathEscape)
        }
    }

    // ─── Listing ─────────────────────────────────────────────────

    /// List all regular files in the store directory, sorted newest-first by
    /// last-modified time.
    ///
    /// Returns an empty `Vec` (not an error) when the directory does not exist.
    pub fn list_by_mtime(&self) -> BackupResult<Vec<BackupFile>> {
        if !self.dir.exists() {
            return Ok(Vec::new());
        }

        let mut files: Vec<BackupFile> = std::fs::read_dir(&self.dir)?
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                if !path.is_file() {
                    return None;
                }
                let meta = entry.metadata().ok()?;
                Some(BackupFile {
                    path,
                    modified: meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    size_bytes: meta.len(),
                })
            })
            .collect();

        files.sort_by_key(|f| Reverse(f.modified));
        Ok(files)
    }

    /// List files whose names start with `prefix` and end with `suffix`,
    /// sorted newest-first by mtime.
    pub fn list_matching(&self, prefix: &str, suffix: &str) -> BackupResult<Vec<BackupFile>> {
        let all = self.list_by_mtime()?;
        Ok(all
            .into_iter()
            .filter(|f| {
                f.path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(prefix) && n.ends_with(suffix))
            })
            .collect())
    }

    // ─── Write ───────────────────────────────────────────────────

    /// Copy `source` into this store under `file_name`.
    ///
    /// Creates the store directory if necessary.  Returns the full path of the
    /// newly created backup file.
    pub fn write_copy(&self, source: &Path, file_name: &str) -> BackupResult<PathBuf> {
        self.ensure_dir()?;
        let dest = self.dir.join(file_name);
        std::fs::copy(source, &dest).map_err(BackupError::Io)?;
        Ok(dest)
    }

    // ─── Restore ─────────────────────────────────────────────────

    /// Atomically restore `backup_path` to `dest`.
    ///
    /// Writes to a `.restore-tmp-{name}` sibling first, then renames into
    /// place so the destination is never left in a partially-written state.
    ///
    /// `backup_path` must be within this store (`BackupError::PathEscape`
    /// otherwise).
    pub fn restore_to(&self, backup_path: &Path, dest: &Path) -> BackupResult<()> {
        self.guard(backup_path)?;

        if !backup_path.exists() {
            return Err(BackupError::NotFound(backup_path.to_path_buf()));
        }

        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(BackupError::Io)?;
        }

        let tmp_name = format!(
            ".restore-tmp-{}",
            dest.file_name().unwrap_or_default().to_string_lossy()
        );
        let tmp = dest
            .parent()
            .map(|p| p.join(&tmp_name))
            .unwrap_or_else(|| PathBuf::from(&tmp_name));

        std::fs::copy(backup_path, &tmp).map_err(BackupError::Io)?;
        std::fs::rename(&tmp, dest).map_err(BackupError::Io)?;
        Ok(())
    }

    // ─── Deletion ────────────────────────────────────────────────

    /// Delete `path` from the store.
    ///
    /// Also removes `{path}.meta.json` if it exists (agent backup sidecar).
    /// `path` must be within this store (`BackupError::PathEscape` otherwise).
    pub fn delete_file(&self, path: &Path) -> BackupResult<()> {
        self.guard(path)?;

        if !path.exists() {
            return Err(BackupError::NotFound(path.to_path_buf()));
        }

        std::fs::remove_file(path).map_err(BackupError::Io)?;

        // Best-effort sidecar removal (never returns an error if absent).
        if let Some(parent) = path.parent() {
            let file_name = path.file_name().unwrap_or_default().to_string_lossy();
            let sidecar = parent.join(format!("{}.meta.json", file_name));
            let _: std::io::Result<()> = std::fs::remove_file(sidecar);
        }

        Ok(())
    }

    // ─── Pruning ─────────────────────────────────────────────────

    /// Retain only the `keep` most recent files whose names match `prefix` +
    /// `suffix`, deleting the rest.
    ///
    /// Silently ignores deletion errors (logs a warning via `tracing`).  A
    /// `keep` value of `0` disables pruning entirely.
    pub fn prune_by_mtime(&self, prefix: &str, suffix: &str, keep: usize) {
        if keep == 0 {
            return;
        }

        let files = match self.list_matching(prefix, suffix) {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(
                    dir = %self.dir.display(),
                    error = %e,
                    "BackupStore::prune_by_mtime: failed to list files"
                );
                return;
            }
        };

        if files.len() <= keep {
            return;
        }

        for file in files.into_iter().skip(keep) {
            if let Err(e) = std::fs::remove_file(&file.path) {
                tracing::warn!(
                    path = %file.path.display(),
                    error = %e,
                    "BackupStore::prune_by_mtime: failed to remove old backup"
                );
            }
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;
