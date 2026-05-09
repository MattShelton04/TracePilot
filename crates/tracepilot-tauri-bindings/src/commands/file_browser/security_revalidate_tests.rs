//! Tests for [`super::revalidate_within_session_dir`] and
//! [`super::reject_hidden_filename`] — the post-canonicalisation TOCTOU
//! guards used by `session_read_file` and `session_read_sqlite`.
//!
//! Split out of `security.rs` to keep that file under the
//! `scripts/check-file-sizes.mjs` budget.

use super::security::{reject_hidden_filename, revalidate_within_session_dir};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

fn make_session_dir(tmp: &TempDir) -> PathBuf {
    let dir = tmp.path().join("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

// ── revalidate_within_session_dir ──────────────────────────

#[test]
fn revalidate_accepts_file_inside_dir() {
    let tmp = TempDir::new().unwrap();
    let session_dir = make_session_dir(&tmp);
    let inside = session_dir.join("events.jsonl");
    std::fs::write(&inside, "{}").unwrap();

    let result = revalidate_within_session_dir(&session_dir, &inside);
    assert!(result.is_ok());
}

#[test]
fn revalidate_rejects_file_outside_dir() {
    let tmp = TempDir::new().unwrap();
    let session_dir = make_session_dir(&tmp);

    let outside = tmp.path().join("outside.txt");
    std::fs::write(&outside, "x").unwrap();

    let err = revalidate_within_session_dir(&session_dir, &outside).unwrap_err();
    assert!(
        err.to_string().contains("escapes session directory"),
        "got: {err}"
    );
}

#[test]
#[cfg(unix)]
fn revalidate_rejects_symlink_escape() {
    use std::os::unix::fs::symlink;

    let tmp = TempDir::new().unwrap();
    let session_dir = make_session_dir(&tmp);

    let outside = tmp.path().join("secret.txt");
    std::fs::write(&outside, "secret").unwrap();

    let link = session_dir.join("escape.txt");
    symlink(&outside, &link).unwrap();

    let err = revalidate_within_session_dir(&session_dir, &link).unwrap_err();
    assert!(err.to_string().contains("escapes session directory"));
}

// ── reject_hidden_filename ─────────────────────────────────

#[test]
fn hidden_filename_rejected() {
    let err = reject_hidden_filename(Path::new("/some/dir/.git")).unwrap_err();
    assert!(err.to_string().contains("Hidden files"));
}

#[test]
fn hidden_relative_filename_rejected() {
    let err = reject_hidden_filename(Path::new(".env")).unwrap_err();
    assert!(err.to_string().contains("Hidden files"));
}

#[test]
fn visible_filename_accepted() {
    assert!(reject_hidden_filename(Path::new("/some/dir/events.jsonl")).is_ok());
    assert!(reject_hidden_filename(Path::new("plan.md")).is_ok());
}
