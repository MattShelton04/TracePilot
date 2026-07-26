use super::*;

#[test]
fn environment_copy_is_allowlisted_and_sanitizes_cli_state() {
    let root = tempfile::tempdir().expect("root");
    let source = root.path().join("source");
    let destination = root.path().join("destination");
    std::fs::create_dir_all(source.join("skills/demo")).expect("skill dir");
    std::fs::create_dir_all(source.join("session-state/session")).expect("session dir");
    std::fs::write(source.join("settings.json"), br#"{"model":"gpt-5"}"#).expect("settings");
    std::fs::write(source.join("skills/demo/SKILL.md"), b"instructions").expect("skill");
    std::fs::write(source.join("session-state/session/events.jsonl"), b"secret").expect("session");
    std::fs::write(
        source.join("config.json"),
        br#"{"trustedFolders":["C:/repo"],"loggedInUsers":["private"],"lastLoggedInUser":"private"}"#,
    )
    .expect("config");

    let copied = copy_environment_context(&source, &destination).expect("copy");

    assert!(copied > 0);
    assert!(destination.join("settings.json").is_file());
    assert!(destination.join("skills/demo/SKILL.md").is_file());
    assert!(!destination.join("session-state").exists());
    let config = std::fs::read_to_string(destination.join("config.json")).expect("read");
    assert!(config.contains("trustedFolders"));
    assert!(!config.contains("loggedInUsers"));
    assert!(!config.contains("private"));
    let first_hash = fingerprint_context_tree(&destination, "profile").expect("hash");
    std::fs::write(destination.join("settings.json"), br#"{"model":"gpt-5.1"}"#)
        .expect("change settings");
    let second_hash = fingerprint_context_tree(&destination, "profile").expect("hash");
    assert_ne!(first_hash, second_hash);
}

#[test]
fn environment_copy_accepts_copilot_jsonc_setup_state() {
    let root = tempfile::tempdir().expect("root");
    let source = root.path().join("source");
    let destination = root.path().join("destination");
    std::fs::create_dir_all(&source).expect("source");
    std::fs::write(
        source.join("config.json"),
        concat!(
            "// User settings belong in settings.json.\n",
            "// This file is managed by Copilot CLI.\n",
            "{\n",
            "  \"trustedFolders\": [\"C:\\\\repo\"],\n",
            "  \"loggedInUsers\": [\"private\"]\n",
            "}\n"
        ),
    )
    .expect("config");

    copy_environment_context(&source, &destination).expect("copy JSONC config");

    let copied: serde_json::Value = serde_json::from_slice(
        &std::fs::read(destination.join("config.json")).expect("read copied config"),
    )
    .expect("copied config is strict JSON");
    assert_eq!(copied["trustedFolders"], serde_json::json!(["C:\\repo"]));
    assert!(copied.get("loggedInUsers").is_none());
}

#[test]
fn environment_copy_reports_config_path_for_invalid_jsonc() {
    let root = tempfile::tempdir().expect("root");
    let source = root.path().join("source");
    let destination = root.path().join("destination");
    std::fs::create_dir_all(&source).expect("source");
    std::fs::write(source.join("config.json"), "// banner\n{not-json").expect("config");

    let error = copy_environment_context(&source, &destination).expect_err("invalid config");
    let message = error.to_string();
    assert!(message.contains("Copilot's temporary setup state"));
    assert!(message.contains("config.json"));
    assert!(message.contains("line 2"));
}

#[test]
fn setup_state_detection_flags_future_trust_and_terminal_keys() {
    assert!(looks_like_setup_state_key("trustedRepositories"));
    assert!(looks_like_setup_state_key("setupComplete"));
    assert!(looks_like_setup_state_key("terminalOnboarding"));
    assert!(!looks_like_setup_state_key("loggedInUsers"));
    assert!(!looks_like_setup_state_key("expAssignmentsCache"));
}

#[test]
fn capture_environment_allowlist_rejects_credentials_and_provider_configuration() {
    assert!(capture_environment_name_allowed(OsStr::new("PATH")));
    assert!(capture_environment_name_allowed(OsStr::new("TEMP")));
    assert!(!capture_environment_name_allowed(OsStr::new(
        "OPENROUTER_API_KEY"
    )));
    assert!(!capture_environment_name_allowed(OsStr::new(
        "AZURE_OPENAI_API_KEY"
    )));
    assert!(!capture_environment_name_allowed(OsStr::new(
        "COPILOT_PROVIDER_BASE_URL"
    )));
    assert!(!capture_environment_name_allowed(OsStr::new("HTTP_PROXY")));
}

#[test]
fn canonical_repository_path_is_suitable_for_display() {
    let root = tempfile::tempdir().expect("root");
    let canonical =
        canonicalize_repository(root.path().to_string_lossy().as_ref()).expect("canonical");
    assert!(canonical.is_absolute());
    #[cfg(windows)]
    assert!(
        !canonical.to_string_lossy().starts_with(r"\\?\"),
        "display path retained the Windows verbatim prefix: {}",
        canonical.display()
    );
}
