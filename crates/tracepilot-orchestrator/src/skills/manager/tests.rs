use super::*;
use tempfile::TempDir;

fn setup_skill(dir: &Path, name: &str) -> PathBuf {
    let skill_dir = dir.join(name);
    std::fs::create_dir_all(&skill_dir).unwrap();
    let content = format!("---\nname: {name}\ndescription: Test skill\n---\n\nBody text.\n");
    std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
    skill_dir
}

#[test]
fn update_skill_writes_valid_content() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill(dir.path(), "test-skill");

    let fm = SkillFrontmatter {
        name: "test-skill".into(),
        description: "Updated description".into(),
        argument_hint: None,
        allowed_tools: None,
        user_invocable: None,
        disable_model_invocation: None,
        resource_globs: vec!["*.rs".into()],
        auto_attach: true,
    };
    update_skill(&skill_dir, &fm, "New body").unwrap();

    let content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(content.contains("Updated description"));
    assert!(content.contains("New body"));
}

#[test]
fn update_skill_preserves_unknown_frontmatter_and_comments() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill(dir.path(), "preserved");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\n# keep\nname: preserved\ndescription: Old\nx-vendor: yes\n---\nOld body\n",
    )
    .unwrap();
    let fm = SkillFrontmatter {
        name: "preserved".into(),
        description: "New".into(),
        argument_hint: Some("[file]".into()),
        allowed_tools: None,
        user_invocable: None,
        disable_model_invocation: None,
        resource_globs: vec![],
        auto_attach: false,
    };

    update_skill(&skill_dir, &fm, "New body").unwrap();
    let content = std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(content.contains("# keep"));
    assert!(content.contains("x-vendor: yes"));
    assert!(content.contains("argument-hint: \"[file]\""));
    assert!(content.contains("New body"));
}

#[test]
fn update_nonexistent_skill_errors() {
    let dir = TempDir::new().unwrap();
    let fm = SkillFrontmatter {
        name: "ghost".into(),
        description: "desc".into(),
        argument_hint: None,
        allowed_tools: None,
        user_invocable: None,
        disable_model_invocation: None,
        resource_globs: vec![],
        auto_attach: false,
    };
    let result = update_skill(&dir.path().join("ghost"), &fm, "body");
    assert!(result.is_err());
}

#[test]
fn delete_skill_removes_directory() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill(dir.path(), "to-delete");
    assert!(skill_dir.exists());
    delete_skill(&skill_dir).unwrap();
    assert!(!skill_dir.exists());
}

#[test]
fn delete_nonexistent_errors() {
    let dir = TempDir::new().unwrap();
    let result = delete_skill(&dir.path().join("nonexistent"));
    assert!(result.is_err());
}

#[test]
fn rename_skill_updates_dir_and_content() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill(dir.path(), "old-name");

    let new_dir = rename_skill(&skill_dir, &SkillName::from_validated("new-name")).unwrap();
    assert!(!skill_dir.exists());
    assert!(new_dir.exists());

    let content = std::fs::read_to_string(new_dir.join("SKILL.md")).unwrap();
    assert!(content.contains("name: new-name"));
}

#[test]
fn rename_to_existing_errors() {
    let dir = TempDir::new().unwrap();
    setup_skill(dir.path(), "skill-a");
    let skill_b = setup_skill(dir.path(), "skill-b");

    let result = rename_skill(&skill_b, &SkillName::from_validated("skill-a"));
    assert!(result.is_err());

    // Verify original was NOT corrupted
    let content = std::fs::read_to_string(skill_b.join("SKILL.md")).unwrap();
    assert!(
        content.contains("name: skill-b"),
        "original skill-b should be intact"
    );
}

#[test]
fn rename_rejects_path_traversal() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill(dir.path(), "safe-skill");
    assert!(rename_skill(&skill_dir, &SkillName::from_validated("../escape")).is_err());
    assert!(rename_skill(&skill_dir, &SkillName::from_validated("foo/bar")).is_err());
    assert!(rename_skill(&skill_dir, &SkillName::from_validated("")).is_err());
}

#[test]
fn duplicate_rejects_path_traversal() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill(dir.path(), "original-safe");
    assert!(duplicate_skill(&skill_dir, &SkillName::from_validated("../escape")).is_err());
    assert!(duplicate_skill(&skill_dir, &SkillName::from_validated("foo\\bar")).is_err());
}

#[test]
fn duplicate_skill_creates_independent_copy() {
    let dir = TempDir::new().unwrap();
    let original = setup_skill(dir.path(), "original");
    std::fs::write(original.join("helper.py"), "# helper script").unwrap();

    let copy = duplicate_skill(&original, &SkillName::from_validated("copy")).unwrap();
    assert!(copy.exists());
    assert!(copy.join("SKILL.md").exists());
    assert!(copy.join("helper.py").exists());

    // Verify the copy has updated name
    let content = std::fs::read_to_string(copy.join("SKILL.md")).unwrap();
    assert!(content.contains("name: copy"));
}

#[test]
fn update_raw_validates_content() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill(dir.path(), "raw-test");

    // Valid content
    let valid = "---\nname: raw-test\ndescription: Updated\n---\n\nNew body.\n";
    update_skill_raw(&skill_dir, valid).unwrap();

    // Invalid content (missing frontmatter)
    let invalid = "no frontmatter here";
    assert!(update_skill_raw(&skill_dir, invalid).is_err());
}

#[test]
fn get_skill_returns_full_data() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill(dir.path(), "full-data");
    let skill = get_skill(&skill_dir).unwrap();
    assert_eq!(skill.frontmatter.name, "full-data");
    assert!(skill.body.contains("Body text"));
}

#[test]
fn create_skill_rejects_path_traversal() {
    let result = create_skill(&SkillName::from_validated("../escape"), "desc", "body");
    assert!(result.is_err());
    // validate_skill_name catches this — either as path separator or invalid chars
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("invalid") || err.contains("path") || err.contains(".."),
        "Expected validation error, got: {err}"
    );
}

#[test]
fn packaged_skill_paths_are_readable_but_not_mutable() {
    let builtin = builtin_packages_dir()
        .unwrap()
        .join("win32-x64")
        .join("1.2.3")
        .join("builtin")
        .join("example");

    assert!(validate_skill_dir(&builtin).is_ok());
    assert!(matches!(
        validate_mutable_skill_dir(&builtin),
        Err(SkillsError::ReadOnly(_))
    ));
}
