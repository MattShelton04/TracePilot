//! Utility functions for file operations.

use crate::error::{OrchestratorError, Result};
use std::path::Path;

/// Write content to a file atomically using a temporary file and rename.
///
/// This ensures that if the write fails partway through, the target file
/// is never left in a half-written state. The write-then-rename pattern
/// is atomic on both Unix and Windows.
///
/// On Windows, if the target file already exists, it is removed before
/// the rename since `fs::rename` on Windows fails if the destination exists.
///
/// # Arguments
/// * `path` - Target file path
/// * `content` - Content to write (as bytes)
///
/// # Examples
/// ```no_run
/// use tracepilot_orchestrator::utils::atomic_write;
/// use std::path::Path;
///
/// atomic_write(Path::new("/tmp/config.json"), b"{\"key\": \"value\"}")?;
/// # Ok::<(), tracepilot_orchestrator::OrchestratorError>(())
/// ```
pub fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| OrchestratorError::Config("No parent directory".into()))?;

    // Create parent directory if it doesn't exist
    if !parent.exists() {
        std::fs::create_dir_all(parent)?;
    }

    // Generate temp file name with UUID for unpredictability (security: prevents temp file prediction attacks)
    let temp_filename = format!(
        ".tmp-{}-{}",
        uuid::Uuid::new_v4().simple(),
        path.file_name()
            .ok_or_else(|| OrchestratorError::Config("Invalid file path".into()))?
            .to_string_lossy()
    );
    let temp_path = parent.join(temp_filename);

    // Write to temp file
    std::fs::write(&temp_path, content)?;

    // Platform-specific atomic rename handling
    #[cfg(windows)]
    {
        // On Windows, rename doesn't overwrite existing files
        // Try rename first - if it fails and target exists, handle specially
        match std::fs::rename(&temp_path, path) {
            Ok(()) => return Ok(()),
            Err(_) if path.exists() => {
                // Target exists - remove it and retry
                // Note: This creates a small window where file doesn't exist (not fully atomic)
                if let Err(e) = std::fs::remove_file(path) {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(e.into());
                }
                match std::fs::rename(&temp_path, path) {
                    Ok(()) => return Ok(()),
                    Err(e) => {
                        let _ = std::fs::remove_file(&temp_path);
                        return Err(e.into());
                    }
                }
            }
            Err(e) => {
                let _ = std::fs::remove_file(&temp_path);
                return Err(e.into());
            }
        }
    }

    #[cfg(not(windows))]
    {
        // On Unix, rename is atomic and will overwrite
        match std::fs::rename(&temp_path, path) {
            Ok(()) => Ok(()),
            Err(e) => {
                // Best-effort cleanup of temp file
                let _ = std::fs::remove_file(&temp_path);
                Err(e.into())
            }
        }
    }
}

/// Write content to a file atomically with pre-write validation.
///
/// This is a convenience wrapper around [`atomic_write`] that validates
/// the content before writing. The validator function should return
/// `Ok(())` if the content is valid, or an error describing the problem.
///
/// # Arguments
/// * `path` - Target file path
/// * `content` - Content to write (as string)
/// * `validator` - Function to validate content before writing
///
/// # Examples
/// ```no_run
/// use tracepilot_orchestrator::utils::atomic_write_validated;
/// use std::path::Path;
///
/// let json_content = r#"{"valid": "json"}"#;
/// atomic_write_validated(
///     Path::new("/tmp/data.json"),
///     json_content,
///     |s| serde_json::from_str::<serde_json::Value>(s)
///         .map(|_| ())
///         .map_err(|e| format!("Invalid JSON: {e}"))
/// )?;
/// # Ok::<(), tracepilot_orchestrator::OrchestratorError>(())
/// ```
pub fn atomic_write_validated<F>(path: &Path, content: &str, validator: F) -> Result<()>
where
    F: FnOnce(&str) -> std::result::Result<(), String>,
{
    validator(content).map_err(|e| OrchestratorError::Config(e))?;
    atomic_write(path, content.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_atomic_write_creates_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.txt");

        atomic_write(&path, b"hello world").unwrap();

        assert!(path.exists());
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello world");
    }

    #[test]
    fn test_atomic_write_overwrites_existing() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.txt");

        fs::write(&path, "original").unwrap();
        atomic_write(&path, b"updated").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "updated");
    }

    #[test]
    fn test_atomic_write_creates_parent_dir() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("subdir").join("test.txt");

        atomic_write(&path, b"content").unwrap();

        assert!(path.exists());
        assert_eq!(fs::read_to_string(&path).unwrap(), "content");
    }

    #[test]
    fn test_atomic_write_removes_temp_file_on_success() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.txt");

        atomic_write(&path, b"data").unwrap();

        // Check no temp files remain
        let entries: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert!(entries.iter().all(|name| !name.starts_with(".tmp-")));
    }

    #[test]
    fn test_atomic_write_validated_accepts_valid_json() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("data.json");

        let result = atomic_write_validated(&path, r#"{"key": "value"}"#, |s| {
            serde_json::from_str::<serde_json::Value>(s)
                .map(|_| ())
                .map_err(|e| format!("Invalid JSON: {e}"))
        });

        assert!(result.is_ok());
        assert!(path.exists());
    }

    #[test]
    fn test_atomic_write_validated_rejects_invalid_json() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("data.json");

        let result = atomic_write_validated(&path, r#"{"invalid": json}"#, |s| {
            serde_json::from_str::<serde_json::Value>(s)
                .map(|_| ())
                .map_err(|e| format!("Invalid JSON: {e}"))
        });

        assert!(result.is_err());
        assert!(!path.exists()); // File should not be created
    }

    #[test]
    fn test_atomic_write_validated_accepts_valid_yaml() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.yaml");

        let result = atomic_write_validated(&path, "key: value\nlist:\n  - item", |s| {
            serde_yml::from_str::<serde_yml::Value>(s)
                .map(|_| ())
                .map_err(|e| format!("Invalid YAML: {e}"))
        });

        assert!(result.is_ok());
        assert!(path.exists());
    }

    #[test]
    fn test_atomic_write_validated_rejects_invalid_yaml() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("config.yaml");

        let result = atomic_write_validated(&path, "invalid: [unclosed", |s| {
            serde_yml::from_str::<serde_yml::Value>(s)
                .map(|_| ())
                .map_err(|e| format!("Invalid YAML: {e}"))
        });

        assert!(result.is_err());
        assert!(!path.exists()); // File should not be created
    }

    #[test]
    fn test_atomic_write_preserves_parent_on_validation_failure() {
        let tmp = TempDir::new().unwrap();
        let subdir = tmp.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        let path = subdir.join("data.json");

        let result = atomic_write_validated(&path, "invalid json", |s| {
            serde_json::from_str::<serde_json::Value>(s)
                .map(|_| ())
                .map_err(|e| format!("Invalid JSON: {e}"))
        });

        assert!(result.is_err());
        assert!(subdir.exists()); // Parent directory should still exist
        assert!(!path.exists()); // Target file should not exist
    }
}
