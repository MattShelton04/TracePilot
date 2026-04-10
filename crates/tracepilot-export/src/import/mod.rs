//! Import pipeline for `.tpx.json` session archives.
//!
//! # Pipeline
//!
//! ```text
//! .tpx.json → Parser → Migrator → Validator → Writer → session directory
//! ```
//!
//! The import pipeline reverses the export pipeline: it reads a `.tpx.json`
//! file, validates it, optionally migrates the schema forward, and writes
//! the session data to a standard session directory that existing parsers
//! can read.
//!
//! # Usage
//!
//! ```ignore
//! use tracepilot_export::import::{preview_import, import_sessions, ImportOptions, ConflictStrategy};
//!
//! // Preview without writing
//! let preview = preview_import(Path::new("export.tpx.json"))?;
//! println!("{} sessions, {} issues", preview.session_count, preview.issues.len());
//!
//! // Import
//! let options = ImportOptions::default();
//! let result = import_sessions(Path::new("export.tpx.json"), Path::new("./sessions"), &options)?;
//! println!("Imported {} sessions", result.imported.len());
//! ```

pub mod migrator;
pub mod parser;
pub mod validator;
pub mod writer;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::document::PortableSessionMetadata;
use crate::error::{ExportError, Result};
use crate::schema::SchemaVersion;

pub use migrator::MigrationStatus;
pub use validator::{IssueSeverity, ValidationIssue};

// ── Import options ─────────────────────────────────────────────────────────

/// Configuration for an import operation.
#[derive(Debug, Clone)]
pub struct ImportOptions {
    /// How to handle sessions that already exist at the target.
    pub conflict_strategy: ConflictStrategy,
    /// Specific session IDs to import (empty = import all).
    pub session_filter: Vec<String>,
    /// Whether to run validation only (dry run).
    pub dry_run: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            conflict_strategy: ConflictStrategy::Skip,
            session_filter: Vec::new(),
            dry_run: false,
        }
    }
}

/// How to resolve conflicts when importing a session whose ID already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictStrategy {
    /// Don't import — keep the existing session.
    Skip,
    /// Overwrite the existing session with imported data.
    Replace,
    /// Generate a new UUID and import as a separate session.
    Duplicate,
}

// ── Import results ─────────────────────────────────────────────────────────

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

// ── Public API ─────────────────────────────────────────────────────────────

/// Preview an import file without writing anything to disk.
///
/// Parses, validates, and reports what would happen if the file were imported.
/// Use this for the import preview UI.
pub fn preview_import(source: &Path, target_dir: Option<&Path>) -> Result<ImportPreview> {
    let archive = parser::parse_archive(source)?;
    let migration_status = migrator::needs_migration(&archive.header.schema_version);
    let issues = validator::collect_issues(&archive);

    let can_import = !issues.iter().any(|i| i.is_error());

    let sessions: Vec<ImportSessionSummary> = archive
        .sessions
        .iter()
        .map(|s| {
            let mut summary = ImportSessionSummary::from(&s.metadata);
            summary.available_sections = s
                .available_sections
                .iter()
                .map(|sec| sec.display_name().to_string())
                .collect();
            // Only probe filesystem for sessions with safe IDs
            if let Some(target) = target_dir
                && !validator::contains_path_traversal(&s.metadata.id)
                && s.metadata.id.len() <= validator::MAX_ID_LENGTH
            {
                summary.already_exists = writer::session_exists(&s.metadata.id, target);
            }
            summary
        })
        .collect();

    Ok(ImportPreview {
        schema_version: archive.header.schema_version,
        migration_status,
        session_count: archive.sessions.len(),
        sessions,
        issues,
        can_import,
    })
}

