//! Copilot CLI user-settings I/O.
//!
//! Copilot CLI history (2026-04): user settings moved from
//! `~/.copilot/config.json` into `~/.copilot/settings.json`. `config.json`
//! is now CLI-managed internal state and begins with `//` line comments,
//! which are not valid JSON.
//!
//! `read_copilot_config` reads BOTH files (settings.json wins on conflict)
//! and tolerates `//` comments. Writes always target `settings.json` —
//! `config.json` is never modified.

use std::path::Path;
use std::sync::Mutex;

use tracepilot_core::paths::CopilotPaths;

use crate::error::{OrchestratorError, Result};
use crate::types::CopilotConfig;

/// Name of the user-settings file introduced by Copilot CLI in 2026-04.
/// Older versions kept user settings in `config.json`.
pub const SETTINGS_FILE: &str = tracepilot_core::paths::COPILOT_SETTINGS_FILE;
pub const CONFIG_FILE: &str = tracepilot_core::paths::COPILOT_CONFIG_FILE;

/// Keys that TracePilot considers user-editable. These are the only keys we
/// will write into `settings.json` from the global config tab. Everything
/// else (loggedInUsers, askedSetupTerminals, firstLaunchAt, …) is preserved
/// untouched by merging on top of the existing file.
const USER_EDITABLE_KEYS: &[&str] = &[
    "model",
    "reasoningEffort",
    "showReasoning",
    "renderMarkdown",
    "trustedFolders",
    "disabledSkills",
];

static SETTINGS_WRITE_LOCK: once_cell::sync::Lazy<Mutex<()>> =
    once_cell::sync::Lazy::new(|| Mutex::new(()));

/// Strip full-line `//` comments from a JSON-with-comments document.
///
/// Recent Copilot CLI versions prepend a `// User settings belong in
/// settings.json.` banner to `config.json`, which is not valid JSON. We only
/// strip lines whose first non-whitespace characters are `//` to keep the
/// transformation conservative — string contents are never touched because
/// JSON strings cannot legally start a line outside of an object/array.
pub(crate) fn strip_jsonc_line_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for line in input.split_inclusive('\n') {
        if line.trim_start().starts_with("//") {
            // Preserve the trailing newline so line numbers in any
            // downstream parse error remain accurate.
            if line.ends_with('\n') {
                out.push('\n');
            }
        } else {
            out.push_str(line);
        }
    }
    out
}

/// Parse a Copilot config/settings file from disk, tolerating `//` line
/// comments. Returns `Ok(None)` if the file does not exist, and an
/// `Err(message)` with file context if the file exists but cannot be parsed.
pub(crate) fn read_json_file(
    path: &Path,
) -> std::result::Result<Option<serde_json::Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let cleaned = strip_jsonc_line_comments(&raw);
    if cleaned.trim().is_empty() {
        return Ok(Some(serde_json::Value::Object(serde_json::Map::new())));
    }
    serde_json::from_str::<serde_json::Value>(&cleaned)
        .map(Some)
        .map_err(|e| format!("Failed to parse {} as JSON: {}", path.display(), e))
}

fn merge_objects(
    base: &mut serde_json::Map<String, serde_json::Value>,
    overlay: &serde_json::Value,
) {
    if let Some(obj) = overlay.as_object() {
        for (k, v) in obj {
            base.insert(k.clone(), v.clone());
        }
    }
}

