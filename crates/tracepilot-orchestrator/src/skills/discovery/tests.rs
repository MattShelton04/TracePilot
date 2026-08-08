use super::*;
use tempfile::TempDir;

fn create_test_skill(dir: &Path, name: &str) {
    let skill_dir = dir.join(name);
    std::fs::create_dir_all(&skill_dir).unwrap();
    let content =
        format!("---\nname: {name}\ndescription: Test skill {name}\n---\n\nBody of {name}.\n");
    std::fs::write(skill_dir.join("SKILL.md"), content).unwrap();
}

#[test]
fn discover_in_empty_directory() {
    let dir = TempDir::new().unwrap();
    let result = discover_in_directory(dir.path(), SkillScope::Global).unwrap();
    assert!(result.is_empty());
}

#[test]
fn discover_finds_skills() {
    let dir = TempDir::new().unwrap();
    create_test_skill(dir.path(), "skill-a");
    create_test_skill(dir.path(), "skill-b");

    let result = discover_in_directory(dir.path(), SkillScope::Global).unwrap();
    assert_eq!(result.len(), 2);
}

#[test]
fn discover_skips_non_directories() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("not-a-skill.txt"), "hello").unwrap();
    create_test_skill(dir.path(), "real-skill");

    let result = discover_in_directory(dir.path(), SkillScope::Global).unwrap();
    assert_eq!(result.len(), 1);
}

#[test]
fn discover_skips_dirs_without_skill_md() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir_all(dir.path().join("empty-dir")).unwrap();
    create_test_skill(dir.path(), "valid-skill");

    let result = discover_in_directory(dir.path(), SkillScope::Global).unwrap();
    assert_eq!(result.len(), 1);
}

#[test]
fn detailed_discovery_reports_invalid_skill() {
    let dir = TempDir::new().unwrap();
    let invalid = dir.path().join("invalid");
    std::fs::create_dir_all(&invalid).unwrap();
    std::fs::write(invalid.join("SKILL.md"), "---\nname: broken").unwrap();

    let result = discover_in_directory_detailed(dir.path(), SkillScope::Global).unwrap();
    assert!(result.skills.is_empty());
    assert_eq!(result.diagnostics.len(), 1);
    assert!(result.diagnostics[0].path.ends_with("SKILL.md"));
}

#[test]
fn load_skill_returns_full_data() {
    let dir = TempDir::new().unwrap();
    create_test_skill(dir.path(), "my-skill");
    let path = dir.path().join("my-skill").join("SKILL.md");

    let skill = load_skill(&path, SkillScope::Global).unwrap();
    assert_eq!(skill.frontmatter.name, "my-skill");
    assert!(skill.body.contains("Body of my-skill"));
    assert_eq!(skill.scope, SkillScope::Global);
    assert!(skill.frontmatter_tokens > 0);
}

#[test]
fn token_estimate_excludes_instruction_body() {
    let dir = TempDir::new().unwrap();
    let short_dir = dir.path().join("short");
    let long_dir = dir.path().join("long");
    std::fs::create_dir_all(&short_dir).unwrap();
    std::fs::create_dir_all(&long_dir).unwrap();

    let frontmatter = "---\nname: body-independent\ndescription: Same metadata\n---\n";
    std::fs::write(
        short_dir.join("SKILL.md"),
        format!("{frontmatter}Short body."),
    )
    .unwrap();
    std::fs::write(
        long_dir.join("SKILL.md"),
        format!("{frontmatter}{}", "Long instruction body. ".repeat(500)),
    )
    .unwrap();

    let short = load_skill(&short_dir.join("SKILL.md"), SkillScope::Global).unwrap();
    let long = load_skill(&long_dir.join("SKILL.md"), SkillScope::Global).unwrap();

    assert_eq!(short.frontmatter_tokens, long.frontmatter_tokens);
    assert!(long.instruction_tokens > short.instruction_tokens);
}

