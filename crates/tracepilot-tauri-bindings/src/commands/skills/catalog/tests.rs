use super::*;
use tracepilot_orchestrator::RepoSource;

fn write_skill(root: &Path, marker: &str, name: &str) -> std::path::PathBuf {
    let directory = root.join(marker).join("skills").join(name);
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(
        directory.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: Test\n---\nInstructions"),
    )
    .unwrap();
    directory
}

#[test]
fn catalog_discovers_registered_projects_and_keeps_settings_local() {
    let temp = tempfile::tempdir().unwrap();
    let mut cfg = TracePilotConfig::default();
    cfg.paths.copilot_home = temp.path().join("copilot").to_string_lossy().into();
    cfg.paths.tracepilot_home = temp.path().join("tracepilot").to_string_lossy().into();
    let first = temp.path().join("first");
    let second = temp.path().join("second");
    let first_dir = write_skill(&first, ".github", "review");
    write_skill(&second, ".agents", "review");
    write_skill(&second, ".claude", "testing");
    for root in [&first, &second] {
        assert!(
            std::process::Command::new("git")
                .args(["init", "--quiet"])
                .arg(root)
                .status()
                .unwrap()
                .success()
        );
        tracepilot_orchestrator::repo_registry::add_repo_in(
            &cfg.tracepilot_home(),
            root.to_str().unwrap(),
            RepoSource::Manual,
        )
        .unwrap();
    }
    std::fs::create_dir_all(first.join(".github/copilot")).unwrap();
    std::fs::write(
        first.join(".github/copilot/settings.json"),
        r#"{"disabledSkills":["REVIEW"]}"#,
    )
    .unwrap();
    let mut result = list_skills(&cfg, first.to_str()).unwrap();
    // A machine without a discoverable CLI installation reports that as a
    // warning; nothing here should fail to load.
    assert!(
        result
            .diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity == "warning"),
        "unexpected load failures: {:?}",
        result.diagnostics
    );
    // The machine may also have packaged skills in its OS or npm cache. This
    // fixture tests repository discovery independently of those installations.
    result
        .skills
        .retain(|skill| skill.scope == SkillScope::Repository);
    assert_eq!(
        result.skills.len(),
        3,
        "Explicit and registered roots are deduplicated"
    );
    for skill in result.skills {
        assert_eq!(skill.scope, SkillScope::Repository);
        assert_eq!(
            skill.enabled,
            Path::new(&skill.directory).canonicalize().unwrap()
                != first_dir.canonicalize().unwrap()
        );
        tracepilot_orchestrator::skills::manager::validate_skill_dir(Path::new(&skill.directory))
            .unwrap();
        let mut enabled = true;
        let mut reason = None;
        apply_enablement(
            &mut enabled,
            &mut reason,
            &skill.name,
            Path::new(&skill.directory),
            &skill.scope,
            &cfg.copilot_home(),
        )
        .unwrap();
        assert_eq!(enabled, skill.enabled, "Editor and catalog agree");
        assert_eq!(reason, skill.disabled_reason);
    }
}

#[test]
fn personal_alternative_roots_toggle_user_settings() {
    const TEST_ROOT: &str = "TRACEPILOT_PERSONAL_SKILLS_TEST_ROOT";
    let Some(root) = std::env::var_os(TEST_ROOT) else {
        let temp = tempfile::tempdir().unwrap();
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "commands::skills::catalog::tests::personal_alternative_roots_toggle_user_settings",
                "--nocapture",
            ])
            .env(TEST_ROOT, temp.path())
            .env("COPILOT_HOME", temp.path().join(".copilot"))
            .env("COPILOT_SKILLS_DIRS", temp.path().join("custom-skills"))
            .env_remove("TRACEPILOT_DATA_ROOT")
            .env_remove("COPILOT_CLI_DIST_DIR")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    };
    let root = std::path::PathBuf::from(root);
    let copilot_home = root.join(".copilot");
    let alternative = write_skill(&root, ".agents", "alternative");
    let custom = root.join("custom-skills/custom");
    std::fs::create_dir_all(&custom).unwrap();
    std::fs::write(
        custom.join("SKILL.md"),
        "---\nname: custom\ndescription: Test\n---\nBody",
    )
    .unwrap();
    for directory in [&alternative, &custom] {
        let skill = tracepilot_orchestrator::skills::manager::get_skill(directory).unwrap();
        assert_eq!(skill.scope, SkillScope::Global);
        set_enabled(&copilot_home, directory, false).unwrap();
        assert!(
            read_copilot_config(&copilot_home)
                .unwrap()
                .disabled_skills
                .contains(&skill.frontmatter.name)
        );
        set_enabled(&copilot_home, directory, true).unwrap();
        assert!(
            read_copilot_config(&copilot_home)
                .unwrap()
                .disabled_skills
                .is_empty()
        );
    }
    assert!(
        !root.join(".github").exists(),
        "personal skills must not create project settings"
    );
}

#[test]
fn inherited_restrictions_cannot_be_overridden_locally() {
    let disabled = vec!["Review".into()];
    assert_eq!(
        disabled_reason("review", &disabled, &disabled, &disabled),
        Some(SkillDisabledReason::User)
    );
    assert_eq!(
        disabled_reason("review", &[], &disabled, &disabled),
        Some(SkillDisabledReason::Repository)
    );
    assert_eq!(
        disabled_reason("review", &[], &[], &disabled),
        Some(SkillDisabledReason::Local)
    );
    assert_eq!(
        disabled_reason("testing", &disabled, &disabled, &disabled),
        None
    );
}

#[test]
fn toggling_one_project_does_not_change_same_named_skill_in_another() {
    let temp = tempfile::tempdir().unwrap();
    let copilot_home = temp.path().join("copilot");
    let first = write_skill(&temp.path().join("first"), ".github", "review");
    let second = write_skill(&temp.path().join("second"), ".agents", "review");
    set_enabled(&copilot_home, &first, false).unwrap();
    for (dir, expected) in [(&first, false), (&second, true)] {
        let mut enabled = true;
        let mut reason = None;
        apply_enablement(
            &mut enabled,
            &mut reason,
            "review",
            dir,
            &SkillScope::Repository,
            &copilot_home,
        )
        .unwrap();
        assert_eq!(enabled, expected);
    }
    assert!(!copilot_home.join("settings.json").exists());
    set_enabled(&copilot_home, &first, true).unwrap();
    let root = skill_repository(&first).unwrap();
    assert!(
        read_disabled_skills_file(&root.join(".github/copilot/settings.local.json"))
            .unwrap()
            .is_empty()
    );
    tracepilot_orchestrator::config_injector::set_skill_enabled(&copilot_home, "review", false)
        .unwrap();
    assert!(set_enabled(&copilot_home, &first, true).is_err());
    assert_eq!(
        read_copilot_config(&copilot_home).unwrap().disabled_skills,
        vec!["review"]
    );
}
