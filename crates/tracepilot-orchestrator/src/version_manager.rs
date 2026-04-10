//! Copilot CLI version detection and migration.

use crate::error::{OrchestratorError, Result};
use crate::types::{CopilotVersion, MigrationDiff};
use std::path::Path;

/// Discover all installed Copilot CLI versions.
pub fn discover_versions(copilot_home: &Path) -> Result<Vec<CopilotVersion>> {
    let universal_dir = copilot_home.join("pkg").join("universal");
    if !universal_dir.exists() {
        return Ok(Vec::new());
    }

    let mut versions = Vec::new();
    for entry in std::fs::read_dir(&universal_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let version_str = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Skip non-version directories
        if semver::Version::parse(&version_str).is_err() {
            continue;
        }

        let is_complete = path.join(".extraction-complete").exists();
        let has_customizations = check_for_customizations(&path);
        let lock_count = count_lock_files(&path);
        let modified_at = std::fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
            .unwrap_or_default();

        versions.push(CopilotVersion {
            version: version_str,
            path: path.to_string_lossy().to_string(),
            is_active: false, // Will be set by `mark_active`
            is_complete,
            modified_at,
            has_customizations,
            lock_count,
        });
    }

    // Sort by semver descending
    versions.sort_by(|a, b| {
        let va = semver::Version::parse(&a.version).unwrap_or(semver::Version::new(0, 0, 0));
        let vb = semver::Version::parse(&b.version).unwrap_or(semver::Version::new(0, 0, 0));
        vb.cmp(&va)
    });

    // Mark the highest complete version as active
    mark_active(&mut versions);

    Ok(versions)
}

/// Get the active (latest complete) Copilot CLI version.
pub fn active_version(copilot_home: &Path) -> Result<CopilotVersion> {
    let versions = discover_versions(copilot_home)?;
    versions
        .into_iter()
        .find(|v| v.is_active)
        .ok_or_else(|| OrchestratorError::Version("No active Copilot version found".into()))
}

/// Generate migration diffs between two versions (for config migration).
pub fn migration_diffs(
    copilot_home: &Path,
    from_version: &str,
    to_version: &str,
) -> Result<Vec<MigrationDiff>> {
    let universal = copilot_home.join("pkg").join("universal");
    let from_dir = universal.join(from_version).join("definitions");
    let to_dir = universal.join(to_version).join("definitions");

    // Read directories directly — avoid TOCTOU by handling errors from the IO operations
    let to_entries = match std::fs::read_dir(&to_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(OrchestratorError::NotFound(format!(
                "Target version definitions not found: {}",
                to_dir.display()
            )));
        }
        Err(e) => return Err(e.into()),
    };

    let mut diffs = Vec::new();

    // Compare each agent YAML in the target version
    for entry in to_entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }

        let file_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let from_path = from_dir.join(&file_name);

        let old_content = match std::fs::read_to_string(&from_path) {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(e.into()),
        };
        let new_content = std::fs::read_to_string(&path)?;

        let diff = similar::TextDiff::from_lines(&old_content, &new_content);
        let diff_text = diff
            .unified_diff()
            .header(
                &format!("{}/{}", from_version, file_name),
                &format!("{}/{}", to_version, file_name),
            )
            .to_string();

        let agent_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .replace(".agent", "")
            .to_string();

        diffs.push(MigrationDiff {
            file_name,
            agent_name,
            from_version: from_version.to_string(),
            to_version: to_version.to_string(),
            diff: diff_text,
            has_conflicts: false,
        });
    }

    // Also check for files that exist in `from` but not in `to` (removed agents)
    let from_entries = match std::fs::read_dir(&from_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(OrchestratorError::NotFound(format!(
                "Source version definitions not found: {}",
                from_dir.display()
            )));
        }
        Err(e) => return Err(e.into()),
    };
    for entry in from_entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }

        let file_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        if !to_dir.join(&file_name).exists() {
            let old_content = std::fs::read_to_string(&path)?;
            let agent_name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .replace(".agent", "")
                .to_string();

            diffs.push(MigrationDiff {
                file_name,
                agent_name,
                from_version: from_version.to_string(),
                to_version: to_version.to_string(),
                diff: format!("--- Agent removed in {} ---\n{}", to_version, old_content),
                has_conflicts: true,
            });
        }
    }

    Ok(diffs)
}

/// Migrate customized agent definitions from one version to another.
/// This copies the customized file to the target version directory.
pub fn migrate_agent(
    copilot_home: &Path,
    file_name: &str,
    from_version: &str,
    to_version: &str,
) -> Result<()> {
    let universal = copilot_home.join("pkg").join("universal");
    let from_file = universal
        .join(from_version)
        .join("definitions")
        .join(file_name);
    let to_file = universal
        .join(to_version)
        .join("definitions")
        .join(file_name);

    // Backup the target first (skip if target doesn't exist yet — new agent)
    let backup_dir = crate::config_injector::backup_dir()?;
    match crate::config_injector::create_backup(
        &to_file,
        &backup_dir,
        &format!("pre-migrate-{}", to_version),
    ) {
        Ok(_) => {}
        Err(OrchestratorError::NotFound(_)) => {
            // Target doesn't exist yet — nothing to back up for new agents
        }
        Err(e) => return Err(e),
    }

    // Copy source to destination via temp file — avoid TOCTOU by handling copy errors directly
    let parent = to_file.parent().ok_or_else(|| {
        OrchestratorError::Config(format!("Invalid destination path: {}", to_file.display()))
    })?;
    let temp = parent.join(format!(".migrate-tmp-{}", file_name));
    match std::fs::copy(&from_file, &temp) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(OrchestratorError::NotFound(format!(
                "Source file not found: {}",
                from_file.display()
            )));
        }
        Err(e) => return Err(e.into()),
    }
    std::fs::rename(&temp, &to_file)?;

    Ok(())
}