/// Import sessions from a `.tpx.json` file into the target directory.
///
/// Each session is written as a subdirectory of `target_dir` with the
/// standard session directory layout (workspace.yaml, events.jsonl, etc.).
pub fn import_sessions(
    source: &Path,
    target_dir: &Path,
    options: &ImportOptions,
) -> Result<ImportResult> {
    // 1. Parse
    let archive = parser::parse_archive(source)?;

    // 2. Validate
    validator::validate_archive(&archive)?;

    // 3. Migrate if needed (currently a no-op at v1.0)
    // In the future, this would transform the archive in-place

    // 4. Ensure target directory exists (skip in dry-run mode)
    if !options.dry_run && !target_dir.exists() {
        std::fs::create_dir_all(target_dir).map_err(|e| ExportError::io(target_dir, e))?;
    }

    // 5. Process each session
    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    let mut warnings = Vec::new();

    for session in &archive.sessions {
        let id = &session.metadata.id;

        // Apply session filter
        if !options.session_filter.is_empty() && !options.session_filter.contains(id) {
            skipped.push(SkippedSession {
                id: id.clone(),
                reason: SkipReason::FilteredOut,
            });
            continue;
        }

        // Check for conflicts
        let exists = writer::session_exists(id, target_dir);
        if exists {
            match options.conflict_strategy {
                ConflictStrategy::Skip => {
                    skipped.push(SkippedSession {
                        id: id.clone(),
                        reason: SkipReason::AlreadyExists,
                    });
                    continue;
                }
                ConflictStrategy::Replace => {
                    warnings.push(format!("Replacing existing session: {}", id));
                    // writer::write_session handles overwrite
                }
                ConflictStrategy::Duplicate => {
                    // Generate new ID and write
                    let mut dup_session = session.clone();
                    let new_id = generate_duplicate_id(id);
                    dup_session.metadata.id = new_id.clone();

                    if !options.dry_run {
                        let path = writer::write_session(&dup_session, &archive, target_dir)?;
                        imported.push(ImportedSession {
                            id: new_id,
                            path,
                            was_duplicate: true,
                        });
                    }
                    continue;
                }
            }
        }

        // Write session
        if !options.dry_run {
            let path = writer::write_session(session, &archive, target_dir)?;
            imported.push(ImportedSession {
                id: id.clone(),
                path,
                was_duplicate: false,
            });
        }
    }

    // Note about sections included in the archive but not written to the local
    // session directory. These are read-only metadata that the import pipeline
    // preserves in the archive but cannot restore to disk.
    for session in &archive.sessions {
        let id = &session.metadata.id;
        if session.rewind_snapshots.is_some() {
            warnings.push(format!("Session {}: rewind_snapshots included in archive only (not restored to local session)", id));
        }
        if let Some(tables) = &session.custom_tables
            && !tables.is_empty()
        {
            warnings.push(format!("Session {}: custom_tables included in archive only (not restored to local session)", id));
        }
        if session.parse_diagnostics.is_some() {
            warnings.push(format!("Session {}: parse_diagnostics included in archive only (not restored to local session)", id));
        }
    }

    Ok(ImportResult {
        imported,
        skipped,
        warnings,
    })
}

