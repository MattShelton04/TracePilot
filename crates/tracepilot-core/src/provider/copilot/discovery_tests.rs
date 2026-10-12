use std::cell::Cell;
use std::fs;

use super::*;
use crate::session::discovery::{discover_sessions, discover_sessions_cancellable};

#[test]
fn discovery_keeps_marker_flags_paths_order_and_size_hints() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path();
    // Reverse creation order; one uppercase directory also checks normalization.
    for mask in (0..8).rev() {
        let name = format!("ABCDEFAB-0000-4000-8000-{mask:012}");
        let dir = root.join(name);
        fs::create_dir(&dir).unwrap();
        for (bit, name) in [
            (1, "workspace.yaml"),
            (2, "events.jsonl"),
            (4, "session.db"),
        ] {
            if mask & bit != 0 {
                fs::write(dir.join(name), "synthetic\n").unwrap();
            }
        }
    }
    fs::create_dir(root.join("not-a-uuid")).unwrap();
    fs::write(root.join("ffffffff-0000-4000-8000-000000000000"), "file").unwrap();
    let direct = discover_sessions(root).unwrap();
    let provider = CopilotProvider::new(root);
    let located = provider.discover(&|| false).unwrap();
    assert_eq!(direct.len(), 8);
    assert_eq!(located.len(), direct.len());
    for (mask, (session, locator)) in direct.iter().zip(&located).enumerate() {
        let name = format!("ABCDEFAB-0000-4000-8000-{mask:012}");
        assert_eq!(session.id.as_str(), name.to_ascii_lowercase());
        assert_eq!(session.path, root.join(name));
        assert_eq!(session.has_workspace_yaml, mask & 1 != 0);
        assert_eq!(session.has_events_jsonl, mask & 2 != 0);
        assert_eq!(session.has_session_db, mask & 4 != 0);
        assert_eq!(locator.id, session.id);
        assert_eq!(locator.primary_path, session.path);
        assert_eq!(
            locator.source_bytes_hint,
            if mask & 2 != 0 { 10 } else { 0 }
        );
    }
}

#[test]
fn discovery_keeps_missing_root_and_invalid_root_behavior() {
    let temp = tempfile::tempdir().unwrap();
    let missing = temp.path().join("missing");
    let provider = CopilotProvider::new(&missing);
    assert!(!provider.root_exists());
    assert!(provider.discover(&|| false).unwrap().is_empty());
    assert!(discover_sessions(&missing).unwrap().is_empty());
    assert!(provider.discover(&|| true).is_err());
    assert!(discover_sessions_cancellable(&missing, &|| true).is_err());
    fs::write(&missing, "not a directory").unwrap();
    assert!(!provider.root_exists());
    assert!(provider.discover(&|| false).is_err());
    assert!(discover_sessions(&missing).is_err());
}

#[test]
fn discovery_cancellation_never_returns_a_partial_inventory() {
    let temp = tempfile::tempdir().unwrap();
    for n in 0..3 {
        fs::create_dir(temp.path().join(format!("00000000-0000-4000-8000-{n:012}"))).unwrap();
    }
    let provider = CopilotProvider::new(temp.path());
    // Initial check, between entries, and final sorted-inventory check.
    for stop in [1, 3, 5] {
        for public in [false, true] {
            let checks = Cell::new(0);
            let cancelled = || {
                checks.set(checks.get() + 1);
                checks.get() >= stop
            };
            let failed = if public {
                discover_sessions_cancellable(temp.path(), &cancelled).is_err()
            } else {
                provider.discover(&cancelled).is_err()
            };
            assert!(failed, "public={public}, stop={stop}");
            assert_eq!(checks.get(), stop);
        }
    }
    // Public marker enrichment remains cancellable after the shared scan.
    for stop in [6, 8, 9] {
        let checks = Cell::new(0);
        let result = discover_sessions_cancellable(temp.path(), &|| {
            checks.set(checks.get() + 1);
            checks.get() >= stop
        });
        assert!(result.is_err());
        assert_eq!(checks.get(), stop);
    }
    assert_eq!(provider.discover(&|| false).unwrap().len(), 3);
    assert_eq!(discover_sessions(temp.path()).unwrap().len(), 3);
}

#[cfg(unix)]
#[test]
fn discovery_preserves_directory_symlink_handling() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("root");
    let target = temp.path().join("target");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&target).unwrap();
    fs::write(target.join("events.jsonl"), "synthetic\n").unwrap();
    let link = root.join("00000000-0000-4000-8000-000000000000");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let direct = discover_sessions(&root).unwrap();
    let located = CopilotProvider::new(&root).discover(&|| false).unwrap();
    assert_eq!(direct.len(), 1);
    assert_eq!(located.len(), 1);
    assert_eq!(direct[0].path, link);
    assert_eq!(located[0].primary_path, link);
    assert!(direct[0].has_events_jsonl);
    assert_eq!(located[0].source_bytes_hint, 10);
}
