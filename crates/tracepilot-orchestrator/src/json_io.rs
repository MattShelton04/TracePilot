//! Atomic JSON read/write helpers.
//!
//! Provides safe file I/O for JSON configuration files using the
//! write-to-temp-then-rename pattern to prevent partial writes.
//! On Windows, removes the target before rename since `fs::rename`
//! does not overwrite existing files.

use crate::error::Result;
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::path::Path;

/// Atomically write a JSON value to disk.
///
/// Writes to a `.json.tmp` sibling, then renames over the target.
/// Creates parent directories if needed.
pub fn atomic_json_write<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let json = serde_json::to_string_pretty(value)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)?;

    // On Windows, rename fails if target exists — use backup-swap to avoid data loss.
    #[cfg(windows)]
    {
        if path.exists() {
            let bak = path.with_extension("json.bak");
            std::fs::rename(path, &bak).inspect_err(|_e| {
                // best-effort: clean up the tmp so we don't leak it; primary error still propagates.
                let _: std::io::Result<()> = std::fs::remove_file(&tmp);
            })?;
            if let Err(e) = std::fs::rename(&tmp, path) {
                // best-effort: restore the original from .bak since the primary write failed.
                let _: std::io::Result<()> = std::fs::rename(&bak, path);
                return Err(e.into());
            }
            // best-effort: remove the .bak left by the successful swap.
            let _: std::io::Result<()> = std::fs::remove_file(&bak);
        } else {
            std::fs::rename(&tmp, path)?;
        }
    }

    #[cfg(not(windows))]
    std::fs::rename(&tmp, path)?;

    Ok(())
}

/// Read and deserialize a JSON file. Returns a default if the file doesn't exist.
pub fn atomic_json_read<T: DeserializeOwned + Default>(path: &Path) -> Result<T> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(serde_json::from_str(&content)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

/// Read a JSON file, returning `None` if it doesn't exist.
pub fn atomic_json_read_opt<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(Some(serde_json::from_str(&content)?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use tempfile::TempDir;

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
    struct TestData {
        name: String,
        value: u32,
    }

    #[test]
    fn round_trip_write_read() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.json");

        let data = TestData {
            name: "hello".into(),
            value: 42,
        };
        atomic_json_write(&path, &data).unwrap();

        let read: TestData = atomic_json_read(&path).unwrap();
        assert_eq!(read, data);
    }

    #[test]
    fn read_nonexistent_returns_default() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("missing.json");

        let read: TestData = atomic_json_read(&path).unwrap();
        assert_eq!(read, TestData::default());
    }

    #[test]
    fn read_opt_nonexistent_returns_none() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("missing.json");

        let read: Option<TestData> = atomic_json_read_opt(&path).unwrap();
        assert!(read.is_none());
    }

    #[test]
    fn creates_parent_directories() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nested").join("deep").join("test.json");

        let data = TestData {
            name: "nested".into(),
            value: 1,
        };
        atomic_json_write(&path, &data).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn overwrite_existing_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.json");

        let v1 = TestData {
            name: "v1".into(),
            value: 1,
        };
        atomic_json_write(&path, &v1).unwrap();

        let v2 = TestData {
            name: "v2".into(),
            value: 2,
        };
        atomic_json_write(&path, &v2).unwrap();

        let read: TestData = atomic_json_read(&path).unwrap();
        assert_eq!(read, v2);
    }
}