#[test]
fn count_assets_excludes_skill_md() {
    let dir = TempDir::new().unwrap();
    let skill_dir = dir.path().join("with-assets");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: x\ndescription: y\n---\n",
    )
    .unwrap();
    std::fs::write(skill_dir.join("helper.py"), "# helper").unwrap();
    std::fs::write(skill_dir.join("data.json"), "{}").unwrap();

    assert_eq!(count_assets(&skill_dir), 2);
}

#[test]
fn count_assets_excludes_hidden_files() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join(".hidden"), "").unwrap();
    std::fs::write(dir.path().join("visible"), "").unwrap();
    // SKILL.md not counted
    std::fs::write(dir.path().join("SKILL.md"), "").unwrap();

    assert_eq!(count_assets(dir.path()), 1);
}

#[test]
fn count_assets_counts_nested_files_recursively() {
    let dir = TempDir::new().unwrap();
    let skill_dir = dir.path().join("nested-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: x\ndescription: y\n---\n",
    )
    .unwrap();
    std::fs::write(skill_dir.join("top-level.py"), "# top").unwrap();

    // Create nested directories with files
    let refs_dir = skill_dir.join("references");
    std::fs::create_dir_all(&refs_dir).unwrap();
    std::fs::write(refs_dir.join("guide.md"), "# guide").unwrap();
    std::fs::write(refs_dir.join("api.md"), "# api").unwrap();

    let scripts_dir = skill_dir.join("scripts");
    std::fs::create_dir_all(&scripts_dir).unwrap();
    std::fs::write(scripts_dir.join("setup.sh"), "#!/bin/bash").unwrap();

    // Deeply nested
    let deep_dir = refs_dir.join("examples");
    std::fs::create_dir_all(&deep_dir).unwrap();
    std::fs::write(deep_dir.join("example1.py"), "# ex1").unwrap();
    std::fs::write(deep_dir.join("example2.py"), "# ex2").unwrap();

    // Should count: top-level.py, guide.md, api.md, setup.sh, example1.py, example2.py = 6
    // Should NOT count: SKILL.md, directories
    assert_eq!(count_assets(&skill_dir), 6);
}

#[test]
fn count_assets_skips_hidden_dirs() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("visible.txt"), "").unwrap();

    let hidden_dir = dir.path().join(".hidden-dir");
    std::fs::create_dir_all(&hidden_dir).unwrap();
    std::fs::write(hidden_dir.join("secret.txt"), "").unwrap();

    assert_eq!(count_assets(dir.path()), 1);
}

#[test]
fn builtin_discovery_keeps_latest_version_per_name() {
    let dir = TempDir::new().unwrap();
    let old_builtin = dir.path().join("win32-x64").join("1.0.0").join("builtin");
    let new_builtin = dir.path().join("win32-x64").join("1.2.0").join("builtin");
    let universal_builtin = dir.path().join("universal").join("1.1.0").join("builtin");
    std::fs::create_dir_all(&old_builtin).unwrap();
    std::fs::create_dir_all(&new_builtin).unwrap();
    std::fs::create_dir_all(&universal_builtin).unwrap();
    create_test_skill(&old_builtin, "shared-skill");
    create_test_skill(&new_builtin, "shared-skill");
    create_test_skill(&new_builtin, "new-skill");
    create_test_skill(&universal_builtin, "shared-skill");

    let result = discover_builtin_skills(dir.path()).unwrap();

    assert_eq!(result.len(), 2);
    let shared = result
        .iter()
        .find(|skill| skill.name == "shared-skill")
        .unwrap();
    assert!(shared.directory.contains("1.2.0"));
    assert_eq!(shared.scope, SkillScope::Builtin);
}

#[test]
fn builtin_discovery_ignores_temporary_packages() {
    let dir = TempDir::new().unwrap();
    let temporary_builtin = dir.path().join("tmp").join("2.0.0").join("builtin");
    std::fs::create_dir_all(&temporary_builtin).unwrap();
    create_test_skill(&temporary_builtin, "temporary-skill");

    assert!(discover_builtin_skills(dir.path()).unwrap().is_empty());
}
