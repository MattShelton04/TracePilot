use super::*;
use tempfile::TempDir;

mod atomic;

fn setup_skill_with_assets(dir: &TempDir) -> std::path::PathBuf {
    let skill_dir = dir.path().join("my-skill");
    std::fs::create_dir_all(&skill_dir).unwrap();
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: my-skill\ndescription: test\n---\n",
    )
    .unwrap();
    std::fs::write(skill_dir.join("helper.py"), "# python helper").unwrap();
    std::fs::write(skill_dir.join("config.json"), "{}").unwrap();
    skill_dir
}

#[test]
fn list_assets_excludes_skill_md() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    let assets = list_assets(&skill_dir).unwrap();
    assert_eq!(assets.len(), 2);
    let names: Vec<_> = assets.iter().map(|a| a.name.as_str()).collect();
    assert!(names.contains(&"helper.py"));
    assert!(names.contains(&"config.json"));
    assert!(!names.contains(&"SKILL.md"));
}

#[test]
fn list_assets_nonexistent_dir_errors() {
    let result = list_assets(Path::new("/nonexistent/path"));
    assert!(result.is_err());
}

#[test]
fn add_asset_creates_file() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    add_asset(&skill_dir, "new-file.txt", b"hello").unwrap();
    assert_eq!(
        std::fs::read(skill_dir.join("new-file.txt")).unwrap(),
        b"hello"
    );
}

#[test]
fn add_asset_preserves_existing_content_instead_of_truncating_it() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let result = add_asset(&skill_dir, "helper.py", b"");
    let error = result.unwrap_err().to_string();
    assert!(
        error.contains("Asset 'helper.py' already exists"),
        "{error}"
    );
    assert!(error.contains("Choose a different name"), "{error}");
    assert_eq!(
        std::fs::read(skill_dir.join("helper.py")).unwrap(),
        b"# python helper"
    );
}

#[test]
fn copy_asset_preserves_existing_destination_and_source() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let source = dir.path().join("source.py");
    std::fs::write(&source, b"replacement").unwrap();
    let error = copy_asset_from(&skill_dir, "helper.py", &source)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("Asset 'helper.py' already exists"),
        "{error}"
    );
    assert_eq!(
        std::fs::read(skill_dir.join("helper.py")).unwrap(),
        b"# python helper"
    );
    assert_eq!(std::fs::read(&source).unwrap(), b"replacement");
    assert!(copy_asset_from(&skill_dir, "helper.py", &skill_dir.join("helper.py")).is_err());
    assert_eq!(
        std::fs::read(skill_dir.join("helper.py")).unwrap(),
        b"# python helper"
    );
}

#[test]
fn add_and_copy_create_nested_assets_without_changing_the_source() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let source = dir.path().join("source.bin");
    let bytes = [0, 255, 13, 10, 42];
    std::fs::write(&source, bytes).unwrap();
    add_asset(&skill_dir, "references/notes/example.txt", b"nested").unwrap();
    copy_asset_from(&skill_dir, "references/binary/example.bin", &source).unwrap();
    assert_eq!(
        std::fs::read(skill_dir.join("references/notes/example.txt")).unwrap(),
        b"nested"
    );
    assert_eq!(
        std::fs::read(skill_dir.join("references/binary/example.bin")).unwrap(),
        bytes
    );
    assert_eq!(std::fs::read(source).unwrap(), bytes);
}

#[test]
fn concurrent_add_and_copy_have_one_winner_without_replacing_it() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let source = dir.path().join("source.txt");
    std::fs::write(&source, b"copied").unwrap();
    let barrier = std::sync::Barrier::new(2);
    let (added, copied) = std::thread::scope(|scope| {
        let first = scope.spawn(|| {
            barrier.wait();
            add_asset(&skill_dir, "nested/race.txt", b"created")
        });
        let second = scope.spawn(|| {
            barrier.wait();
            copy_asset_from(&skill_dir, "nested/race.txt", &source)
        });
        (first.join().unwrap(), second.join().unwrap())
    });
    let (expected, error) = match (added, copied) {
        (Ok(()), Err(error)) => (b"created".as_slice(), error),
        (Err(error), Ok(())) => (b"copied".as_slice(), error),
        results => panic!("Exactly one creation must succeed: {results:?}"),
    };
    assert!(error.to_string().contains("already exists"));
    assert_eq!(
        std::fs::read(skill_dir.join("nested/race.txt")).unwrap(),
        expected
    );
}

#[test]
fn invalid_copy_source_does_not_leave_a_destination_or_create_its_parents() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    assert!(copy_asset_from(
        &skill_dir,
        "nested/missing.txt",
        &dir.path().join("missing.txt")
    )
    .is_err());
    assert!(copy_asset_from(&skill_dir, "nested/directory.txt", dir.path()).is_err());
    assert!(!skill_dir.join("nested").exists());
}

#[cfg(windows)]
#[test]
fn copy_asset_preserves_source_readonly_permission() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let source = dir.path().join("readonly.txt");
    std::fs::write(&source, b"read only").unwrap();
    let writable = std::fs::metadata(&source).unwrap().permissions();
    let mut readonly = writable.clone();
    readonly.set_readonly(true);
    std::fs::set_permissions(&source, readonly).unwrap();
    let result = copy_asset_from(&skill_dir, "readonly.txt", &source);
    let destination = skill_dir.join("readonly.txt");
    let copied_readonly = std::fs::metadata(&destination).map(|m| m.permissions().readonly());
    std::fs::set_permissions(&source, writable.clone()).unwrap();
    if destination.exists() {
        std::fs::set_permissions(&destination, writable).unwrap();
    }
    result.unwrap();
    assert!(copied_readonly.unwrap());
}