/// Read the global Copilot CLI config, merging `settings.json` (preferred)
/// on top of `config.json` (legacy).
///
/// On parse failure of either file the function does NOT error — it returns
/// a `CopilotConfig` with `parse_error` populated, allowing the UI to
/// surface a banner and disable destructive operations rather than crashing
/// with an opaque "expected value at line 1 column 1" message.
pub fn read_copilot_config(copilot_home: &Path) -> Result<CopilotConfig> {
    let cp = CopilotPaths::from_home(copilot_home);
    let settings_path = cp.settings_json();
    let config_path = cp.config_json();
    let settings_path_str = settings_path.to_string_lossy().to_string();

    let mut errors: Vec<String> = Vec::new();
    let config_value = match read_json_file(&config_path) {
        Ok(v) => v,
        Err(msg) => {
            errors.push(msg);
            None
        }
    };
    let settings_value = match read_json_file(&settings_path) {
        Ok(v) => v,
        Err(msg) => {
            errors.push(msg);
            None
        }
    };

    // Merge config.json (legacy) under settings.json (preferred).
    let mut merged = serde_json::Map::new();
    if let Some(v) = config_value.as_ref() {
        merge_objects(&mut merged, v);
    }
    if let Some(v) = settings_value.as_ref() {
        merge_objects(&mut merged, v);
    }
    let raw = serde_json::Value::Object(merged);

    let parse_error = if errors.is_empty() {
        None
    } else {
        Some(errors.join("; "))
    };

    Ok(CopilotConfig {
        model: raw.get("model").and_then(|v| v.as_str()).map(String::from),
        reasoning_effort: raw
            .get("reasoningEffort")
            .and_then(|v| v.as_str())
            .map(String::from),
        show_reasoning: raw.get("showReasoning").and_then(|v| v.as_bool()),
        render_markdown: raw.get("renderMarkdown").and_then(|v| v.as_bool()),
        disabled_skills: raw
            .get("disabledSkills")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
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
        settings_path: settings_path_str,
        parse_error,
    })
}

/// Write the user-editable subset of Copilot config to `settings.json`.
///
/// Behaviour:
/// * Preserves any keys we don't manage (loggedInUsers, askedSetupTerminals,
///   firstLaunchAt, …) by reading the existing file and merging.
/// * Refuses to write if `settings.json` exists but is unparseable —
///   writing would silently destroy the user's data. The caller should
///   ensure `parse_error` is clear before invoking save.
/// * Atomic via temp-file + rename.
pub fn write_copilot_config(copilot_home: &Path, config: &serde_json::Value) -> Result<()> {
    let _guard = SETTINGS_WRITE_LOCK.lock().map_err(|_| {
        OrchestratorError::Config("Copilot settings write lock was poisoned".into())
    })?;
    write_copilot_config_unlocked(copilot_home, config)
}

fn write_copilot_config_unlocked(copilot_home: &Path, config: &serde_json::Value) -> Result<()> {
    let cp = CopilotPaths::from_home(copilot_home);
    let settings_path = cp.settings_json();

    // Load the existing settings.json so unknown keys survive the
    // round-trip. If it's missing we start from `{}`. If it's present but
    // unparseable we refuse to write rather than clobbering user data.
    let existing = match read_json_file(&settings_path) {
        Ok(Some(v)) => v,
        Ok(None) => serde_json::Value::Object(serde_json::Map::new()),
        Err(msg) => {
            return Err(OrchestratorError::Config(format!(
                "Refusing to write Copilot settings: {}",
                msg
            )));
        }
    };

    let incoming = config.as_object().ok_or_else(|| {
        OrchestratorError::Config("Copilot settings payload must be a JSON object".into())
    })?;

    let mut merged = existing.as_object().cloned().unwrap_or_default();
    for (k, v) in incoming {
        if !USER_EDITABLE_KEYS.contains(&k.as_str()) {
            // Silently ignore keys outside the allow-list so the frontend
            // can never accidentally overwrite internal state.
            continue;
        }
        // Treat null / empty-string as "unset": remove rather than persisting.
        if v.is_null() {
            merged.remove(k);
            continue;
        }
        if let Some(s) = v.as_str()
            && s.is_empty()
        {
            merged.remove(k);
            continue;
        }
        merged.insert(k.clone(), v.clone());
    }

    crate::json_io::atomic_json_write(&settings_path, &serde_json::Value::Object(merged))?;
    Ok(())
}

