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
///
/// **Note**: In the Tauri app, `TaskConfig::presets_dir()` from the user
/// config is used instead. This standalone helper is provided for
/// library / CLI usage only.
#[allow(dead_code)]
pub fn presets_dir() -> Result<PathBuf> {
    let home = crate::launcher::copilot_home()?;
    let dir = home.join("tracepilot").join("task-presets");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Validate a preset ID to prevent path traversal.
fn validate_preset_id(id: &str) -> Result<()> {
    crate::validation::validate_identifier(id, crate::validation::TEMPLATE_ID_RULES, "Preset ID")
        .map_err(OrchestratorError::Preset)
}

/// Path to a preset file.
fn preset_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

/// List all presets in the directory.
pub fn list_presets(dir: &Path) -> Result<Vec<TaskPreset>> {
    // Ensure built-in presets exist on first access
    if let Err(e) = seed_builtin_presets(dir) {
        tracing::warn!(error = %e, "Failed to seed built-in presets");
    }

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
    json_io::atomic_json_read_opt::<TaskPreset>(&path)?
        .ok_or_else(|| OrchestratorError::NotFound(format!("Preset not found: {id}")))
}

/// Save (create or update) a preset.
pub fn save_preset(dir: &Path, preset: &TaskPreset) -> Result<()> {
    validate_preset_id(&preset.id)?;
    let path = preset_path(dir, &preset.id);
    json_io::atomic_json_write(&path, preset)
}

/// Delete a preset by ID. Built-in presets cannot be deleted.
pub fn delete_preset(dir: &Path, id: &str) -> Result<()> {
    validate_preset_id(id)?;
    let path = preset_path(dir, id);
    if !path.exists() {
        return Err(OrchestratorError::NotFound(format!(
            "Preset not found: {id}"
        )));
    }
    // Prevent deletion of built-in presets (fail-safe: if we can't verify, refuse)
    match std::fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<super::types::TaskPreset>(&content) {
            Ok(preset) if preset.builtin => {
                return Err(OrchestratorError::Preset(
                    "Cannot delete built-in presets".into(),
                ));
            }
            Ok(_) => {} // not built-in, proceed
            Err(e) => {
                return Err(OrchestratorError::Preset(format!(
                    "Cannot verify preset is not built-in (parse error: {e})"
                )));
            }
        },
        Err(e) => {
            return Err(OrchestratorError::Preset(format!(
                "Cannot verify preset is not built-in (read error: {e})"
            )));
        }
    }
    std::fs::remove_file(&path)?;
    Ok(())
}

/// Check if a preset exists.
pub fn preset_exists(dir: &Path, id: &str) -> bool {
    preset_path(dir, id).exists()
}

