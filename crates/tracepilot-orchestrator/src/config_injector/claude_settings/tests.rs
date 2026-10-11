use super::*;

const FILE: &str = "settings.json";

/// Run the raise against a temp Claude folder holding `contents` (or no
/// file), returning the outcome and the file's text afterwards.
fn raise_with(contents: Option<&str>, days: u32) -> (Result<CleanupPeriodRaise>, Option<String>) {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(FILE);
    if let Some(contents) = contents {
        std::fs::write(&path, contents).unwrap();
    }
    let outcome = raise_claude_cleanup_period(&path, days);
    (outcome, std::fs::read_to_string(&path).ok())
}

fn written(contents: Option<&str>, days: u32) -> String {
    let (outcome, after) = raise_with(contents, days);
    assert_eq!(outcome.unwrap(), CleanupPeriodRaise::Written);
    after.unwrap()
}

fn refusal(contents: Option<&str>, days: u32) -> String {
    let (outcome, after) = raise_with(contents, days);
    assert_eq!(
        after.as_deref(),
        contents,
        "the file must be left unchanged"
    );
    match outcome.unwrap_err() {
        OrchestratorError::Config(message) => message,
        other => panic!("unexpected error: {other:?}"),
    }
}

#[test]
fn a_missing_key_is_appended_in_the_files_own_style() {
    let pretty = "{\n  \"model\": \"opus\",\n  \"env\": {\n    \"A\": \"1\"\n  }\n}\n";
    assert_eq!(
        written(Some(pretty), 3650),
        "{\n  \"model\": \"opus\",\n  \"env\": {\n    \"A\": \"1\"\n  },\n  \"cleanupPeriodDays\": 3650\n}\n"
    );
    assert_eq!(
        written(Some(r#"{"model":"opus"}"#), 3650),
        r#"{"model":"opus","cleanupPeriodDays":3650}"#
    );
    assert_eq!(
        written(Some("{\r\n\t\"model\" : \"opus\"\r\n}\r\n"), 90),
        "{\r\n\t\"model\" : \"opus\",\r\n\t\"cleanupPeriodDays\" : 90\r\n}\r\n"
    );
}

#[test]
fn an_empty_object_gets_the_one_entry() {
    assert_eq!(
        written(Some("{}"), 3650),
        "{\n  \"cleanupPeriodDays\": 3650\n}"
    );
    assert_eq!(
        written(Some("{ }\r\n"), 3650),
        "{\r\n  \"cleanupPeriodDays\": 3650\r\n}\r\n"
    );
}

#[test]
fn a_lower_value_is_replaced_in_place() {
    let before = "{\n  \"cleanupPeriodDays\": 30,\n  \"theme\": \"dark\"\n}\n";
    assert_eq!(
        written(Some(before), 3650),
        "{\n  \"cleanupPeriodDays\": 3650,\n  \"theme\": \"dark\"\n}\n"
    );
    assert_eq!(
        written(Some(r#"{"a":1,"cleanupPeriodDays":0}"#), 365),
        r#"{"a":1,"cleanupPeriodDays":365}"#
    );
    // Not a usable number of days, so Claude Code may reject it anyway.
    for value in ["null", r#""9999""#, "-3", "7.5", "[30]", "{\"days\":9999}"] {
        let before = format!("{{\"cleanupPeriodDays\": {value}, \"b\": true}}");
        assert_eq!(
            written(Some(&before), 3650),
            r#"{"cleanupPeriodDays": 3650, "b": true}"#,
            "{value}"
        );
    }
}

#[test]
fn a_value_already_as_long_is_never_lowered() {
    for (contents, current) in [
        (r#"{"cleanupPeriodDays":3650}"#, 3650),
        (r#"{"cleanupPeriodDays":99999}"#, 99_999),
        (r#"{"cleanupPeriodDays":4000.0}"#, 4000),
    ] {
        let (outcome, after) = raise_with(Some(contents), 3650);
        assert_eq!(
            outcome.unwrap(),
            CleanupPeriodRaise::AlreadyAtLeast(current)
        );
        assert_eq!(after.as_deref(), Some(contents));
    }
}

#[test]
fn a_missing_file_is_created() {
    assert_eq!(written(None, 3650), "{\n  \"cleanupPeriodDays\": 3650\n}\n");
}

#[test]
fn a_missing_folder_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("absent").join(FILE);
    let error = raise_claude_cleanup_period(&path, 3650).unwrap_err();
    assert!(
        error.to_string().contains("folder doesn't exist"),
        "{error}"
    );
    assert!(!temp.path().join("absent").exists());
}

#[test]
fn a_malformed_file_is_never_clobbered() {
    for contents in [
        "",
        "{",
        "[1,2]",
        "30",
        "// comment\n{}",
        r#"{"cleanupPeriodDays":30,}"#,
        r#"{"cleanupPeriodDays":30} trailing"#,
    ] {
        let message = refusal(Some(contents), 3650);
        assert_eq!(
            message, "settings.json isn't valid JSON, so it was left unchanged.",
            "{contents:?}"
        );
    }
}

#[test]
fn a_repeated_key_is_refused() {
    let message = refusal(
        Some(r#"{"cleanupPeriodDays":7,"cleanupPeriodDays":9}"#),
        3650,
    );
    assert!(message.contains("more than once"), "{message}");
    // An escaped spelling is the same key.
    let message = refusal(
        Some(r#"{"cleanupPeriodDays":7,"cleanupPeriodDays":9}"#),
        3650,
    );
    assert!(message.contains("more than once"), "{message}");
}

#[test]
fn only_the_top_level_key_counts() {
    let before = r#"{"env":{"cleanupPeriodDays":"x"},"note":"\"cleanupPeriodDays\": 1}","k":[{"cleanupPeriodDays":2}]}"#;
    assert_eq!(
        written(Some(before), 3650),
        r#"{"env":{"cleanupPeriodDays":"x"},"note":"\"cleanupPeriodDays\": 1}","k":[{"cleanupPeriodDays":2}],"cleanupPeriodDays":3650}"#
    );
}

#[test]
fn a_byte_order_mark_is_kept() {
    assert_eq!(
        written(Some("\u{FEFF}{\"cleanupPeriodDays\": 30}"), 3650),
        "\u{FEFF}{\"cleanupPeriodDays\": 3650}"
    );
}

#[test]
fn out_of_range_days_are_refused() {
    for days in [0, MAX_CLEANUP_PERIOD_DAYS + 1, u32::MAX] {
        let message = refusal(Some("{}"), days);
        assert!(message.contains("from 1 to 36500"), "{message}");
    }
    assert_eq!(
        written(Some("{}"), MAX_CLEANUP_PERIOD_DAYS),
        "{\n  \"cleanupPeriodDays\": 36500\n}"
    );
}

#[test]
fn unusual_files_are_refused() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(FILE);
    std::fs::create_dir(&path).unwrap();
    let error = raise_claude_cleanup_period(&path, 3650).unwrap_err();
    assert!(
        error.to_string().contains("isn't a regular file"),
        "{error}"
    );

    let mut oversized = br#"{"pad":""#.to_vec();
    oversized.resize(MAX_SETTINGS_BYTES as usize + 1, b' ');
    oversized.extend_from_slice(br#""}"#);
    let oversized = String::from_utf8(oversized).unwrap();
    assert!(refusal(Some(&oversized), 3650).contains("larger than 1 MiB"));

    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(FILE);
    std::fs::write(&path, [0xFF, 0xFE, b'{', b'}']).unwrap();
    assert!(raise_claude_cleanup_period(&path, 3650).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), [0xFF, 0xFE, b'{', b'}']);
}

#[test]
fn a_read_only_file_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(FILE);
    std::fs::write(&path, "{}").unwrap();
    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&path, permissions.clone()).unwrap();
    let error = raise_claude_cleanup_period(&path, 3650).unwrap_err();
    assert!(error.to_string().contains("read-only"), "{error}");
    #[allow(clippy::permissions_set_readonly_false)]
    permissions.set_readonly(false);
    std::fs::set_permissions(&path, permissions).unwrap();
}

#[test]
fn nothing_else_is_left_in_the_folder() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(FILE);
    std::fs::write(&path, r#"{"a":1}"#).unwrap();
    std::fs::write(temp.path().join("settings.json.bak"), "mine").unwrap();
    raise_claude_cleanup_period(&path, 3650).unwrap();
    let mut names: Vec<_> = std::fs::read_dir(temp.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    names.sort();
    assert_eq!(names, ["settings.json", "settings.json.bak"]);
    assert_eq!(
        std::fs::read_to_string(temp.path().join("settings.json.bak")).unwrap(),
        "mine"
    );
}

#[cfg(unix)]
#[test]
fn the_files_permissions_are_kept() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join(FILE);
    std::fs::write(&path, "{}").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    raise_claude_cleanup_period(&path, 3650).unwrap();
    let mode = std::fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o644);
}
