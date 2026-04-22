//! Tests for the `skills::import` module family.

use super::atomic::atomic_dir_install;
use super::file::import_from_file;
use super::github::collect_skill_blob_paths;
use super::local::{
    copy_dir_contents, count_files_recursive, discover_repo_skills, import_from_local,
    skill_preview_from_dir,
};
use crate::github::TreeEntry;
use crate::skills::error::SkillsError;
use std::path::Path;
use tempfile::TempDir;

fn write_test_skill(dir: &Path) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("SKILL.md"),
        "---\nname: test-import\ndescription: Test\n---\n\nBody.\n",
    )
    .unwrap();
}

#[test]
fn import_from_local_copies_files() {
    let src = TempDir::new().unwrap();
    let dst = TempDir::new().unwrap();

    write_test_skill(src.path());
    std::fs::write(src.path().join("helper.py"), "# helper").unwrap();

    let result = import_from_local(src.path(), dst.path()).unwrap();
    assert_eq!(result.skill_name, "test-import");
    assert_eq!(result.files_copied, 2);
    assert!(dst.path().join("test-import").join("SKILL.md").exists());
    assert!(dst.path().join("test-import").join("helper.py").exists());
}

#[test]
fn import_from_local_creates_missing_destination_parent() {
    let src = TempDir::new().unwrap();
    let root = TempDir::new().unwrap();
    let dest_parent = root.path().join("nested").join("skills");

    write_test_skill(src.path());
    std::fs::write(src.path().join("helper.py"), "# helper").unwrap();

    let result = import_from_local(src.path(), &dest_parent).unwrap();
    assert_eq!(result.skill_name, "test-import");
    assert!(dest_parent.join("test-import").join("SKILL.md").exists());
    assert!(dest_parent.join("test-import").join("helper.py").exists());
}

#[test]
fn import_from_local_errors_without_skill_md() {
    let src = TempDir::new().unwrap();
    let dst = TempDir::new().unwrap();

    let result = import_from_local(src.path(), dst.path());
    assert!(result.is_err());
}

#[test]
fn import_from_local_errors_on_duplicate() {
    let src = TempDir::new().unwrap();
    let dst = TempDir::new().unwrap();

    write_test_skill(src.path());
    std::fs::create_dir_all(dst.path().join("test-import")).unwrap();

    let result = import_from_local(src.path(), dst.path());
    assert!(result.is_err());
}

#[test]
fn import_from_file_single_file() {
    let src = TempDir::new().unwrap();
    let dst = TempDir::new().unwrap();

    let skill_content = "---\nname: file-skill\ndescription: From file\n---\n\nContent.\n";
    let file_path = src.path().join("my-skill.md");
    std::fs::write(&file_path, skill_content).unwrap();

    let result = import_from_file(&file_path, dst.path()).unwrap();
    assert_eq!(result.skill_name, "file-skill");
    assert_eq!(result.files_copied, 1);
    assert!(dst.path().join("file-skill").join("SKILL.md").exists());
}

#[test]
fn copy_dir_preserves_structure() {
    let src = TempDir::new().unwrap();
    let dst = TempDir::new().unwrap();

    std::fs::write(src.path().join("a.txt"), "a").unwrap();
    std::fs::create_dir(src.path().join("sub")).unwrap();
    std::fs::write(src.path().join("sub").join("b.txt"), "b").unwrap();

    let dest = dst.path().join("copied");
    let count = copy_dir_contents(src.path(), &dest).unwrap();
    assert_eq!(count, 2);
    assert!(dest.join("a.txt").exists());
    assert!(dest.join("sub").join("b.txt").exists());
}

#[test]
fn collect_skill_blob_paths_includes_nested_files() {
    let entries = vec![
        TreeEntry {
            path: ".github/skills/playwright/SKILL.md".into(),
            entry_type: "blob".into(),
            size: Some(10),
        },
        TreeEntry {
            path: ".github/skills/playwright/references/guide.md".into(),
            entry_type: "blob".into(),
            size: Some(10),
        },
        TreeEntry {
            path: ".github/skills/playwright/scripts/setup.sh".into(),
            entry_type: "blob".into(),
            size: Some(10),
        },
        TreeEntry {
            path: ".github/skills/other/SKILL.md".into(),
            entry_type: "blob".into(),
            size: Some(10),
        },
    ];

    let paths = collect_skill_blob_paths(&entries, ".github/skills/playwright");
    assert_eq!(
        paths,
        vec![
            ".github/skills/playwright/SKILL.md".to_string(),
            ".github/skills/playwright/references/guide.md".to_string(),
            ".github/skills/playwright/scripts/setup.sh".to_string(),
        ]
    );
}

