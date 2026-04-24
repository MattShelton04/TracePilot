//! Tests for [`super::BackupStore`].
//!
//! Kept in a sibling file so `backup.rs` stays under the 500-line budget
//! enforced by `scripts/check-file-sizes.mjs`.

use super::*;
use std::fs;
use std::time::SystemTime;
use tempfile::TempDir;

fn setup() -> (TempDir, BackupStore) {
    let tmp = TempDir::new().unwrap();
    let store = BackupStore::new(tmp.path().join("backups"));
    (tmp, store)
}

// ── ensure_dir ──────────────────────────────────────────────

#[test]
fn ensure_dir_creates_directory() {
    let (_tmp, store) = setup();
    assert!(!store.dir().exists());
    store.ensure_dir().unwrap();
    assert!(store.dir().exists());
}

#[test]
fn ensure_dir_is_idempotent() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();
    store.ensure_dir().unwrap(); // second call must not fail
    assert!(store.dir().exists());
}

// ── write_copy ──────────────────────────────────────────────

#[test]
fn write_copy_places_file_in_store() {
    let (tmp, store) = setup();
    let src = tmp.path().join("source.yaml");
    fs::write(&src, b"content: true").unwrap();

    let dest = store.write_copy(&src, "backup-1").unwrap();
    assert_eq!(dest, store.dir().join("backup-1"));
    assert_eq!(fs::read(&dest).unwrap(), b"content: true");
}

#[test]
fn write_copy_creates_store_dir_if_missing() {
    let (tmp, store) = setup();
    let src = tmp.path().join("source.yaml");
    fs::write(&src, b"hello").unwrap();

    assert!(!store.dir().exists());
    store.write_copy(&src, "file").unwrap();
    assert!(store.dir().exists());
}

// ── list_by_mtime ───────────────────────────────────────────

#[test]
fn list_by_mtime_returns_empty_for_missing_dir() {
    let (_tmp, store) = setup();
    let files = store.list_by_mtime().unwrap();
    assert!(files.is_empty());
}

#[test]
fn list_by_mtime_returns_files_newest_first() {
    let (tmp, store) = setup();
    store.ensure_dir().unwrap();

    // Create files with explicit timestamps to guarantee ordering.
    let a = store.dir().join("a.bak");
    let b = store.dir().join("b.bak");
    let c = store.dir().join("c.bak");
    fs::write(&a, b"a").unwrap();
    fs::write(&b, b"b").unwrap();
    fs::write(&c, b"c").unwrap();

    // Touch b last so it should be newest.
    let future = SystemTime::now() + std::time::Duration::from_secs(5);
    filetime::set_file_mtime(&b, filetime::FileTime::from_system_time(future)).unwrap();

    let files = store.list_by_mtime().unwrap();
    let names: Vec<&str> = files
        .iter()
        .filter_map(|f| f.path.file_name().and_then(|n| n.to_str()))
        .collect();

    assert_eq!(names[0], "b.bak", "b should be newest");
    // a and c ordering relative to each other may vary; just check b is first.
    assert!(names.contains(&"a.bak"));
    assert!(names.contains(&"c.bak"));
    // Suppresses unused import warning from TempDir
    drop(tmp);
}

#[test]
fn list_matching_filters_by_prefix_and_suffix() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();

    fs::write(store.dir().join("index.db.pre-v1.bak"), b"db1").unwrap();
    fs::write(store.dir().join("index.db.pre-v2.bak"), b"db2").unwrap();
    fs::write(store.dir().join("other-backup-20250101.yaml"), b"ag").unwrap();

    let db_files = store.list_matching("index.db.pre-v", ".bak").unwrap();
    assert_eq!(db_files.len(), 2);
    assert!(db_files.iter().all(|f| {
        f.path
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with(".bak")
    }));
}

// ── contains / guard ────────────────────────────────────────

#[test]
fn contains_true_for_child_path() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();
    let child = store.dir().join("some-backup");
    fs::write(&child, b"").unwrap();
    assert!(store.contains(&child));
}

#[test]
fn contains_false_for_path_outside_store() {
    let (tmp, store) = setup();
    store.ensure_dir().unwrap();
    let outside = tmp.path().join("secret.db");
    fs::write(&outside, b"").unwrap();
    assert!(!store.contains(&outside));
}

#[test]
fn guard_returns_path_escape_for_outside_path() {
    let (tmp, store) = setup();
    store.ensure_dir().unwrap();
    let outside = tmp.path().join("outside");
    fs::write(&outside, b"").unwrap();
    assert!(matches!(
        store.guard(&outside),
        Err(BackupError::PathEscape)
    ));
}

// ── restore_to ──────────────────────────────────────────────

#[test]
fn restore_to_copies_file_atomically() {
    let (tmp, store) = setup();
    store.ensure_dir().unwrap();
    let src = tmp.path().join("original.yaml");
    fs::write(&src, b"original").unwrap();
    let backup = store.write_copy(&src, "backup.yaml").unwrap();

    let restore_dest = tmp.path().join("restore").join("out.yaml");
    store.restore_to(&backup, &restore_dest).unwrap();
    assert_eq!(fs::read(&restore_dest).unwrap(), b"original");
}

