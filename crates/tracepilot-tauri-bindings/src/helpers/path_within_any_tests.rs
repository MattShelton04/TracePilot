//! Tests for [`super::validate_path_within_any`] — the multi-root opener
//! allow-list helper used by the OS-opener Tauri commands.
//!
//! Split out of `helpers/tests.rs` to keep that file under the
//! `scripts/check-file-sizes.mjs` budget.

use super::validate_path_within_any;
use std::fs;
use tempfile::tempdir;

#[test]
fn validate_path_within_any_accepts_file_under_first_root() {
    let root_a = tempdir().unwrap();
    let root_b = tempdir().unwrap();
    let file = root_a.path().join("doc.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_path_within_any(
        file.to_str().unwrap(),
        &[root_a.path().to_path_buf(), root_b.path().to_path_buf()],
    );
    assert!(result.is_ok());
}

#[test]
fn validate_path_within_any_accepts_file_under_later_root() {
    let root_a = tempdir().unwrap();
    let root_b = tempdir().unwrap();
    let file = root_b.path().join("doc.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_path_within_any(
        file.to_str().unwrap(),
        &[root_a.path().to_path_buf(), root_b.path().to_path_buf()],
    );
    assert!(result.is_ok());
}

#[test]
fn validate_path_within_any_skips_unresolvable_roots() {
    let root = tempdir().unwrap();
    let missing = root.path().join("does_not_exist");
    let file = root.path().join("doc.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_path_within_any(
        file.to_str().unwrap(),
        &[missing, root.path().to_path_buf()],
    );
    assert!(result.is_ok());
}

#[test]
fn validate_path_within_any_rejects_file_outside_all_roots() {
    let root_a = tempdir().unwrap();
    let root_b = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let file = outside.path().join("escape.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_path_within_any(
        file.to_str().unwrap(),
        &[root_a.path().to_path_buf(), root_b.path().to_path_buf()],
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("outside"));
}

#[test]
fn validate_path_within_any_rejects_traversal_via_dotdot() {
    let parent = tempdir().unwrap();
    let allowed = parent.path().join("allowed");
    fs::create_dir(&allowed).unwrap();
    let file = parent.path().join("secret.txt");
    fs::write(&file, b"data").unwrap();
    let traversal = allowed.join("..").join("secret.txt");

    let result = validate_path_within_any(traversal.to_str().unwrap(), &[allowed]);
    assert!(result.is_err());
}

#[test]
fn validate_path_within_any_rejects_empty_path() {
    let root = tempdir().unwrap();
    let result = validate_path_within_any("", &[root.path().to_path_buf()]);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("must not be empty")
    );
}

#[test]
fn validate_path_within_any_rejects_nonexistent_path() {
    let root = tempdir().unwrap();
    let missing = root.path().join("nope.txt");
    let result = validate_path_within_any(missing.to_str().unwrap(), &[root.path().to_path_buf()]);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("does not exist"));
}

#[test]
fn validate_path_within_any_errors_when_no_roots_resolve() {
    let root = tempdir().unwrap();
    let file = root.path().join("doc.txt");
    fs::write(&file, b"data").unwrap();

    let bogus_a = root.path().join("missing_a");
    let bogus_b = root.path().join("missing_b");

    let result = validate_path_within_any(file.to_str().unwrap(), &[bogus_a, bogus_b]);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("No allowed directories are accessible")
    );
}

#[test]
fn validate_path_within_any_errors_with_no_roots() {
    let root = tempdir().unwrap();
    let file = root.path().join("doc.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_path_within_any(file.to_str().unwrap(), &[]);
    assert!(result.is_err());
}

#[cfg(unix)]
#[test]
fn validate_path_within_any_rejects_symlink_escaping_all_roots() {
    let allowed = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let target = outside.path().join("secret.txt");
    fs::write(&target, b"secret").unwrap();
    let link = allowed.path().join("link.txt");
    std::os::unix::fs::symlink(&target, &link).unwrap();

    let result = validate_path_within_any(link.to_str().unwrap(), &[allowed.path().to_path_buf()]);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("outside"));
}
