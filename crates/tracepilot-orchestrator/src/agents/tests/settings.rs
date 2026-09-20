use std::fs;

use serde_json::{Value, json};

use crate::agents::settings::{read_settings, set_disabled, set_override};
use crate::agents::types::SubagentOverride;

fn written(home: &std::path::Path) -> Value {
    serde_json::from_str(&fs::read_to_string(home.join("settings.json")).unwrap()).unwrap()
}

#[test]
fn reads_overrides_disabled_agents_and_session_defaults() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("settings.json"),
        json!({
            "model": "gpt-5.6-luna",
            "effortLevel": "high",
            "subagents": {
                "agents": {
                    "explore": {"model": "gpt-5.4-mini", "effortLevel": "low"},
                    "rubber-duck": {"model": "inherit", "autoInvoke": true}
                },
                "disabledSubagents": ["task"],
                "maxDepth": 4
            }
        })
        .to_string(),
    )
    .unwrap();

    let settings = read_settings(dir.path());
    assert!(settings.shape_error.is_none());
    assert_eq!(settings.session_model.as_deref(), Some("gpt-5.6-luna"));
    assert_eq!(settings.session_effort.as_deref(), Some("high"));
    assert_eq!(
        settings.overrides["explore"].model.as_deref(),
        Some("gpt-5.4-mini")
    );
    assert_eq!(
        settings.overrides["rubber-duck"].other_keys,
        vec!["autoInvoke"]
    );
    assert_eq!(settings.disabled, vec!["task"]);
    assert_eq!(settings.max_depth, Some(4));
}

#[test]
fn overrides_are_set_merged_and_reset_without_touching_other_settings() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("settings.json"),
        r#"{"footer":{"showAgent":true},"subagents":{"agents":{"rubber-duck":{"autoInvoke":true}}}}"#,
    )
    .unwrap();

    let luna = SubagentOverride {
        model: Some("gpt-5.6-luna".into()),
        effort_level: Some("high".into()),
        context_tier: Some("long_context".into()),
        other_keys: vec![],
    };
    set_override(dir.path(), "explore", Some(&luna)).unwrap();
    set_override(
        dir.path(),
        "rubber-duck",
        Some(&SubagentOverride {
            model: Some("inherit".into()),
            ..Default::default()
        }),
    )
    .unwrap();
    let value = written(dir.path());
    assert_eq!(value["footer"]["showAgent"], true);
    assert_eq!(
        value["subagents"]["agents"]["explore"],
        json!({"model": "gpt-5.6-luna", "effortLevel": "high", "contextTier": "long_context"})
    );
    assert_eq!(
        value["subagents"]["agents"]["rubber-duck"],
        json!({"autoInvoke": true, "model": "inherit"})
    );

    set_override(dir.path(), "explore", None).unwrap();
    set_override(dir.path(), "rubber-duck", None).unwrap();
    let value = written(dir.path());
    assert_eq!(
        value["subagents"]["agents"]["rubber-duck"],
        json!({"autoInvoke": true}),
        "unmanaged keys survive a reset"
    );
    assert!(value["subagents"]["agents"].get("explore").is_none());

    let bad_tier = SubagentOverride {
        context_tier: Some("huge".into()),
        ..Default::default()
    };
    assert!(set_override(dir.path(), "explore", Some(&bad_tier)).is_err());
}

#[test]
fn disabling_toggles_the_list_and_prunes_empty_blocks() {
    let dir = tempfile::tempdir().unwrap();
    set_disabled(dir.path(), "task", true).unwrap();
    set_disabled(dir.path(), "explore", true).unwrap();
    set_disabled(dir.path(), "task", true).unwrap();
    assert_eq!(
        written(dir.path())["subagents"]["disabledSubagents"],
        json!(["explore", "task"])
    );
    set_disabled(dir.path(), "task", false).unwrap();
    set_disabled(dir.path(), "explore", false).unwrap();
    assert!(written(dir.path()).get("subagents").is_none());
}

#[test]
fn unexpected_shapes_are_read_only_and_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let original = r#"{"subagents":{"agents":["explore"]}}"#;
    fs::write(dir.path().join("settings.json"), original).unwrap();

    let settings = read_settings(dir.path());
    assert!(settings.shape_error.is_some());
    assert!(settings.raw.is_some());
    assert!(set_disabled(dir.path(), "task", true).is_err());
    assert!(set_override(dir.path(), "task", None).is_err());
    assert_eq!(
        fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        original
    );

    fs::write(dir.path().join("settings.json"), "{broken").unwrap();
    assert!(read_settings(dir.path()).shape_error.is_some());
    assert!(set_disabled(dir.path(), "task", true).is_err());
}
