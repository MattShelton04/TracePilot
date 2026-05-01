//! Preview and import orchestration.

use std::collections::HashSet;
use std::path::Path;

use crate::error::{ExportError, Result};

use super::duplicate::generate_duplicate_id;
use super::options::{ConflictStrategy, ImportOptions};
use super::types::{
    ImportPreview, ImportResult, ImportSessionSummary, ImportedSession, SkipReason, SkippedSession,
};
use super::{migrator, parser, validator, writer};

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
    let mut reserved_ids: HashSet<String> = archive
        .sessions
        .iter()
        .map(|session| session.metadata.id.clone())
        .collect();

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
                    let new_id = generate_duplicate_id(target_dir, &reserved_ids)?;
                    reserved_ids.insert(new_id.clone());

                    if !options.dry_run {
                        let path =
                            writer::write_session_to_id(session, &archive, target_dir, &new_id)?;
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
