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
    pub fn list_matching(
        &self,
        prefix: &str,
        suffix: &str,
    ) -> BackupResult<Vec<BackupFile>> {
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
            let _ = std::fs::remove_file(sidecar);
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
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup() -> (TempDir, BackupStore) {
        let tmp = TempDir::new().unwrap();
        let store = BackupStore::new(tmp.path().join("backups"));
        (tmp, store)
    }

    // ── ensure_dir ──────────────────────────────────────────────

    #[test]
    fn ensure_dir_creates_directory() {
        let (_tmp, store) = setup();
        assert!(!store.dir().exists());
        store.ensure_dir().unwrap();
        assert!(store.dir().exists());
    }

    #[test]
    fn ensure_dir_is_idempotent() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();
        store.ensure_dir().unwrap(); // second call must not fail
        assert!(store.dir().exists());
    }

    // ── write_copy ──────────────────────────────────────────────

    #[test]
    fn write_copy_places_file_in_store() {
        let (tmp, store) = setup();
        let src = tmp.path().join("source.yaml");
        fs::write(&src, b"content: true").unwrap();

        let dest = store.write_copy(&src, "backup-1").unwrap();
        assert_eq!(dest, store.dir().join("backup-1"));
        assert_eq!(fs::read(&dest).unwrap(), b"content: true");
    }

    #[test]
    fn write_copy_creates_store_dir_if_missing() {
        let (tmp, store) = setup();
        let src = tmp.path().join("source.yaml");
        fs::write(&src, b"hello").unwrap();

        assert!(!store.dir().exists());
        store.write_copy(&src, "file").unwrap();
        assert!(store.dir().exists());
    }

    // ── list_by_mtime ───────────────────────────────────────────

    #[test]
    fn list_by_mtime_returns_empty_for_missing_dir() {
        let (_tmp, store) = setup();
        let files = store.list_by_mtime().unwrap();
        assert!(files.is_empty());
    }

    #[test]
    fn list_by_mtime_returns_files_newest_first() {
        let (tmp, store) = setup();
        store.ensure_dir().unwrap();

        // Create files with explicit timestamps to guarantee ordering.
        let a = store.dir().join("a.bak");
        let b = store.dir().join("b.bak");
        let c = store.dir().join("c.bak");
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"b").unwrap();
        fs::write(&c, b"c").unwrap();

        // Touch b last so it should be newest.
        let future = SystemTime::now() + std::time::Duration::from_secs(5);
        filetime::set_file_mtime(&b, filetime::FileTime::from_system_time(future)).unwrap();

        let files = store.list_by_mtime().unwrap();
        let names: Vec<&str> = files
            .iter()
            .filter_map(|f| f.path.file_name().and_then(|n| n.to_str()))
            .collect();

        assert_eq!(names[0], "b.bak", "b should be newest");
        // a and c ordering relative to each other may vary; just check b is first.
        assert!(names.contains(&"a.bak"));
        assert!(names.contains(&"c.bak"));
        // Suppresses unused import warning from TempDir
        drop(tmp);
    }

    #[test]
    fn list_matching_filters_by_prefix_and_suffix() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();

        fs::write(store.dir().join("index.db.pre-v1.bak"), b"db1").unwrap();
        fs::write(store.dir().join("index.db.pre-v2.bak"), b"db2").unwrap();
        fs::write(store.dir().join("other-backup-20250101.yaml"), b"ag").unwrap();

        let db_files = store.list_matching("index.db.pre-v", ".bak").unwrap();
        assert_eq!(db_files.len(), 2);
        assert!(db_files.iter().all(|f| f
            .path
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with(".bak")));
    }

    // ── contains / guard ────────────────────────────────────────

    #[test]
    fn contains_true_for_child_path() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();
        let child = store.dir().join("some-backup");
        fs::write(&child, b"").unwrap();
        assert!(store.contains(&child));
    }

    #[test]
    fn contains_false_for_path_outside_store() {
        let (tmp, store) = setup();
        store.ensure_dir().unwrap();
        let outside = tmp.path().join("secret.db");
        fs::write(&outside, b"").unwrap();
        assert!(!store.contains(&outside));
    }

    #[test]
    fn guard_returns_path_escape_for_outside_path() {
        let (tmp, store) = setup();
        store.ensure_dir().unwrap();
        let outside = tmp.path().join("outside");
        fs::write(&outside, b"").unwrap();
        assert!(matches!(store.guard(&outside), Err(BackupError::PathEscape)));
    }

    // ── restore_to ──────────────────────────────────────────────

    #[test]
    fn restore_to_copies_file_atomically() {
        let (tmp, store) = setup();
        store.ensure_dir().unwrap();
        let src = tmp.path().join("original.yaml");
        fs::write(&src, b"original").unwrap();
        let backup = store.write_copy(&src, "backup.yaml").unwrap();

        let restore_dest = tmp.path().join("restore").join("out.yaml");
        store.restore_to(&backup, &restore_dest).unwrap();
        assert_eq!(fs::read(&restore_dest).unwrap(), b"original");
    }

    #[test]
    fn restore_to_rejects_outside_path() {
        let (tmp, store) = setup();
        store.ensure_dir().unwrap();
        let outside = tmp.path().join("outside.bak");
        fs::write(&outside, b"data").unwrap();

        let dest = tmp.path().join("out.yaml");
        let result = store.restore_to(&outside, &dest);
        assert!(matches!(result, Err(BackupError::PathEscape)));
    }

    #[test]
    fn restore_to_returns_not_found_for_missing_backup() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();
        let missing = store.dir().join("nonexistent.bak");
        let dest = store.dir().join("out.yaml");
        let result = store.restore_to(&missing, &dest);
        assert!(matches!(result, Err(BackupError::NotFound(_))));
    }

    // ── delete_file ─────────────────────────────────────────────

    #[test]
    fn delete_file_removes_file() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();
        let path = store.dir().join("to-delete");
        fs::write(&path, b"gone").unwrap();

        store.delete_file(&path).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn delete_file_also_removes_sidecar_if_present() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();
        let path = store.dir().join("my-backup");
        let sidecar = store.dir().join("my-backup.meta.json");
        fs::write(&path, b"content").unwrap();
        fs::write(&sidecar, b"{}").unwrap();

        store.delete_file(&path).unwrap();
        assert!(!path.exists());
        assert!(!sidecar.exists());
    }

    #[test]
    fn delete_file_succeeds_without_sidecar() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();
        let path = store.dir().join("no-sidecar");
        fs::write(&path, b"data").unwrap();
        store.delete_file(&path).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn delete_file_rejects_outside_path() {
        let (tmp, store) = setup();
        store.ensure_dir().unwrap();
        let outside = tmp.path().join("outside");
        fs::write(&outside, b"secret").unwrap();
        assert!(matches!(
            store.delete_file(&outside),
            Err(BackupError::PathEscape)
        ));
    }

    #[test]
    fn delete_file_returns_not_found_for_missing() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();
        let missing = store.dir().join("gone");
        let result = store.delete_file(&missing);
        assert!(matches!(result, Err(BackupError::NotFound(_))));
    }

    // ── prune_by_mtime ──────────────────────────────────────────

    #[test]
    fn prune_keeps_n_newest_files() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();

        // Create 7 files with staggered timestamps.
        for i in 1u64..=7 {
            let path = store.dir().join(format!("test.db.pre-v{}.bak", i));
            fs::write(&path, b"x").unwrap();
            let t = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(i * 1000);
            filetime::set_file_mtime(&path, filetime::FileTime::from_system_time(t)).unwrap();
        }

        store.prune_by_mtime("test.db.pre-v", ".bak", 5);

        let remaining: Vec<_> = fs::read_dir(store.dir())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();

        assert_eq!(remaining.len(), 5, "should retain 5 newest: {:?}", remaining);
        // The 5 newest are v3–v7 (highest timestamps).
        for v in 3..=7 {
            assert!(
                remaining.iter().any(|n| n.contains(&format!("pre-v{}", v))),
                "v{} missing from {:?}",
                v,
                remaining
            );
        }
    }

    #[test]
    fn prune_is_noop_when_count_within_limit() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();

        for i in 1..=3 {
            fs::write(store.dir().join(format!("x.pre-v{}.bak", i)), b"x").unwrap();
        }

        store.prune_by_mtime("x.pre-v", ".bak", 5);

        let count = fs::read_dir(store.dir()).unwrap().count();
        assert_eq!(count, 3);
    }

    #[test]
    fn prune_zero_keep_does_nothing() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();
        for i in 1..=3 {
            fs::write(store.dir().join(format!("f{}.bak", i)), b"x").unwrap();
        }
        store.prune_by_mtime("f", ".bak", 0);
        assert_eq!(fs::read_dir(store.dir()).unwrap().count(), 3);
    }

    #[test]
    fn prune_does_not_delete_non_matching_files() {
        let (_tmp, store) = setup();
        store.ensure_dir().unwrap();

        // DB backups: should be pruned.
        for i in 1u64..=3 {
            let p = store.dir().join(format!("index.db.pre-v{}.bak", i));
            fs::write(&p, b"x").unwrap();
            let t = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(i * 1000);
            filetime::set_file_mtime(&p, filetime::FileTime::from_system_time(t)).unwrap();
        }
        // Agent backup: must NOT be pruned.
        fs::write(store.dir().join("agent-backup-20250101"), b"y").unwrap();

        store.prune_by_mtime("index.db.pre-v", ".bak", 1);

        // Only 1 DB backup should remain plus the agent backup = 2 total.
        let count = fs::read_dir(store.dir()).unwrap().count();
        assert_eq!(count, 2, "agent backup must survive DB prune");
    }
}
