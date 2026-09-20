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

#[test]
fn local_skill_toggle_preserves_settings_and_refuses_bad_data() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(".github/copilot/settings.local.json");
    set_local_skill_enabled(temp.path(), "review", false).unwrap();
    assert_eq!(read_disabled_skills_file(&path).unwrap(), vec!["review"]);
    std::fs::write(
        &path,
        r#"{"disabledSkills":["REVIEW","other"],"model":"preserved"}"#,
    )
    .unwrap();
    set_local_skill_enabled(temp.path(), "review", true).unwrap();
    let value = read_json_file(&path).unwrap().unwrap();
    assert_eq!(value["model"], "preserved");
    assert_eq!(value["disabledSkills"], serde_json::json!(["other"]));
    for invalid in [r#"{"disabledSkills":[1]}"#, "[]", "{broken"] {
        std::fs::write(&path, invalid).unwrap();
        assert!(set_local_skill_enabled(temp.path(), "review", false).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), invalid);
    }
}
