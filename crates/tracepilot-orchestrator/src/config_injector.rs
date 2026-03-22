//! Copilot CLI config injection and management.

use crate::error::{OrchestratorError, Result};
use crate::types::{AgentDefinition, BackupDiffPreview, BackupEntry, CopilotConfig, ConfigDiff};
use std::path::{Path, PathBuf};

/// Read all agent definitions for a given Copilot version.
pub fn read_agent_definitions(version_dir: &Path) -> Result<Vec<AgentDefinition>> {
    let defs_dir = version_dir.join("definitions");
    if !defs_dir.exists() {
        return Err(OrchestratorError::NotFound(format!(
            "Definitions directory not found: {}",
            defs_dir.display()
        )));
    }

    let mut agents = Vec::new();
    for entry in std::fs::read_dir(&defs_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("yaml") {
            if let Some(agent) = parse_agent_yaml(&path)? {
                agents.push(agent);
            }
        }
    }

    agents.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(agents)
}

/// Read the global Copilot CLI config file.
pub fn read_copilot_config(copilot_home: &Path) -> Result<CopilotConfig> {
    let config_path = copilot_home.join("config.json");
    if !config_path.exists() {
        return Ok(CopilotConfig {
            model: None,
            reasoning_effort: None,
            trusted_folders: Vec::new(),
            raw: serde_json::Value::Object(serde_json::Map::new()),
        });
    }

    let content = std::fs::read_to_string(&config_path)?;
    let raw: serde_json::Value = serde_json::from_str(&content)?;

    Ok(CopilotConfig {
        model: raw.get("model").and_then(|v| v.as_str()).map(String::from),
        reasoning_effort: raw
            .get("reasoningEffort")
            .and_then(|v| v.as_str())
            .map(String::from),
        trusted_folders: raw
            .get("trustedFolders")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        raw,
    })
}

