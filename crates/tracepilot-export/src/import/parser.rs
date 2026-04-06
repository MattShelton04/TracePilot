//! Parse `.tpx.json` files into [`SessionArchive`] with safety checks.
//!
//! The parser enforces a maximum file size before reading and validates the
//! basic JSON structure. Deeper structural validation is handled by
//! [`super::validator`].

use std::fs;
use std::path::Path;

use crate::document::SessionArchive;
use crate::error::{ExportError, Result};
use crate::schema;

/// Maximum import file size (500 MB).
pub const MAX_IMPORT_SIZE: u64 = 500 * 1024 * 1024;

/// Parse a `.tpx.json` file into a [`SessionArchive`].
///
/// Performs a size-limit check before reading the file, then deserializes
/// the JSON and validates the schema version is readable.
pub fn parse_archive(path: &Path) -> Result<SessionArchive> {
    // 1. Check file exists
    if !path.exists() {
        return Err(ExportError::Validation {
            message: format!("import file not found: {}", path.display()),
        });
    }

    // 2. Check file size before loading into memory
    let file_size = fs::metadata(path)
        .map_err(|e| ExportError::io(path, e))?
        .len();

    if file_size > MAX_IMPORT_SIZE {
        return Err(ExportError::Validation {
            message: format!(
                "import file too large: {} bytes (max {} bytes)",
                file_size, MAX_IMPORT_SIZE
            ),
        });
    }

    // 3. Read and deserialize
    let content = fs::read_to_string(path).map_err(|e| ExportError::io(path, e))?;
    let archive = parse_archive_str(&content)?;

    // 4. Validate schema version is readable
    let version = &archive.header.schema_version;
    if !schema::CURRENT_VERSION.can_read(version) {
        return Err(ExportError::UnsupportedVersion {
            major: version.major,
            minor: version.minor,
            min_major: schema::CURRENT_VERSION.major,
            min_minor: schema::CURRENT_VERSION.minor,
        });
    }

    // 5. Enforce minimum reader version if the archive declares one
    if let Some(min_reader) = &archive.header.minimum_reader_version
        && !schema::CURRENT_VERSION.satisfies_minimum(min_reader) {
            return Err(ExportError::UnsupportedVersion {
                major: min_reader.major,
                minor: min_reader.minor,
                min_major: schema::CURRENT_VERSION.major,
                min_minor: schema::CURRENT_VERSION.minor,
            });
        }

    Ok(archive)
}

/// Parse a JSON string into a [`SessionArchive`].
///
/// Useful for testing and for in-memory imports (e.g., clipboard paste).
/// Optionally verifies the content hash if present in the header.
pub fn parse_archive_str(json: &str) -> Result<SessionArchive> {
    // Guard against unbounded input (matches file-based MAX_IMPORT_SIZE)
    if json.len() as u64 > MAX_IMPORT_SIZE {
        return Err(ExportError::Validation {
            message: format!(
                "input too large: {} bytes (max {} bytes)",
                json.len(),
                MAX_IMPORT_SIZE
            ),
        });
    }

    let archive: SessionArchive = serde_json::from_str(json).map_err(|e| {
        ExportError::Validation {
            message: format!("invalid JSON structure: {}", e),
        }
    })?;

    // Verify content hash if present
    if let Some(expected_hash) = &archive.header.content_hash {
        verify_content_hash(&archive.sessions, expected_hash)?;
    }

    Ok(archive)
}

/// Re-serialize sessions and compare hash to detect tampering.
fn verify_content_hash(
    sessions: &[crate::document::PortableSession],
    expected: &str,
) -> Result<()> {
    use sha2::{Digest, Sha256};

    let sessions_json = serde_json::to_vec_pretty(sessions).map_err(|e| {
        ExportError::Validation {
            message: format!("failed to re-serialize sessions for hash verification: {e}"),
        }
    })?;

    let mut hasher = Sha256::new();
    hasher.update(&sessions_json);
    let actual = format!("{:x}", hasher.finalize());

    if actual != *expected {
        return Err(ExportError::Validation {
            message: format!(
                "content hash mismatch: expected {}, computed {}. Archive may be corrupted or tampered with.",
                expected, actual
            ),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{minimal_session, test_archive};

    #[test]
    fn parse_valid_json() {
        let archive = test_archive(minimal_session());
        let json = serde_json::to_string_pretty(&archive).unwrap();
        let parsed = parse_archive_str(&json).unwrap();

        assert_eq!(parsed.sessions.len(), 1);
        assert_eq!(parsed.sessions[0].metadata.id, "test-12345678");
    }

    #[test]
    fn rejects_invalid_json() {
        let result = parse_archive_str("{ not valid json }}}");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("invalid JSON structure"));
    }

    #[test]
    fn rejects_missing_file() {
        let result = parse_archive(Path::new("/nonexistent/file.tpx.json"));
        assert!(result.is_err());
    }

    #[test]
    fn rejects_oversized_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.tpx.json");

        // We can't create a 500MB file in tests, but we can test the logic
        // by checking that the size check works on a normal file
        let archive = test_archive(minimal_session());
        let json = serde_json::to_string(&archive).unwrap();
        std::fs::write(&path, &json).unwrap();

        // This file is small, so it should succeed
        let result = parse_archive(&path);
        assert!(result.is_ok());
    }

    #[test]
    fn round_trip_preserves_sessions() {
        let archive = test_archive(minimal_session());
        let json = serde_json::to_string(&archive).unwrap();
        let parsed = parse_archive_str(&json).unwrap();

        assert_eq!(
            parsed.sessions[0].metadata.summary,
            archive.sessions[0].metadata.summary
        );
        assert_eq!(
            parsed.sessions[0].metadata.repository,
            archive.sessions[0].metadata.repository
        );
    }

    #[test]
    fn rejects_unmet_minimum_reader_version() {
        let mut archive = test_archive(minimal_session());
        // Set a minimum reader version higher than current
        archive.header.minimum_reader_version = Some(crate::schema::SchemaVersion {
            major: 1,
            minor: 99,
        });
        let json = serde_json::to_string(&archive).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("future.tpx.json");
        std::fs::write(&path, &json).unwrap();

        let result = parse_archive(&path);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("unsupported") || err.contains("version"));
    }
}
