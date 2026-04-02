//! File-based CRUD for task presets.
//!
//! Presets are stored as individual JSON files in `~/.copilot/tracepilot/task-presets/`.
//! Follows the same pattern as `templates.rs` for file-based config management.

use crate::error::{OrchestratorError, Result};
use crate::json_io;
use std::path::{Path, PathBuf};

use super::types::TaskPreset;

/// Maximum size for a single preset JSON file (1 MB).
const MAX_PRESET_SIZE: u64 = 1_048_576;

/// Default presets storage directory.
pub fn presets_dir() -> Result<PathBuf> {
    let home = crate::launcher::copilot_home()?;
    let dir = home.join("tracepilot").join("task-presets");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Validate a preset ID to prevent path traversal.
fn validate_preset_id(id: &str) -> Result<()> {
    crate::validation::validate_identifier(
        id,
        crate::validation::TEMPLATE_ID_RULES,
        "Preset ID",
    )
    .map_err(OrchestratorError::Preset)
}

/// Path to a preset file.
fn preset_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

/// List all presets in the directory.
pub fn list_presets(dir: &Path) -> Result<Vec<TaskPreset>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut presets = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.extension().is_some_and(|e| e == "json") {
            let metadata = entry.metadata()?;
            if metadata.len() > MAX_PRESET_SIZE {
                tracing::warn!(
                    path = %path.display(),
                    size = metadata.len(),
                    "Skipping oversized preset file"
                );
                continue;
            }

            match json_io::atomic_json_read_opt::<TaskPreset>(&path) {
                Ok(Some(preset)) => presets.push(preset),
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!(
                        path = %path.display(),
                        error = %e,
                        "Failed to read preset file, skipping"
                    );
                }
            }
        }
    }

    presets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(presets)
}

/// Get a single preset by ID.
pub fn get_preset(dir: &Path, id: &str) -> Result<TaskPreset> {
    validate_preset_id(id)?;
    let path = preset_path(dir, id);
    json_io::atomic_json_read_opt::<TaskPreset>(&path)?.ok_or_else(|| {
        OrchestratorError::NotFound(format!("Preset not found: {id}"))
    })
}

/// Save (create or update) a preset.
pub fn save_preset(dir: &Path, preset: &TaskPreset) -> Result<()> {
    validate_preset_id(&preset.id)?;
    let path = preset_path(dir, &preset.id);
    json_io::atomic_json_write(&path, preset)
}

/// Delete a preset by ID.
pub fn delete_preset(dir: &Path, id: &str) -> Result<()> {
    validate_preset_id(id)?;
    let path = preset_path(dir, id);
    if !path.exists() {
        return Err(OrchestratorError::NotFound(format!(
            "Preset not found: {id}"
        )));
    }
    std::fs::remove_file(&path)?;
    Ok(())
}

/// Check if a preset exists.
pub fn preset_exists(dir: &Path, id: &str) -> bool {
    preset_path(dir, id).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::presets::types::*;
    use tempfile::TempDir;

    fn make_preset(id: &str) -> TaskPreset {
        let now = chrono::Utc::now().to_rfc3339();
        TaskPreset {
            id: id.to_string(),
            name: format!("Test Preset {id}"),
            description: "A test preset".to_string(),
            version: 1,
            prompt: PresetPrompt {
                system: "You are a helpful assistant.".to_string(),
                user: "Summarise session {{session_id}}".to_string(),
                variables: vec![PromptVariable {
                    name: "session_id".to_string(),
                    var_type: VariableType::SessionRef,
                    required: true,
                    description: "The session to summarise".to_string(),
                    default: None,
                }],
            },
            context: PresetContext {
                sources: vec![ContextSource {
                    id: "session-export".to_string(),
                    source_type: ContextSourceType::SessionExport,
                    label: Some("Session Export".to_string()),
                    required: true,
                    config: serde_json::json!({"format": "markdown"}),
                }],
                max_chars: 50_000,
                format: ContextFormat::Markdown,
            },
            output: PresetOutput {
                schema: serde_json::json!({"type": "object"}),
                format: OutputFormat::Json,
                validation: ValidationMode::Warn,
            },
            execution: PresetExecution::default(),
            tags: vec!["summary".to_string()],
            enabled: true,
            builtin: false,
            created_at: now.clone(),
            updated_at: now,
        }
    }

    #[test]
    fn test_preset_crud() {
        let dir = TempDir::new().unwrap();
        let presets_path = dir.path().join("presets");
        std::fs::create_dir_all(&presets_path).unwrap();

        let preset = make_preset("test-preset");
        save_preset(&presets_path, &preset).unwrap();

        assert!(preset_exists(&presets_path, "test-preset"));

        let loaded = get_preset(&presets_path, "test-preset").unwrap();
        assert_eq!(loaded.id, "test-preset");
        assert_eq!(loaded.name, "Test Preset test-preset");

        let all = list_presets(&presets_path).unwrap();
        assert_eq!(all.len(), 1);

        delete_preset(&presets_path, "test-preset").unwrap();
        assert!(!preset_exists(&presets_path, "test-preset"));
    }

    #[test]
    fn test_invalid_preset_id() {
        let dir = TempDir::new().unwrap();
        let result = get_preset(dir.path(), "../../../etc/passwd");
        assert!(result.is_err());
    }
}