/// Add or remove one skill from the user-level `disabledSkills` setting.
/// The read-modify-write is serialized and preserves all unrelated settings.
pub fn set_skill_enabled(copilot_home: &Path, skill_name: &str, enabled: bool) -> Result<()> {
    let _guard = SETTINGS_WRITE_LOCK.lock().map_err(|_| {
        OrchestratorError::Config("Copilot settings write lock was poisoned".into())
    })?;
    let settings_path = CopilotPaths::from_home(copilot_home).settings_json();
    let settings = read_json_file(&settings_path).map_err(OrchestratorError::Config)?;
    let setting_present = settings
        .as_ref()
        .and_then(|value| value.get("disabledSkills"))
        .is_some();
    if let Some(value) = settings
        .as_ref()
        .and_then(|value| value.get("disabledSkills"))
        && !value
            .as_array()
            .is_some_and(|entries| entries.iter().all(serde_json::Value::is_string))
    {
        return Err(OrchestratorError::Config(format!(
            "Refusing to update {}: disabledSkills must be an array of strings",
            settings_path.display()
        )));
    }

    let config = read_copilot_config(copilot_home)?;
    let mut disabled = config.disabled_skills;
    if enabled {
        let had_match = disabled
            .iter()
            .any(|name| name.eq_ignore_ascii_case(skill_name));
        if !had_match && !setting_present {
            return Ok(());
        }
        disabled.retain(|name| !name.eq_ignore_ascii_case(skill_name));
    } else if !disabled
        .iter()
        .any(|name| name.eq_ignore_ascii_case(skill_name))
    {
        disabled.push(skill_name.to_string());
    }
    disabled.sort_by_key(|name| name.to_lowercase());
    write_copilot_config_unlocked(
        copilot_home,
        &serde_json::json!({ "disabledSkills": disabled }),
    )
}