#[test]
fn collect_skill_blob_paths_for_root_skill_includes_nested_files() {
    let entries = vec![
        TreeEntry {
            path: "SKILL.md".into(),
            entry_type: "blob".into(),
            size: Some(10),
        },
        TreeEntry {
            path: "references/guide.md".into(),
            entry_type: "blob".into(),
            size: Some(10),
        },
        TreeEntry {
            path: "scripts/setup.sh".into(),
            entry_type: "blob".into(),
            size: Some(10),
        },
    ];

    let paths = collect_skill_blob_paths(&entries, ".");
    assert_eq!(
        paths,
        vec![
            "SKILL.md".to_string(),
            "references/guide.md".to_string(),
            "scripts/setup.sh".to_string(),
        ]
    );
}

#[test]
fn discover_repo_skills_finds_skills_in_repos() {
    let repo1 = TempDir::new().unwrap();
    let repo2 = TempDir::new().unwrap();
    let repo_empty = TempDir::new().unwrap();

    // repo1: has a skill in .github/skills/
    let skill_dir = repo1
        .path()
        .join(".github")
        .join("skills")
        .join("test-skill");
    write_test_skill(&skill_dir);

    // repo2: has a skill directly in .copilot/skills/
    let skill_dir2 = repo2
        .path()
        .join(".copilot")
        .join("skills")
        .join("another-skill");
    std::fs::create_dir_all(&skill_dir2).unwrap();
    std::fs::write(
        skill_dir2.join("SKILL.md"),
        "---\nname: another-skill\ndescription: Another test\n---\n\nBody.\n",
    )
    .unwrap();

    let repos = vec![
        (repo1.path().to_str().unwrap(), "Repo One"),
        (repo2.path().to_str().unwrap(), "Repo Two"),
        (repo_empty.path().to_str().unwrap(), "Empty Repo"),
    ];

    let results = discover_repo_skills(&repos);

    // Empty repo should still appear (with 0 skills)
    assert_eq!(results.len(), 3);

    let r1 = results.iter().find(|r| r.repo_name == "Repo One").unwrap();
    assert_eq!(r1.skills.len(), 1);
    assert_eq!(r1.skills[0].name, "test-import");

    let r2 = results.iter().find(|r| r.repo_name == "Repo Two").unwrap();
    assert_eq!(r2.skills.len(), 1);
    assert_eq!(r2.skills[0].name, "another-skill");

    let r3 = results
        .iter()
        .find(|r| r.repo_name == "Empty Repo")
        .unwrap();
    assert_eq!(r3.skills.len(), 0);
}

#[test]
fn discover_repo_skills_skips_nonexistent_paths() {
    let repos = vec![("C:\\nonexistent\\path\\12345", "Missing")];
    let results = discover_repo_skills(&repos);
    assert_eq!(results.len(), 0);
}

#[test]
fn skill_preview_counts_nested_files_recursively() {
    let dir = TempDir::new().unwrap();
    let skill_dir = dir.path().join(".github").join("skills").join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: my-skill\ndescription: Nested test\n---\n\nBody.\n",
    )
    .unwrap();
    std::fs::write(skill_dir.join("helper.py"), "# helper").unwrap();

    // Nested directory with files
    let refs_dir = skill_dir.join("references");
    std::fs::create_dir_all(&refs_dir).unwrap();
    std::fs::write(refs_dir.join("guide.md"), "# guide").unwrap();
    std::fs::write(refs_dir.join("patterns.md"), "# patterns").unwrap();

    let deep_dir = refs_dir.join("examples");
    std::fs::create_dir_all(&deep_dir).unwrap();
    std::fs::write(deep_dir.join("ex1.py"), "# ex1").unwrap();

    let preview = skill_preview_from_dir(&skill_dir).unwrap();
    assert_eq!(preview.name, "my-skill");
    // Should count: SKILL.md + helper.py + guide.md + patterns.md + ex1.py = 5
    assert_eq!(preview.file_count, 5);
}