#[cfg(unix)]
#[test]
fn copy_asset_preserves_source_executable_mode() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let source = dir.path().join("run.sh");
    std::fs::write(&source, b"#!/bin/sh\necho test\n").unwrap();
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o751)).unwrap();
    copy_asset_from(&skill_dir, "scripts/run.sh", &source).unwrap();
    assert_eq!(
        std::fs::metadata(skill_dir.join("scripts/run.sh"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o751
    );
}

#[cfg(unix)]
#[test]
fn symlink_parents_cannot_create_assets_or_directories_outside_the_skill() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let outside = dir.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, skill_dir.join("linked")).unwrap();
    let source = dir.path().join("source.txt");
    std::fs::write(&source, b"source").unwrap();
    assert!(add_asset(&skill_dir, "linked/created/note.txt", b"content").is_err());
    assert!(copy_asset_from(&skill_dir, "linked/copied/note.txt", &source).is_err());
    assert_eq!(std::fs::read_dir(outside).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn in_skill_symlink_parents_work_but_existing_file_links_are_never_overwritten() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    std::fs::create_dir(skill_dir.join("references")).unwrap();
    std::os::unix::fs::symlink(skill_dir.join("references"), skill_dir.join("linked")).unwrap();
    add_asset(&skill_dir, "linked/note.txt", b"nested").unwrap();
    assert_eq!(
        std::fs::read(skill_dir.join("references/note.txt")).unwrap(),
        b"nested"
    );
    let outside = dir.path().join("outside.txt");
    std::fs::write(&outside, b"preserve").unwrap();
    std::os::unix::fs::symlink(&outside, skill_dir.join("existing.txt")).unwrap();
    assert!(add_asset(&skill_dir, "existing.txt", b"overwrite").is_err());
    assert!(copy_asset_from(&skill_dir, "existing.txt", &skill_dir.join("helper.py")).is_err());
    assert_eq!(std::fs::read(outside).unwrap(), b"preserve");
}

#[test]
fn add_asset_rejects_skill_md_overwrite() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    let result = add_asset(&skill_dir, "SKILL.md", b"overwrite");
    assert!(result.is_err());
}

#[test]
fn add_asset_rejects_path_traversal() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    assert!(add_asset(&skill_dir, "../escape.txt", b"evil").is_err());
    assert!(add_asset(&skill_dir, "/absolute.txt", b"evil").is_err());
}

#[test]
fn remove_asset_deletes_file() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    remove_asset(&skill_dir, "helper.py").unwrap();
    assert!(!skill_dir.join("helper.py").exists());
}

#[test]
fn remove_asset_rejects_skill_md() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    let result = remove_asset(&skill_dir, "SKILL.md");
    assert!(result.is_err());
}

#[test]
fn remove_nonexistent_asset_errors() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    let result = remove_asset(&skill_dir, "ghost.txt");
    assert!(result.is_err());
}

#[test]
fn read_asset_returns_content() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    let content = read_asset(&skill_dir, "helper.py").unwrap();
    assert_eq!(content, "# python helper");
}

#[test]
fn read_nonexistent_asset_errors() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    let result = read_asset(&skill_dir, "missing.txt");
    assert!(result.is_err());
}

#[test]
fn remove_asset_rejects_path_traversal() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    assert!(remove_asset(&skill_dir, "../escape.txt").is_err());
    assert!(remove_asset(&skill_dir, "/absolute.txt").is_err());
    assert!(remove_asset(&skill_dir, "..\\escape.txt").is_err());
}

#[test]
fn read_asset_rejects_path_traversal() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);

    assert!(read_asset(&skill_dir, "../escape.txt").is_err());
    assert!(read_asset(&skill_dir, "/absolute.txt").is_err());
    assert!(read_asset(&skill_dir, "..\\escape.txt").is_err());
}

#[test]
fn validate_asset_name_rejects_empty() {
    assert!(validate_asset_name("").is_err());
}

#[test]
fn validate_asset_name_rejects_skill_md() {
    assert!(validate_asset_name("SKILL.md").is_err());
}

#[test]
fn read_asset_nested_path_works() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let sub_dir = skill_dir.join("scripts");
    std::fs::create_dir_all(&sub_dir).unwrap();
    std::fs::write(sub_dir.join("run.ps1"), "echo hello").unwrap();

    let content = read_asset(&skill_dir, "scripts/run.ps1").unwrap();
    assert_eq!(content, "echo hello");
}

#[test]
fn validate_asset_name_allows_nested_paths() {
    assert!(validate_asset_name("subdir/file.txt").is_ok());
    assert!(validate_asset_name("deep/nested/file.md").is_ok());
}

#[test]
fn list_assets_includes_subdirectories() {
    let dir = TempDir::new().unwrap();
    let skill_dir = setup_skill_with_assets(&dir);
    let sub_dir = skill_dir.join("sub");
    std::fs::create_dir_all(&sub_dir).unwrap();
    std::fs::write(sub_dir.join("nested.txt"), "nested").unwrap();

    let assets = list_assets(&skill_dir).unwrap();
    let dirs: Vec<_> = assets.iter().filter(|a| a.is_directory).collect();
    assert_eq!(dirs.len(), 1);
    assert_eq!(dirs[0].name, "sub");
}