#[test]
fn restore_to_rejects_outside_path() {
    let (tmp, store) = setup();
    store.ensure_dir().unwrap();
    let outside = tmp.path().join("outside.bak");
    fs::write(&outside, b"data").unwrap();

    let dest = tmp.path().join("out.yaml");
    let result = store.restore_to(&outside, &dest);
    assert!(matches!(result, Err(BackupError::PathEscape)));
}

#[test]
fn restore_to_returns_not_found_for_missing_backup() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();
    let missing = store.dir().join("nonexistent.bak");
    let dest = store.dir().join("out.yaml");
    let result = store.restore_to(&missing, &dest);
    assert!(matches!(result, Err(BackupError::NotFound(_))));
}

// ── delete_file ─────────────────────────────────────────────

#[test]
fn delete_file_removes_file() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();
    let path = store.dir().join("to-delete");
    fs::write(&path, b"gone").unwrap();

    store.delete_file(&path).unwrap();
    assert!(!path.exists());
}

#[test]
fn delete_file_also_removes_sidecar_if_present() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();
    let path = store.dir().join("my-backup");
    let sidecar = store.dir().join("my-backup.meta.json");
    fs::write(&path, b"content").unwrap();
    fs::write(&sidecar, b"{}").unwrap();

    store.delete_file(&path).unwrap();
    assert!(!path.exists());
    assert!(!sidecar.exists());
}

#[test]
fn delete_file_succeeds_without_sidecar() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();
    let path = store.dir().join("no-sidecar");
    fs::write(&path, b"data").unwrap();
    store.delete_file(&path).unwrap();
    assert!(!path.exists());
}

#[test]
fn delete_file_rejects_outside_path() {
    let (tmp, store) = setup();
    store.ensure_dir().unwrap();
    let outside = tmp.path().join("outside");
    fs::write(&outside, b"secret").unwrap();
    assert!(matches!(
        store.delete_file(&outside),
        Err(BackupError::PathEscape)
    ));
}

#[test]
fn delete_file_returns_not_found_for_missing() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();
    let missing = store.dir().join("gone");
    let result = store.delete_file(&missing);
    assert!(matches!(result, Err(BackupError::NotFound(_))));
}

// ── prune_by_mtime ──────────────────────────────────────────

#[test]
fn prune_keeps_n_newest_files() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();

    // Create 7 files with staggered timestamps.
    for i in 1u64..=7 {
        let path = store.dir().join(format!("test.db.pre-v{}.bak", i));
        fs::write(&path, b"x").unwrap();
        let t = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(i * 1000);
        filetime::set_file_mtime(&path, filetime::FileTime::from_system_time(t)).unwrap();
    }

    store.prune_by_mtime("test.db.pre-v", ".bak", 5);

    let remaining: Vec<_> = fs::read_dir(store.dir())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();

    assert_eq!(
        remaining.len(),
        5,
        "should retain 5 newest: {:?}",
        remaining
    );
    // The 5 newest are v3–v7 (highest timestamps).
    for v in 3..=7 {
        assert!(
            remaining.iter().any(|n| n.contains(&format!("pre-v{}", v))),
            "v{} missing from {:?}",
            v,
            remaining
        );
    }
}

#[test]
fn prune_is_noop_when_count_within_limit() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();

    for i in 1..=3 {
        fs::write(store.dir().join(format!("x.pre-v{}.bak", i)), b"x").unwrap();
    }

    store.prune_by_mtime("x.pre-v", ".bak", 5);

    let count = fs::read_dir(store.dir()).unwrap().count();
    assert_eq!(count, 3);
}

#[test]
fn prune_zero_keep_does_nothing() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();
    for i in 1..=3 {
        fs::write(store.dir().join(format!("f{}.bak", i)), b"x").unwrap();
    }
    store.prune_by_mtime("f", ".bak", 0);
    assert_eq!(fs::read_dir(store.dir()).unwrap().count(), 3);
}

#[test]
fn prune_does_not_delete_non_matching_files() {
    let (_tmp, store) = setup();
    store.ensure_dir().unwrap();

    // DB backups: should be pruned.
    for i in 1u64..=3 {
        let p = store.dir().join(format!("index.db.pre-v{}.bak", i));
        fs::write(&p, b"x").unwrap();
        let t = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(i * 1000);
        filetime::set_file_mtime(&p, filetime::FileTime::from_system_time(t)).unwrap();
    }
    // Agent backup: must NOT be pruned.
    fs::write(store.dir().join("agent-backup-20250101"), b"y").unwrap();

    store.prune_by_mtime("index.db.pre-v", ".bak", 1);

    // Only 1 DB backup should remain plus the agent backup = 2 total.
    let count = fs::read_dir(store.dir()).unwrap().count();
    assert_eq!(count, 2, "agent backup must survive DB prune");
}
