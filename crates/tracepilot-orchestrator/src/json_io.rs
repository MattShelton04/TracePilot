//! Atomic file I/O helpers.
//!
//! Provides safe file I/O using the write-to-temp-then-rename
//! pattern to prevent partial writes on crash or interruption.
//! On Windows, removes the target before rename since `fs::rename`
//! does not overwrite existing files.
//!
//! Also includes helpers for reading/deserializing JSON files.

use crate::error::Result;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::path::Path;

/// Atomically write a byte slice to disk.
///
/// Writes to a `.tmp` sibling file, then renames over the target.
/// Creates parent directories if needed.
///
/// Returns `std::io::Result` so callers with different error types
/// (e.g. `SkillsError`, `BindingsError`) can use `?` directly via
/// their `From<std::io::Error>` implementations.
pub fn atomic_write(path: &Path, content: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let temp_path = path.with_extension(
        path.extension()
            .map(|s| s.to_str().unwrap_or(""))
            .map(|s| format!("{s}.tmp"))
            .unwrap_or_else(|| "tmp".to_string()),
    );

    std::fs::write(&temp_path, content)?;

    // On Windows, rename fails if target exists — use backup-swap to avoid data loss.
    #[cfg(windows)]
    {
        if path.exists() {
            let bak_path = path.with_extension(
                path.extension()
                    .map(|s| s.to_str().unwrap_or(""))
                    .map(|s| format!("{s}.bak"))
                    .unwrap_or_else(|| "bak".to_string()),
            );
            if bak_path.exists() {
                let _ = std::fs::remove_file(&bak_path);
            }

            std::fs::rename(path, &bak_path).map_err(|e| {
                let _ = std::fs::remove_file(&temp_path);
                e
            })?;

            if let Err(e) = std::fs::rename(&temp_path, path) {
                let _ = std::fs::rename(&bak_path, path); // restore original
                return Err(e);
            }
            let _ = std::fs::remove_file(&bak_path);
        } else {
            std::fs::rename(&temp_path, path)?;
        }
    }

    #[cfg(not(windows))]
    std::fs::rename(&temp_path, path)?;

    Ok(())
}

/// Atomically write a string slice to disk.
///
/// See [`atomic_write`] for implementation details.
pub fn atomic_write_str(path: &Path, content: &str) -> std::io::Result<()> {
    atomic_write(path, content.as_bytes())
}

/// Atomically write a JSON value to disk.
///
/// Serializes the value to a pretty-printed string and uses `atomic_write`.
pub fn atomic_json_write<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let json = serde_json::to_string_pretty(value)?;
    Ok(atomic_write_str(path, &json)?)
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
    fn atomic_write_str_works() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.txt");
        let content = "Hello, world!";
        atomic_write_str(&path, content).unwrap();
        let read = std::fs::read_to_string(&path).unwrap();
        assert_eq!(read, content);
    }

    #[test]
    fn atomic_write_bytes_works() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.bin");
        let content = b"\x01\x02\x03";
        atomic_write(&path, content).unwrap();
        let read = std::fs::read(&path).unwrap();
        assert_eq!(read, content);
    }

    #[test]
    fn atomic_write_no_extension() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("no-ext-file");
        atomic_write_str(&path, "content").unwrap();
        assert!(path.exists());
        assert!(!dir.path().join("no-ext-file.tmp").exists());
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