/// Seed built-in presets if they don't already exist on disk.
/// Called lazily when presets are first listed.
pub fn seed_builtin_presets(dir: &Path) -> Result<()> {
    use super::types::*;
    std::fs::create_dir_all(dir)?;

    let builtins = vec![
        TaskPreset {
            id: "session-summary".to_string(),
            name: "Session Summary".to_string(),
            task_type: "session_summary".to_string(),
            description: "Generate an AI-powered summary of a Copilot CLI session, including key decisions, tool usage, and outcomes.".to_string(),
            version: 1,
            prompt: PresetPrompt {
                system: "You are an expert technical writer analysing GitHub Copilot CLI sessions. Produce a concise, structured summary.".to_string(),
                user: "Summarise the following Copilot CLI session. Include:\n1. **Objective** — what the user set out to do\n2. **Approach** — key steps, tools used, and decisions made\n3. **Outcome** — final result, files changed, and any open issues\n4. **Insights** — notable patterns, potential improvements\n\nSession data:\n{{session_export}}".to_string(),
                variables: vec![
                    PromptVariable {
                        name: "session_export".to_string(),
                        var_type: VariableType::SessionRef,
                        required: true,
                        description: "The session to summarise (exported as markdown)".to_string(),
                        default: None,
                    },
                ],
            },
            context: PresetContext {
                sources: vec![ContextSource {
                    id: "session-export".to_string(),
                    source_type: ContextSourceType::SessionExport,
                    label: Some("Session Export".to_string()),
                    required: true,
                    config: serde_json::json!({"format": "markdown"}),
                }],
                max_chars: 80_000,
                format: ContextFormat::Markdown,
            },
            output: PresetOutput {
                schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "objective": { "type": "string" },
                        "approach": { "type": "string" },
                        "outcome": { "type": "string" },
                        "insights": { "type": "string" },
                        "filesChanged": { "type": "array", "items": { "type": "string" } }
                    }
                }),
                format: OutputFormat::Markdown,
                validation: ValidationMode::Warn,
            },
            execution: PresetExecution {
                model_override: None,
                timeout_seconds: 120,
                max_retries: 2,
                priority: "normal".to_string(),
            },
            tags: vec!["summary".to_string(), "session".to_string(), "builtin".to_string()],
            enabled: true,
            builtin: true,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        },
        TaskPreset {
            id: "daily-digest".to_string(),
            name: "Daily Digest".to_string(),
            task_type: "digest".to_string(),
            description: "Summarise all Copilot CLI sessions from a specific day — activity, repositories, models used, and key outcomes.".to_string(),
            version: 4,
            prompt: PresetPrompt {
                system: "You are an expert technical analyst summarising daily developer activity from GitHub Copilot CLI sessions.".to_string(),
                user: "Produce a daily digest of the Copilot CLI sessions for {{target_date}}. The session data is provided in the context section below. Include:\n1. **Overview** — total sessions, turns, and repositories touched\n2. **Highlights** — most significant sessions and what they accomplished\n3. **Patterns** — recurring themes, tools, or workflows\n4. **Issues** — any failures, incidents, or areas of concern\n5. **Recommendations** — suggested improvements or follow-ups".to_string(),
                variables: vec![
                    PromptVariable {
                        name: "target_date".to_string(),
                        var_type: VariableType::Date,
                        required: false,
                        description: "The date to summarise (defaults to today)".to_string(),
                        default: None,
                    },
                ],
            },
            context: PresetContext {
                sources: vec![ContextSource {
                    id: "daily-sessions".to_string(),
                    source_type: ContextSourceType::MultiSessionDigest,
                    label: Some("Last 24 Hours".to_string()),
                    required: true,
                    config: serde_json::json!({
                        "window_hours": 24,
                        "max_sessions": 30,
                        "include_exports": false
                    }),
                }],
                max_chars: 80_000,
                format: ContextFormat::Markdown,
            },
            output: PresetOutput {
                schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "overview": { "type": "string" },
                        "highlights": { "type": "array", "items": { "type": "string" } },
                        "patterns": { "type": "string" },
                        "issues": { "type": "string" },
                        "recommendations": { "type": "array", "items": { "type": "string" } }
                    }
                }),
                format: OutputFormat::Markdown,
                validation: ValidationMode::Warn,
            },
            execution: PresetExecution {
                model_override: None,
                timeout_seconds: 180,
                max_retries: 2,
                priority: "normal".to_string(),
            },
            tags: vec!["digest".to_string(), "daily".to_string(), "builtin".to_string()],
            enabled: true,
            builtin: true,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        },
        TaskPreset {
            id: "weekly-digest".to_string(),
            name: "Weekly Digest".to_string(),
            task_type: "digest".to_string(),
            description: "Summarise all Copilot CLI sessions from a specific week — trends, productivity patterns, and cross-session insights.".to_string(),
            version: 4,
            prompt: PresetPrompt {
                system: "You are an expert technical analyst producing a weekly summary of developer activity from GitHub Copilot CLI sessions.".to_string(),
                user: "Produce a weekly digest of the Copilot CLI sessions for the week starting {{week_start_date}}. The session data is provided in the context section below. Include:\n1. **Week Overview** — total sessions, turns, repositories, and models used\n2. **Day-by-Day Summary** — brief highlights for each active day\n3. **Top Sessions** — the 3-5 most impactful sessions with outcomes\n4. **Trends** — how activity, tool usage, or patterns changed over the week\n5. **Issues & Incidents** — failures, rate limits, or recurring problems\n6. **Recommendations** — productivity tips based on observed patterns".to_string(),
                variables: vec![
                    PromptVariable {
                        name: "week_start_date".to_string(),
                        var_type: VariableType::Date,
                        required: false,
                        description: "The Monday of the week to summarise (defaults to this week)".to_string(),
                        default: None,
                    },
                ],
            },
            context: PresetContext {
                sources: vec![ContextSource {
                    id: "weekly-sessions".to_string(),
                    source_type: ContextSourceType::MultiSessionDigest,
                    label: Some("Last 7 Days".to_string()),
                    required: true,
                    config: serde_json::json!({
                        "window_hours": 168,
                        "max_sessions": 50,
                        "include_exports": false
                    }),
                }],
                max_chars: 150_000,
                format: ContextFormat::Markdown,
            },
            output: PresetOutput {
                schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "weekOverview": { "type": "string" },
                        "dayByDay": { "type": "array" },
                        "topSessions": { "type": "array" },
                        "trends": { "type": "string" },
                        "issues": { "type": "string" },
                        "recommendations": { "type": "array", "items": { "type": "string" } }
                    }
                }),
                format: OutputFormat::Markdown,
                validation: ValidationMode::Warn,
            },
            execution: PresetExecution {
                model_override: None,
                timeout_seconds: 240,
                max_retries: 2,
                priority: "normal".to_string(),
            },
            tags: vec!["digest".to_string(), "weekly".to_string(), "builtin".to_string()],
            enabled: true,
            builtin: true,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            updated_at: "2025-01-01T00:00:00Z".to_string(),
        },
    ];

    for preset in &builtins {
        let path = preset_path(dir, &preset.id);
        if !path.exists() {
            save_preset(dir, preset)?;
            tracing::info!(id = %preset.id, "Seeded built-in preset");
        } else {
            // Upgrade stale built-in presets when the code version is newer
            if let Ok(existing) = crate::json_io::atomic_json_read_opt::<TaskPreset>(&path) {
                if let Some(existing) = existing {
                    if existing.builtin && existing.version < preset.version {
                        save_preset(dir, preset)?;
                        tracing::info!(
                            id = %preset.id,
                            from_version = existing.version,
                            to_version = preset.version,
                            "Upgraded built-in preset"
                        );
                    }
                }
            }
        }
    }

    // Clean up removed built-in presets
    let removed_builtins = ["session-review"];
    for id in &removed_builtins {
        let path = preset_path(dir, id);
        if path.exists() {
            if let Ok(existing) = crate::json_io::atomic_json_read_opt::<TaskPreset>(&path) {
                if existing.map_or(false, |p| p.builtin) {
                    let _ = std::fs::remove_file(&path);
                    tracing::info!(id = %id, "Removed deprecated built-in preset");
                }
            }
        }
    }

    Ok(())
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
            task_type: "session_summary".to_string(),
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
        // 1 test preset + 3 seeded built-in presets
        assert_eq!(all.len(), 4);

        delete_preset(&presets_path, "test-preset").unwrap();
        assert!(!preset_exists(&presets_path, "test-preset"));

        // Built-ins remain
        let remaining = list_presets(&presets_path).unwrap();
        assert_eq!(remaining.len(), 3);
    }

    #[test]
    fn test_invalid_preset_id() {
        let dir = TempDir::new().unwrap();
        let result = get_preset(dir.path(), "../../../etc/passwd");
        assert!(result.is_err());
    }
}