/// Read `disabledSkills` from one settings file, validating its complete shape.
pub fn read_disabled_skills_file(settings_path: &Path) -> Result<Vec<String>> {
    let Some(settings) = read_json_file(settings_path).map_err(OrchestratorError::Config)? else {
        return Ok(Vec::new());
    };
    let Some(value) = settings.get("disabledSkills") else {
        return Ok(Vec::new());
    };
    let entries = value.as_array().ok_or_else(|| {
        OrchestratorError::Config(format!(
            "Invalid {}: disabledSkills must be an array of strings",
            settings_path.display()
        ))
    })?;
    entries
        .iter()
        .map(|entry| {
            entry.as_str().map(String::from).ok_or_else(|| {
                OrchestratorError::Config(format!(
                    "Invalid {}: disabledSkills must contain only strings",
                    settings_path.display()
                ))
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn strip_jsonc_drops_full_line_comments() {
        let input = "// banner\n// second\n{\n  \"a\": 1\n}\n";
        let out = strip_jsonc_line_comments(input);
        // Comments removed but newlines preserved so error line numbers match.
        assert_eq!(out, "\n\n{\n  \"a\": 1\n}\n");
        let parsed: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["a"], 1);
    }

    #[test]
    fn read_copilot_config_handles_jsonc_config_json() {
        let dir = tempfile::tempdir().unwrap();
        // Reproduces the new CLI's `config.json` shape (leading `//` lines).
        fs::write(
            dir.path().join("config.json"),
            "// User settings belong in settings.json.\n// This file is managed automatically.\n{\n  \"trustedFolders\": [\"C:\\\\git\"]\n}\n",
        )
        .unwrap();
        let cfg = read_copilot_config(dir.path()).unwrap();
        assert!(cfg.parse_error.is_none(), "got: {:?}", cfg.parse_error);
        assert_eq!(cfg.trusted_folders, vec!["C:\\git".to_string()]);
    }

    #[test]
    fn read_copilot_config_prefers_settings_over_config() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("config.json"),
            "{\"model\":\"old-model\",\"trustedFolders\":[\"/a\"]}",
        )
        .unwrap();
        fs::write(
            dir.path().join("settings.json"),
            "{\"model\":\"new-model\",\"showReasoning\":true,\"renderMarkdown\":false}",
        )
        .unwrap();
        let cfg = read_copilot_config(dir.path()).unwrap();
        assert_eq!(cfg.model.as_deref(), Some("new-model"));
        assert_eq!(cfg.show_reasoning, Some(true));
        assert_eq!(cfg.render_markdown, Some(false));
        // Legacy key from config.json still surfaces when settings.json
        // doesn't override it.
        assert_eq!(cfg.trusted_folders, vec!["/a".to_string()]);
    }

    #[test]
    fn read_copilot_config_reports_parse_error_instead_of_failing() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "{not-json").unwrap();
        let cfg = read_copilot_config(dir.path()).unwrap();
        let err = cfg.parse_error.expect("should populate parse_error");
        assert!(err.contains("settings.json"), "got: {err}");
    }

    #[test]
    fn write_copilot_config_writes_to_settings_json_and_preserves_unknown_keys() {
        let dir = tempfile::tempdir().unwrap();
        // Pre-existing settings with unknown keys we must not clobber.
        fs::write(
            dir.path().join("settings.json"),
            "{\"loggedInUsers\":[{\"login\":\"alice\"}],\"model\":\"old\"}",
        )
        .unwrap();
        let payload = serde_json::json!({
            "model": "claude-opus-4.7",
            "showReasoning": true,
            "renderMarkdown": true,
            "trustedFolders": ["/a", "/b"],
            // not in allow-list — should be ignored:
            "loggedInUsers": [],
        });
        write_copilot_config(dir.path(), &payload).unwrap();

        let written: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(written["model"], "claude-opus-4.7");
        assert_eq!(written["showReasoning"], true);
        assert_eq!(written["trustedFolders"], serde_json::json!(["/a", "/b"]));
        // Unknown key preserved untouched.
        assert_eq!(written["loggedInUsers"][0]["login"], "alice");
    }

    #[test]
    fn write_copilot_config_refuses_when_existing_settings_unparseable() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "{not-json").unwrap();
        let payload = serde_json::json!({"model": "x"});
        let err = write_copilot_config(dir.path(), &payload).unwrap_err();
        assert!(matches!(err, OrchestratorError::Config(_)));
        // File untouched.
        assert_eq!(
            fs::read_to_string(dir.path().join("settings.json")).unwrap(),
            "{not-json"
        );
    }

    #[test]
    fn write_copilot_config_unsets_empty_string_values() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("settings.json"),
            "{\"model\":\"old\",\"reasoningEffort\":\"high\"}",
        )
        .unwrap();
        let payload = serde_json::json!({"model": "", "reasoningEffort": "low"});
        write_copilot_config(dir.path(), &payload).unwrap();
        let written: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join("settings.json")).unwrap())
                .unwrap();
        assert!(
            written.get("model").is_none(),
            "empty string should clear key"
        );
        assert_eq!(written["reasoningEffort"], "low");
    }

    #[test]
    fn set_skill_enabled_creates_updates_and_preserves_settings() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("settings.json"),
            r#"{"custom":{"keep":true},"disabledSkills":["Other","TEST"]}"#,
        )
        .unwrap();

        set_skill_enabled(dir.path(), "test", true).unwrap();
        set_skill_enabled(dir.path(), "new-skill", false).unwrap();
        set_skill_enabled(dir.path(), "NEW-SKILL", false).unwrap();

        let written: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.path().join("settings.json")).unwrap())
                .unwrap();
        assert_eq!(written["custom"]["keep"], true);
        assert_eq!(
            written["disabledSkills"],
            serde_json::json!(["new-skill", "Other"])
        );
    }

    #[test]
    fn set_skill_enabled_refuses_to_overwrite_malformed_settings() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("settings.json"), "{broken").unwrap();
        assert!(set_skill_enabled(dir.path(), "test", false).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("settings.json")).unwrap(),
            "{broken"
        );
    }

    #[test]
    fn set_skill_enabled_refuses_invalid_disabled_skills_shape() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("settings.json"),
            r#"{"disabledSkills":"test","custom":true}"#,
        )
        .unwrap();
        assert!(set_skill_enabled(dir.path(), "test", false).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("settings.json")).unwrap(),
            r#"{"disabledSkills":"test","custom":true}"#
        );
    }
}
