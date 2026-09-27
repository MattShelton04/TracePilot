//! Source identities used to certify derived data against a stable read.

use std::path::Path;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::error::{Result, TracePilotError};

/// File metadata captured before reading. Missing files have no fingerprint;
/// unreadable files are errors, never indistinguishable from missing files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileFingerprint {
    pub modified: SystemTime,
    pub size: u64,
}

impl FileFingerprint {
    pub fn read(path: &Path) -> Result<Option<Self>> {
        match std::fs::metadata(path) {
            Ok(metadata) => {
                if !metadata.is_file() {
                    return Err(TracePilotError::io_context(
                        "Not a regular file",
                        path.display(),
                        std::io::Error::other("source is not a regular file"),
                    ));
                }
                Ok(Some(Self {
                    modified: metadata.modified()?,
                    size: metadata.len(),
                }))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(TracePilotError::io_context(
                "Failed to stat",
                path.display(),
                error,
            )),
        }
    }

    pub fn mtime(&self) -> String {
        let datetime: chrono::DateTime<chrono::Utc> = self.modified.into();
        datetime.to_rfc3339()
    }
}

/// Check cancellation between bounded read buffers and event conversions.
pub fn check_cancelled(is_cancelled: &impl Fn() -> bool) -> Result<()> {
    if is_cancelled() {
        Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "indexing cancelled").into())
    } else {
        Ok(())
    }
}

pub fn ensure_unchanged<T: PartialEq>(before: &T, after: &T, path: &Path) -> Result<()> {
    if before == after {
        Ok(())
    } else {
        Err(TracePilotError::io_context(
            "Source changed while reading",
            path.display(),
            std::io::Error::other("retry the source snapshot"),
        ))
    }
}