#[test]
fn count_files_recursive_counts_all_files() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("a.txt"), "a").unwrap();
    std::fs::create_dir(dir.path().join("sub")).unwrap();
    std::fs::write(dir.path().join("sub").join("b.txt"), "b").unwrap();
    std::fs::write(dir.path().join("sub").join("c.txt"), "c").unwrap();

    assert_eq!(count_files_recursive(dir.path()), 3);
}

// ── Atomic import tests ─────────────────────────────────────────────

#[test]
fn atomic_dir_install_succeeds_and_leaves_no_staging() {
    let dest = TempDir::new().unwrap();

    let (final_dir, value) = atomic_dir_install(dest.path(), "my-skill", |staging| {
        std::fs::write(staging.join("SKILL.md"), "test")?;
        Ok(42usize)
    })
    .unwrap();

    assert_eq!(value, 42);
    assert!(final_dir.join("SKILL.md").exists());
    // No leftover .tmp-import-* directories
    for entry in std::fs::read_dir(dest.path()).unwrap() {
        let name = entry.unwrap().file_name();
        assert!(
            !name.to_string_lossy().starts_with(".tmp-import-"),
            "staging dir should be removed after success"
        );
    }
}

#[test]
fn atomic_dir_install_cleans_up_on_closure_failure() {
    let dest = TempDir::new().unwrap();

    let result = atomic_dir_install(dest.path(), "broken-skill", |staging| {
        // Write a partial file then fail
        std::fs::write(staging.join("SKILL.md"), "partial")?;
        Err::<(), _>(SkillsError::Import("simulated failure".to_string()))
    });

    assert!(result.is_err());
    // Final destination should NOT exist
    assert!(!dest.path().join("broken-skill").exists());
    // No staging directory should remain
    for entry in std::fs::read_dir(dest.path()).unwrap() {
        let name = entry.unwrap().file_name();
        assert!(
            !name.to_string_lossy().starts_with(".tmp-import-"),
            "staging dir should be cleaned up on failure"
        );
    }
}

#[test]
fn atomic_dir_install_returns_duplicate_when_dest_exists() {
    let dest = TempDir::new().unwrap();
    std::fs::create_dir_all(dest.path().join("existing-skill")).unwrap();

    let result = atomic_dir_install(dest.path(), "existing-skill", |_staging| Ok(()));

    match result {
        Err(SkillsError::DuplicateSkill(name)) => assert_eq!(name, "existing-skill"),
        other => panic!("Expected DuplicateSkill, got {:?}", other),
    }
}

#[test]
fn import_from_local_no_partial_state_on_unreadable_source() {
    let src = TempDir::new().unwrap();
    let _dst = TempDir::new().unwrap();

    write_test_skill(src.path());
    // Create a subdirectory that will fail to copy due to permissions
    let bad_dir = src.path().join("sub");
    std::fs::create_dir(&bad_dir).unwrap();
    std::fs::write(bad_dir.join("file.txt"), "data").unwrap();

    // Make the subdirectory unreadable (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bad_dir, std::fs::Permissions::from_mode(0o000)).unwrap();

        let result = import_from_local(src.path(), dst.path());
        assert!(result.is_err(), "Should fail when source is unreadable");

        // The destination directory should NOT exist (no partial state)
        assert!(
            !dst.path().join("test-import").exists(),
            "No partial state should remain after failed import"
        );

        // No staging directories should remain
        for entry in std::fs::read_dir(dst.path()).unwrap() {
            let name = entry.unwrap().file_name();
            assert!(
                !name.to_string_lossy().starts_with(".tmp-import-"),
                "staging dir should be cleaned up on failure"
            );
        }

        // Restore permissions for cleanup
        std::fs::set_permissions(&bad_dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

#[test]
fn import_from_file_no_partial_state_on_failure() {
    let src = TempDir::new().unwrap();
    let dst = TempDir::new().unwrap();

    // Write a file with invalid frontmatter
    let file_path = src.path().join("bad.md");
    std::fs::write(&file_path, "not valid yaml frontmatter at all").unwrap();

    let result = import_from_file(&file_path, dst.path());
    assert!(result.is_err());

    // No directories should be created at all (frontmatter parse fails before staging)
    let entries: Vec<_> = std::fs::read_dir(dst.path()).unwrap().collect();
    assert!(
        entries.is_empty(),
        "No files should remain after failed import"
    );
}
