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
    let result = list_skills(&cfg, first.to_str()).unwrap();
    assert!(result.diagnostics.is_empty());
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
fn repository_disablement_takes_precedence_over_user_disablement() {
    let disabled = vec!["Review".into()];
    assert_eq!(
        disabled_reason("review", &disabled, &disabled),
        Some(SkillDisabledReason::Repository)
    );
    assert_eq!(
        disabled_reason("review", &disabled, &[]),
        Some(SkillDisabledReason::User)
    );
    assert_eq!(disabled_reason("testing", &disabled, &disabled), None);
}