/// Generate a new unique session ID for a duplicate import.
///
/// Uses a fresh UUID v4 so imported duplicates are indistinguishable from
/// natively-created sessions.
fn generate_duplicate_id(_original_id: &str) -> String {
    uuid::Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{minimal_session, test_archive};
    use std::fs;

    fn write_test_archive(dir: &Path) -> PathBuf {
        let archive = test_archive(minimal_session());
        let json = serde_json::to_string_pretty(&archive).unwrap();
        let path = dir.join("test.tpx.json");
        fs::write(&path, json).unwrap();
        path
    }

    #[test]
    fn preview_reports_session_count() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = write_test_archive(dir.path());

        let preview = preview_import(&archive_path, None).unwrap();
        assert_eq!(preview.session_count, 1);
        assert!(preview.can_import);
    }

    #[test]
    fn preview_detects_existing_session() {
        let dir = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let archive_path = write_test_archive(dir.path());

        // Create the session directory so it "exists"
        fs::create_dir_all(target.path().join("test-12345678")).unwrap();

        let preview = preview_import(&archive_path, Some(target.path())).unwrap();
        assert!(preview.sessions[0].already_exists);
    }

    #[test]
    fn import_creates_session_directory() {
        let dir = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let archive_path = write_test_archive(dir.path());

        let options = ImportOptions::default();
        let result = import_sessions(&archive_path, target.path(), &options).unwrap();

        assert_eq!(result.imported.len(), 1);
        assert_eq!(result.imported[0].id, "test-12345678");
        assert!(result.imported[0].path.exists());
        assert!(result.imported[0].path.join("workspace.yaml").exists());
    }

    #[test]
    fn import_skip_existing() {
        let dir = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let archive_path = write_test_archive(dir.path());

        // Pre-create the session directory
        fs::create_dir_all(target.path().join("test-12345678")).unwrap();
        fs::write(
            target.path().join("test-12345678").join("workspace.yaml"),
            "id: test-12345678\n",
        )
        .unwrap();

        let options = ImportOptions {
            conflict_strategy: ConflictStrategy::Skip,
            ..Default::default()
        };
        let result = import_sessions(&archive_path, target.path(), &options).unwrap();

        assert_eq!(result.imported.len(), 0);
        assert_eq!(result.skipped.len(), 1);
    }

    #[test]
    fn import_replace_existing() {
        let dir = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let archive_path = write_test_archive(dir.path());

        // Pre-create with old content
        let existing = target.path().join("test-12345678");
        fs::create_dir_all(&existing).unwrap();
        fs::write(existing.join("workspace.yaml"), "id: old\n").unwrap();

        let options = ImportOptions {
            conflict_strategy: ConflictStrategy::Replace,
            ..Default::default()
        };
        let result = import_sessions(&archive_path, target.path(), &options).unwrap();

        assert_eq!(result.imported.len(), 1);
        // Verify new content
        let yaml = fs::read_to_string(existing.join("workspace.yaml")).unwrap();
        assert!(yaml.contains("test-12345678"));
    }

    #[test]
    fn import_duplicate_creates_new_id() {
        let dir = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let archive_path = write_test_archive(dir.path());

        // Pre-create existing
        fs::create_dir_all(target.path().join("test-12345678")).unwrap();

        let options = ImportOptions {
            conflict_strategy: ConflictStrategy::Duplicate,
            ..Default::default()
        };
        let result = import_sessions(&archive_path, target.path(), &options).unwrap();

        assert_eq!(result.imported.len(), 1);
        assert!(result.imported[0].was_duplicate);
        // New ID should be a fresh UUID, different from the original
        assert_ne!(result.imported[0].id, "test-12345678");
        // Validate it looks like a UUID (8-4-4-4-12 hex format)
        assert_eq!(result.imported[0].id.len(), 36);
        assert!(
            result.imported[0]
                .id
                .chars()
                .all(|c| c.is_ascii_hexdigit() || c == '-')
        );
    }

    #[test]
    fn import_with_session_filter() {
        let dir = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let archive_path = write_test_archive(dir.path());

        let options = ImportOptions {
            session_filter: vec!["nonexistent-id".to_string()],
            ..Default::default()
        };
        let result = import_sessions(&archive_path, target.path(), &options).unwrap();

        assert_eq!(result.imported.len(), 0);
        assert_eq!(result.skipped.len(), 1);
    }

    #[test]
    fn dry_run_does_not_write() {
        let dir = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        let archive_path = write_test_archive(dir.path());

        let options = ImportOptions {
            dry_run: true,
            ..Default::default()
        };
        let result = import_sessions(&archive_path, target.path(), &options).unwrap();

        assert_eq!(result.imported.len(), 0);
        assert!(!target.path().join("test-12345678").exists());
    }

    #[test]
    fn preview_path_traversal_id_does_not_probe_filesystem() {
        let dir = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();

        // Build an archive with a path-traversal session ID
        let mut session = minimal_session();
        session.metadata.id = "../../../etc/passwd".to_string();
        let archive = test_archive(session);
        let json = serde_json::to_string_pretty(&archive).unwrap();
        let path = dir.path().join("malicious.tpx.json");
        fs::write(&path, json).unwrap();

        let preview = preview_import(&path, Some(target.path())).unwrap();
        // The malicious ID should NOT have triggered a filesystem probe
        assert!(!preview.sessions[0].already_exists);
        assert!(!preview.can_import);
    }
}
