//! Tests for the session command group.

use std::io::Write;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::types::EventCache;

use super::shared::load_cached_typed_events;

fn event_cache(capacity: usize) -> EventCache {
    Arc::new(Mutex::new(lru::LruCache::new(
        NonZeroUsize::new(capacity).expect("cache capacity is non-zero"),
    )))
}

fn append_event_line(
    events_path: &Path,
    event_type: &str,
    data: serde_json::Value,
    id: &str,
    timestamp: &str,
) {
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(events_path)
        .expect("failed to open events.jsonl");
    write!(
        file,
        "\n{}",
        serde_json::to_string(&serde_json::json!({
            "type": event_type,
            "data": data,
            "id": id,
            "timestamp": timestamp,
        }))
        .expect("failed to serialize event")
    )
    .expect("failed to append event");
}

fn temp_session(events: &[(&str, serde_json::Value)]) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let session_path = dir.path().to_path_buf();

    std::fs::write(
        session_path.join("workspace.yaml"),
        "id: test-session-00000000\nconversationMode: ask\n",
    )
    .expect("failed to write workspace.yaml");

    let events_path = session_path.join("events.jsonl");
    let mut file = std::fs::File::create(&events_path).expect("failed to create events.jsonl");

    for (index, (event_type, data)) in events.iter().enumerate() {
        if index > 0 {
            writeln!(file).expect("failed to add newline");
        }
        write!(
            file,
            "{}",
            serde_json::to_string(&serde_json::json!({
                "type": event_type,
                "data": data,
                "id": format!("e{}", index + 1),
                "timestamp": format!("2025-01-01T00:00:{index:02}.000Z"),
            }))
            .expect("failed to serialize event")
        )
        .expect("failed to write event");
    }

    (dir, session_path)
}

#[test]
fn load_cached_typed_events_returns_cached_arc_on_hit() {
    let (_dir, session_path) = temp_session(&[
        ("session.start", serde_json::json!({ "cwd": "/repo" })),
        ("user.message", serde_json::json!({ "content": "hello" })),
    ]);
    let cache = event_cache(2);
    let events_path = session_path.join("events.jsonl");

    let (first, first_size, first_mtime) =
        load_cached_typed_events(&cache, "session-a", &events_path).expect("cache miss loads");
    let (second, second_size, second_mtime) =
        load_cached_typed_events(&cache, "session-a", &events_path).expect("cache hit loads");

    assert_eq!(first_size, second_size);
    assert_eq!(first_mtime, second_mtime);
    assert_eq!(first.len(), 2);
    assert!(Arc::ptr_eq(&first, &second));
}

#[test]
fn load_cached_typed_events_invalidates_stale_entries_when_file_changes() {
    let (_dir, session_path) = temp_session(&[
        ("session.start", serde_json::json!({ "cwd": "/repo" })),
        ("user.message", serde_json::json!({ "content": "hello" })),
    ]);
    let cache = event_cache(2);
    let events_path = session_path.join("events.jsonl");

    let (first, first_size, _first_mtime) =
        load_cached_typed_events(&cache, "session-a", &events_path).expect("initial load");

    append_event_line(
        &events_path,
        "tool.execution.complete",
        serde_json::json!({
            "toolCallId": "call-1",
            "success": true,
            "result": { "ok": true },
        }),
        "e3",
        "2025-01-01T00:00:02.000Z",
    );

    let (second, second_size, _second_mtime) =
        load_cached_typed_events(&cache, "session-a", &events_path).expect("reload after append");

    assert!(second_size > first_size);
    assert_eq!(second.len(), 3);
    assert!(!Arc::ptr_eq(&first, &second));
}

#[test]
fn load_cached_typed_events_returns_empty_when_file_missing() {
    // A session directory may exist (checkpoints/files/workspace.yaml) without
    // an events.jsonl yet — e.g. freshly-created sessions or sessions whose
    // event log was cleaned up. Best-effort callers (prefetch, shutdown
    // metrics) should get empty events rather than a "Failed to open" error.
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let events_path = dir.path().join("events.jsonl");
    assert!(!events_path.exists());

    let cache = event_cache(2);
    let (events, file_size, file_mtime) =
        load_cached_typed_events(&cache, "session-missing", &events_path)
            .expect("missing file should not error");

    assert!(events.is_empty());
    assert_eq!(file_size, 0);
    assert!(file_mtime.is_none());
}

#[test]
fn load_cached_typed_events_recovers_from_poisoned_mutex() {
    let (_dir, session_path) = temp_session(&[
        ("session.start", serde_json::json!({ "cwd": "/repo" })),
        ("user.message", serde_json::json!({ "content": "hello" })),
    ]);
    let cache = event_cache(2);
    let events_path = session_path.join("events.jsonl");

    let poisoned_cache = Arc::clone(&cache);
    let _ = std::thread::spawn(move || {
        let _guard = poisoned_cache.lock().expect("lock cache");
        panic!("poison cache");
    })
    .join();

    let (events, file_size, _mtime) =
        load_cached_typed_events(&cache, "session-a", &events_path).expect("poison fallback");

    assert_eq!(events.len(), 2);
    assert!(file_size > 0);
}