/// Write an updated agent definition YAML to disk.
/// Uses atomic write (write to temp then rename) for safety.
pub fn write_agent_definition(path: &Path, yaml_content: &str) -> Result<()> {
    // Validate YAML is parseable before writing
    let _: serde_yaml::Value = serde_yaml::from_str(yaml_content)
        .map_err(|e| OrchestratorError::Config(format!("Invalid YAML: {e}")))?;

    let parent = path
        .parent()
        .ok_or_else(|| OrchestratorError::Config("No parent directory".into()))?;
    let temp_path = parent.join(format!(
        ".tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));

    std::fs::write(&temp_path, yaml_content)?;
    std::fs::rename(&temp_path, path)?;
    Ok(())
}

/// Write the global Copilot config.json file.
pub fn write_copilot_config(copilot_home: &Path, config: &serde_json::Value) -> Result<()> {
    let config_path = copilot_home.join("config.json");
    let temp_path = copilot_home.join(".config.json.tmp");

    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(&temp_path, &content)?;
    std::fs::rename(&temp_path, &config_path)?;
    Ok(())
}

/// Create a backup of a file.
pub fn create_backup(
    file_path: &Path,
    backup_dir: &Path,
    label: &str,
) -> Result<BackupEntry> {
    if !file_path.exists() {
        return Err(OrchestratorError::NotFound(format!(
            "File to backup not found: {}",
            file_path.display()
        )));
    }

    std::fs::create_dir_all(backup_dir)?;

    let timestamp = chrono::Utc::now().format("%Y%m%d-%H%M%S%.3f");
    let file_stem = file_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let backup_name = if label.is_empty() {
        format!("{}-{}", file_stem, timestamp)
    } else {
        format!("{}-{}-{}", file_stem, label, timestamp)
    };
    let backup_path = backup_dir.join(&backup_name);

    std::fs::copy(file_path, &backup_path)?;
    let meta = std::fs::metadata(&backup_path)?;

    let created_at = chrono::Utc::now().to_rfc3339();

    // Write sidecar metadata so list_backups can recover source_path
    let sidecar_path = backup_dir.join(format!("{}.meta.json", backup_name));
    let sidecar = serde_json::json!({
        "source_path": file_path.to_string_lossy(),
        "label": label,
        "original_filename": file_path.file_name().unwrap_or_default().to_string_lossy(),
    });
    std::fs::write(&sidecar_path, serde_json::to_string_pretty(&sidecar).unwrap_or_default())?;

    Ok(BackupEntry {
        id: uuid::Uuid::new_v4().to_string(),
        label: label.to_string(),
        source_path: file_path.to_string_lossy().to_string(),
        backup_path: backup_path.to_string_lossy().to_string(),
        created_at,
        size_bytes: meta.len(),
    })
}

/// List existing backups.
pub fn list_backups(backup_dir: &Path) -> Result<Vec<BackupEntry>> {
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in std::fs::read_dir(backup_dir)? {
        let entry = entry?;
        let path = entry.path();
        // Skip sidecar metadata files
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            continue;
        }
        if path.is_file() {
            let meta = std::fs::metadata(&path)?;
            let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();

            // Try to read sidecar metadata
            let sidecar_path = backup_dir.join(format!("{}.meta.json", file_name));
            let (source_path, label) = if sidecar_path.exists() {
                let sidecar_content = std::fs::read_to_string(&sidecar_path).unwrap_or_default();
                let sidecar: serde_json::Value = serde_json::from_str(&sidecar_content).unwrap_or_default();
                (
                    sidecar.get("source_path").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    sidecar.get("label").and_then(|v| v.as_str()).unwrap_or(&file_name).to_string(),
                )
            } else {
                (String::new(), file_name.clone())
            };

            entries.push(BackupEntry {
                id: uuid::Uuid::new_v4().to_string(),
                label,
                source_path,
                backup_path: path.to_string_lossy().to_string(),
                created_at: meta
                    .modified()
                    .ok()
                    .map(|t| {
                        chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339()
                    })
                    .unwrap_or_default(),
                size_bytes: meta.len(),
            });
        }
    }

    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

/// Delete a backup file and its sidecar metadata.
/// The backup_path must reside within the expected backup directory.
pub fn delete_backup(backup_path: &Path) -> Result<()> {
    if !backup_path.exists() {
        return Err(OrchestratorError::NotFound(format!(
            "Backup file not found: {}",
            backup_path.display()
        )));
    }

    // Validate path is within the backup directory
    let expected_dir = backup_dir()?;
    let canonical_backup = backup_path.canonicalize().map_err(|e| {
        OrchestratorError::Io(std::io::Error::new(std::io::ErrorKind::InvalidInput, e))
    })?;
    let canonical_dir = expected_dir.canonicalize().unwrap_or(expected_dir);
    if !canonical_backup.starts_with(&canonical_dir) {
        return Err(OrchestratorError::NotFound(
            "Path is outside the backup directory".to_string(),
        ));
    }

    // Remove the backup file
    std::fs::remove_file(backup_path)?;

    // Remove sidecar metadata if it exists
    let file_name = backup_path.file_name().unwrap_or_default().to_string_lossy();
    if let Some(parent) = backup_path.parent() {
        let sidecar_path = parent.join(format!("{}.meta.json", file_name));
        let _ = std::fs::remove_file(sidecar_path);
    }

    Ok(())
}

/// Restore a backup file to its original location.
pub fn restore_backup(backup_path: &Path, restore_to: &Path) -> Result<()> {
    if !backup_path.exists() {
        return Err(OrchestratorError::NotFound(format!(
            "Backup file not found: {}",
            backup_path.display()
        )));
    }

    if restore_to.as_os_str().is_empty() {
        return Err(OrchestratorError::NotFound(
            "Restore destination path is empty".to_string(),
        ));
    }

    // Atomic write
    if let Some(parent) = restore_to.parent() {
        std::fs::create_dir_all(parent)?;
        let temp_path = parent.join(format!(
            ".restore-tmp-{}",
            restore_to.file_name().unwrap_or_default().to_string_lossy()
        ));
        std::fs::copy(backup_path, &temp_path)?;
        std::fs::rename(&temp_path, restore_to)?;
    } else {
        std::fs::copy(backup_path, restore_to)?;
    }

    Ok(())
}

/// Preview what would change if a backup were restored.
/// Returns both the backup file content and the current file content.
pub fn preview_backup_restore(backup_path: &Path, source_path: &Path) -> Result<BackupDiffPreview> {
    let backup_content = std::fs::read_to_string(backup_path).map_err(|e| {
        OrchestratorError::Io(std::io::Error::new(
            e.kind(),
            format!("Cannot read backup file: {}", e),
        ))
    })?;
    let current_content = std::fs::read_to_string(source_path).unwrap_or_default();
    Ok(BackupDiffPreview {
        backup_content,
        current_content,
    })
}

/// Generate a diff between two files (for migration view).
pub fn diff_files(old_path: &Path, new_path: &Path) -> Result<ConfigDiff> {
    let old_content = std::fs::read_to_string(old_path).unwrap_or_default();
    let new_content = std::fs::read_to_string(new_path).unwrap_or_default();

    let diff = similar::TextDiff::from_lines(&old_content, &new_content);
    let diff_text = diff.unified_diff().header("old", "new").to_string();
    let has_changes = diff_text.lines().any(|l| l.starts_with('+') || l.starts_with('-'));

    let file_name = new_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    Ok(ConfigDiff {
        file_name,
        diff_text,
        has_changes,
    })
}

// ─── Internal helpers ─────────────────────────────────────────────

fn parse_agent_yaml(path: &Path) -> Result<Option<AgentDefinition>> {
    let content = std::fs::read_to_string(path)?;
    let value: serde_yaml::Value = serde_yaml::from_str(&content)?;

    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
        })
        .to_string();

    let model = value
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("default")
        .to_string();

    let description = value
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let tools = value
        .get("tools")
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| {
                    v.as_str()
                        .or_else(|| v.get("name").and_then(|n| n.as_str()))
                        .map(String::from)
                })
                .collect()
        })
        .unwrap_or_default();

    // Extract first ~200 chars of the prompt as excerpt
    let prompt_excerpt = value
        .get("instructions")
        .or_else(|| value.get("prompt"))
        .and_then(|v| v.as_str())
        .map(|s| {
            if s.len() > 200 {
                format!("{}…", &s[..200])
            } else {
                s.to_string()
            }
        })
        .unwrap_or_default();

    Ok(Some(AgentDefinition {
        name,
        file_path: path.to_string_lossy().to_string(),
        model,
        description,
        tools,
        prompt_excerpt,
        raw_yaml: content,
    }))
}