// ─── Internal helpers ─────────────────────────────────────────────

fn mark_active(versions: &mut [CopilotVersion]) {
    // The active version is the highest semver that has .extraction-complete
    for v in versions.iter_mut() {
        if v.is_complete {
            v.is_active = true;
            break;
        }
    }
}

fn check_for_customizations(version_dir: &Path) -> bool {
    let defs_dir = version_dir.join("definitions");
    if !defs_dir.exists() {
        return false;
    }

    // Check if any agent YAML has been modified from stock
    // Simple heuristic: check if file timestamps are newer than .extraction-complete
    let extraction_time = version_dir
        .join(".extraction-complete")
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok());

    if let Some(extraction_time) = extraction_time
        && let Ok(entries) = std::fs::read_dir(&defs_dir)
    {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata()
                && let Ok(modified) = meta.modified()
                && modified > extraction_time
            {
                return true;
            }
        }
    }

    false
}

fn count_lock_files(version_dir: &Path) -> usize {
    std::fs::read_dir(version_dir)
        .ok()
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    e.file_name().to_string_lossy().starts_with("inuse.")
                        && e.file_name().to_string_lossy().ends_with(".lock")
                })
                .count()
        })
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_mark_active_picks_first_complete() {
        let mut versions = vec![
            CopilotVersion {
                version: "1.0.9".into(),
                path: "/test/1.0.9".into(),
                is_active: false,
                is_complete: true,
                modified_at: String::new(),
                has_customizations: false,
                lock_count: 0,
            },
            CopilotVersion {
                version: "1.0.8".into(),
                path: "/test/1.0.8".into(),
                is_active: false,
                is_complete: true,
                modified_at: String::new(),
                has_customizations: false,
                lock_count: 0,
            },
        ];

        mark_active(&mut versions);
        assert!(versions[0].is_active);
        assert!(!versions[1].is_active);
    }

    #[test]
    fn test_mark_active_skips_incomplete() {
        let mut versions = vec![
            CopilotVersion {
                version: "1.0.9".into(),
                path: "/test/1.0.9".into(),
                is_active: false,
                is_complete: false, // Extracting
                modified_at: String::new(),
                has_customizations: false,
                lock_count: 0,
            },
            CopilotVersion {
                version: "1.0.8".into(),
                path: "/test/1.0.8".into(),
                is_active: false,
                is_complete: true,
                modified_at: String::new(),
                has_customizations: false,
                lock_count: 0,
            },
        ];

        mark_active(&mut versions);
        assert!(!versions[0].is_active);
        assert!(versions[1].is_active);
    }

    #[test]
    fn test_discover_versions_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let copilot_home = dir.path();
        let result = discover_versions(copilot_home).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_discover_versions_with_versions() {
        let dir = tempfile::tempdir().unwrap();
        let universal = dir.path().join("pkg").join("universal");

        // Create two version directories
        let v108 = universal.join("1.0.8");
        let v109 = universal.join("1.0.9");
        fs::create_dir_all(&v108).unwrap();
        fs::create_dir_all(&v109).unwrap();
        fs::write(v108.join(".extraction-complete"), "").unwrap();
        fs::write(v109.join(".extraction-complete"), "").unwrap();

        let versions = discover_versions(dir.path()).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].version, "1.0.9");
        assert!(versions[0].is_active);
        assert!(!versions[1].is_active);
    }

    #[test]
    fn test_migration_diffs() {
        let dir = tempfile::tempdir().unwrap();
        let universal = dir.path().join("pkg").join("universal");

        // Setup v1.0.8 with an agent
        let old_defs = universal.join("1.0.8").join("definitions");
        fs::create_dir_all(&old_defs).unwrap();
        fs::write(
            old_defs.join("task.agent.yaml"),
            "name: task\nmodel: opus-4.5\n",
        )
        .unwrap();

        // Setup v1.0.9 with modified agent
        let new_defs = universal.join("1.0.9").join("definitions");
        fs::create_dir_all(&new_defs).unwrap();
        fs::write(
            new_defs.join("task.agent.yaml"),
            "name: task\nmodel: opus-4.6\n",
        )
        .unwrap();

        let diffs = migration_diffs(dir.path(), "1.0.8", "1.0.9").unwrap();
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].diff.contains("opus-4.5"));
        assert!(diffs[0].diff.contains("opus-4.6"));
    }
}
