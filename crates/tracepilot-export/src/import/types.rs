//! Import preview, result, and session summary types.

use std::path::PathBuf;

use crate::document::PortableSessionMetadata;
use crate::schema::SchemaVersion;

use super::migrator::MigrationStatus;
use super::validator::ValidationIssue;

/// Preview of what an import would do, without writing anything.
#[derive(Debug, Clone)]
pub struct ImportPreview {
    /// Schema version found in the file.
    pub schema_version: SchemaVersion,
    /// Whether migration would be needed.
    pub migration_status: MigrationStatus,
    /// Number of sessions in the archive.
    pub session_count: usize,
    /// Summary of each session found.
    pub sessions: Vec<ImportSessionSummary>,
    /// Validation issues found.
    pub issues: Vec<ValidationIssue>,
    /// Whether the import can proceed (no blocking errors).
    pub can_import: bool,
}

/// Summary info for a single session in the import preview.
#[derive(Debug, Clone)]
pub struct ImportSessionSummary {
    pub id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub event_count: Option<usize>,
    pub turn_count: Option<usize>,
    pub already_exists: bool,
    pub available_sections: Vec<String>,
}

impl From<&PortableSessionMetadata> for ImportSessionSummary {
    fn from(meta: &PortableSessionMetadata) -> Self {
        Self {
            id: meta.id.clone(),
            summary: meta.summary.clone(),
            repository: meta.repository.clone(),
            event_count: meta.event_count,
            turn_count: meta.turn_count,
            already_exists: false,
            available_sections: Vec::new(),
        }
    }
}

/// Result of a completed import operation.
#[derive(Debug, Clone)]
pub struct ImportResult {
    /// Sessions that were successfully imported.
    pub imported: Vec<ImportedSession>,
    /// Sessions that were skipped (conflict or filter).
    pub skipped: Vec<SkippedSession>,
    /// Any non-blocking warnings encountered.
    pub warnings: Vec<String>,
}

/// A session that was successfully written to disk.
#[derive(Debug, Clone)]
pub struct ImportedSession {
    pub id: String,
    pub path: PathBuf,
    pub was_duplicate: bool,
}

/// A session that was not imported.
#[derive(Debug, Clone)]
pub struct SkippedSession {
    pub id: String,
    pub reason: SkipReason,
}

#[derive(Debug, Clone)]
pub enum SkipReason {
    AlreadyExists,
    FilteredOut,
    ValidationError(String),
}