/// Get the backup directory for TracePilot config backups.
pub fn backup_dir() -> Result<PathBuf> {
    let home = crate::launcher::copilot_home()?;
    Ok(home.join("tracepilot").join("backups"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_diff_files_identical() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.yaml");
        let b = dir.path().join("b.yaml");
        fs::write(&a, "name: test\nmodel: opus").unwrap();
        fs::write(&b, "name: test\nmodel: opus").unwrap();

        let diff = diff_files(&a, &b).unwrap();
        assert!(!diff.has_changes);
    }

    #[test]
    fn test_diff_files_changed() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.yaml");
        let b = dir.path().join("b.yaml");
        fs::write(&a, "name: test\nmodel: opus").unwrap();
        fs::write(&b, "name: test\nmodel: sonnet").unwrap();

        let diff = diff_files(&a, &b).unwrap();
        assert!(diff.has_changes);
        assert!(diff.diff_text.contains("opus"));
        assert!(diff.diff_text.contains("sonnet"));
    }

    #[test]
    fn test_create_and_list_backups() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.yaml");
        fs::write(&file, "test content").unwrap();
        let backup_dir = dir.path().join("backups");

        let backup = create_backup(&file, &backup_dir, "test-label").unwrap();
        assert!(!backup.id.is_empty());
        assert!(backup.size_bytes > 0);

        let backups = list_backups(&backup_dir).unwrap();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn test_restore_backup() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.yaml");
        let backup = dir.path().join("backup.yaml");
        let restore_target = dir.path().join("restored.yaml");

        fs::write(&original, "original content").unwrap();
        fs::write(&backup, "backup content").unwrap();

        restore_backup(&backup, &restore_target).unwrap();
        assert_eq!(fs::read_to_string(&restore_target).unwrap(), "backup content");
    }

    #[test]
    fn test_write_agent_definition_validates_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.yaml");
        fs::write(&path, "original: true").unwrap();

        // Valid YAML should work
        let result = write_agent_definition(&path, "name: test\nmodel: opus\n");
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&path).unwrap(), "name: test\nmodel: opus\n");

        // Invalid YAML should fail
        let result = write_agent_definition(&path, "invalid: [yaml: broken:");
        assert!(result.is_err());
    }

    #[test]
    fn test_list_backups_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let nonexistent = dir.path().join("nonexistent");
        let result = list_backups(&nonexistent).unwrap();
        assert!(result.is_empty());
    }
}
