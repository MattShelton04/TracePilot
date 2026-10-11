//! Tests for the session command group.

use std::io::Write;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::{
    CopilotProvider, ResolvedSession, SessionLocator, SessionRole, SessionSource,
};

use crate::types::EventCache;

use super::shared::{load_cached_summary, load_cached_typed_events, source_stamp};

/// The Copilot session at `dir`, as the locator would resolve it.
fn copilot_session(dir: &Path, id: &str) -> ResolvedSession {
    ResolvedSession {
        provider: Arc::new(CopilotProvider::new(dir.parent().unwrap())),
        locator: SessionLocator {
            source: SessionSource::Copilot,
            id: SessionId::from_validated(id),
            primary_path: dir.to_path_buf(),
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint: 0,
        },
    }
}

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
    let session = copilot_session(&session_path, "session-a");

    let (first, first_stamp) =
        load_cached_typed_events(&cache, &session).expect("cache miss loads");
    let (second, second_stamp) =
        load_cached_typed_events(&cache, &session).expect("cache hit loads");

    assert_eq!(first_stamp, second_stamp);
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
    let session = copilot_session(&session_path, "session-a");

    let (first, first_stamp) = load_cached_typed_events(&cache, &session).expect("initial load");

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

    let (second, second_stamp) =
        load_cached_typed_events(&cache, &session).expect("reload after append");

    assert!(second_stamp.events_file_size > first_stamp.events_file_size);
    assert_ne!(second_stamp.version, first_stamp.version);
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
    assert!(!dir.path().join("events.jsonl").exists());

    let cache = event_cache(2);
    let session = copilot_session(dir.path(), "session-missing");
    let (events, stamp) =
        load_cached_typed_events(&cache, &session).expect("missing file should not error");

    assert!(events.is_empty());
    assert_eq!(stamp.events_file_size, 0);
    assert!(stamp.events_file_mtime.is_none());
}

#[test]
fn load_cached_typed_events_recovers_from_poisoned_mutex() {
    let (_dir, session_path) = temp_session(&[
        ("session.start", serde_json::json!({ "cwd": "/repo" })),
        ("user.message", serde_json::json!({ "content": "hello" })),
    ]);
    let cache = event_cache(2);
    let session = copilot_session(&session_path, "session-a");

    let poisoned_cache = Arc::clone(&cache);
    let _ = std::thread::spawn(move || {
        let _guard = poisoned_cache.lock().expect("lock cache");
        panic!("poison cache");
    })
    .join();

    let (events, stamp) = load_cached_typed_events(&cache, &session).expect("poison fallback");

    assert_eq!(events.len(), 2);
    assert!(stamp.events_file_size > 0);
}

#[test]
fn copilot_stamp_keeps_the_legacy_events_jsonl_fields() {
    let (_dir, session_path) =
        temp_session(&[("session.start", serde_json::json!({ "cwd": "/repo" }))]);
    let events = std::fs::metadata(session_path.join("events.jsonl")).unwrap();
    let session = copilot_session(&session_path, "session-a");
    let stamp = source_stamp(&session).unwrap();
    assert_eq!(stamp.events_file_size, events.len());
    assert_eq!(stamp.events_file_mtime, Some(events.modified().unwrap()));
    let fingerprint = session.provider.fingerprint(&session.locator).unwrap();
    assert_eq!(stamp.version, fingerprint.source_version());

    // workspace.yaml is part of the source version but not the legacy size.
    std::fs::write(session_path.join("workspace.yaml"), "id: changed\n").unwrap();
    let changed = source_stamp(&session).unwrap();
    assert_eq!(changed.events_file_size, stamp.events_file_size);
    assert_ne!(changed.version, stamp.version);
}

#[test]
fn stamp_falls_back_to_the_event_log_when_fingerprinting_fails() {
    let (_dir, session_path) =
        temp_session(&[("session.start", serde_json::json!({ "cwd": "/repo" }))]);
    // A directory where workspace.yaml should be makes the fingerprint fail.
    std::fs::remove_file(session_path.join("workspace.yaml")).unwrap();
    std::fs::create_dir(session_path.join("workspace.yaml")).unwrap();
    let session = copilot_session(&session_path, "session-a");
    assert!(session.provider.fingerprint(&session.locator).is_err());

    let events = std::fs::metadata(session_path.join("events.jsonl")).unwrap();
    let stamp = source_stamp(&session).unwrap();
    assert_eq!(stamp.events_file_size, events.len());
    assert_eq!(stamp.events_file_mtime, Some(events.modified().unwrap()));
    assert_eq!(source_stamp(&session).unwrap().version, stamp.version);
}

#[test]
fn other_sources_report_totals_over_their_files() {
    let temp = tempfile::tempdir().unwrap();
    let id = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
    let main = temp
        .path()
        .join("projects")
        .join("p")
        .join(format!("{id}.jsonl"));
    let subagents = main.with_extension("").join("subagents");
    std::fs::create_dir_all(&subagents).unwrap();
    std::fs::write(&main, "{}\n").unwrap();
    std::fs::write(subagents.join("agent-1.jsonl"), "{}\n{}\n").unwrap();
    let session = ResolvedSession {
        provider: Arc::new(
            tracepilot_core::provider::claude_code::ClaudeCodeProvider::new(temp.path()),
        ),
        locator: SessionLocator {
            source: SessionSource::ClaudeCode,
            id: SessionId::from_validated(id),
            primary_path: main.clone(),
            parent_id: None,
            role: SessionRole::Primary,
            source_bytes_hint: 0,
        },
    };
    let stamp = source_stamp(&session).unwrap();
    assert_eq!(stamp.events_file_size, 9);
    let latest = [&main, &subagents.join("agent-1.jsonl")]
        .iter()
        .map(|path| std::fs::metadata(path).unwrap().modified().unwrap())
        .max();
    assert_eq!(stamp.events_file_mtime, latest);
}

/// A Claude Code session with one prompt and an `ai-title`, as discovered.
fn claude_session(config_dir: &Path, title: &str) -> ResolvedSession {
    use tracepilot_core::provider::SessionProvider;
    use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
    let project = config_dir.join("projects").join("demo");
    std::fs::create_dir_all(&project).unwrap();
    let id = "11111111-1111-4111-8111-111111111111";
    let records = [
        serde_json::json!({"type": "user", "uuid": "u1", "sessionId": id,
            "timestamp": "2026-09-20T10:00:00Z",
            "message": {"role": "user", "content": "Hello."}}),
        serde_json::json!({"type": "ai-title", "aiTitle": title, "sessionId": id}),
    ];
    let jsonl: String = records.iter().map(|r| format!("{r}\n")).collect();
    std::fs::write(project.join(format!("{id}.jsonl")), jsonl).unwrap();
    let provider = Arc::new(ClaudeCodeProvider::new(config_dir));
    let locator = provider.discover(&|| false).unwrap().remove(0);
    ResolvedSession { provider, locator }
}

#[test]
fn claude_summary_is_cached_with_its_events_until_the_fingerprint_changes() {
    let dir = tempfile::tempdir().unwrap();
    let session = claude_session(dir.path(), "First title");
    let cache = event_cache(2);

    // Loading events (as the turns command does) also caches the summary.
    let (events, _) = load_cached_typed_events(&cache, &session).unwrap();
    let id = session.locator.id.to_string();
    {
        let mut lru = cache.lock().unwrap();
        let entry = lru.get_mut(&id).expect("cached");
        assert!(Arc::ptr_eq(&entry.events, &events));
        let cached = entry
            .summary
            .as_deref()
            .expect("summary cached with the events");
        assert_eq!(cached.summary.as_deref(), Some("First title"));
        // A sentinel proves that the next call is served from the cache.
        let mut sentinel = cached.clone();
        sentinel.summary = Some("Served from cache".into());
        entry.summary = Some(Arc::new(sentinel));
    }
    let summary = load_cached_summary(&cache, &session).unwrap();
    assert_eq!(summary.summary.as_deref(), Some("Served from cache"));

    // Any change to the session's files reloads it.
    let main = &session.locator.primary_path;
    let mut file = std::fs::OpenOptions::new().append(true).open(main).unwrap();
    writeln!(
        file,
        "{}",
        serde_json::json!({"type": "ai-title", "aiTitle": "Second title",
            "sessionId": "11111111-1111-4111-8111-111111111111"})
    )
    .unwrap();
    drop(file);
    let summary = load_cached_summary(&cache, &session).unwrap();
    assert_eq!(summary.summary.as_deref(), Some("Second title"));
}

#[test]
fn copilot_summary_is_still_derived_from_the_cached_events() {
    let (_dir, session_path) = temp_session(&[
        ("session.start", serde_json::json!({ "cwd": "/repo" })),
        ("user.message", serde_json::json!({ "content": "hello" })),
    ]);
    let cache = event_cache(2);
    let session = copilot_session(&session_path, "session-a");
    let summary = load_cached_summary(&cache, &session).unwrap();
    let expected = session
        .provider
        .summary_from_events(
            &session.locator,
            &load_cached_typed_events(&cache, &session).unwrap().0,
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(&summary).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    let mut lru = cache.lock().unwrap();
    assert!(lru.get("session-a").unwrap().summary.is_none());
}

#[test]
fn detail_names_its_source_and_folder_and_otherwise_matches_the_summary() {
    use super::detail::session_detail;
    let cache = event_cache(4);

    let (_copilot_dir, session_path) =
        temp_session(&[("session.start", serde_json::json!({ "cwd": "/repo" }))]);
    let copilot = copilot_session(&session_path, "session-a");
    let mut wire = serde_json::to_value(session_detail(&cache, &copilot).unwrap()).unwrap();
    assert_eq!(wire["source"], "copilot");
    // A Copilot session's folder is its own session directory.
    assert_eq!(wire["folder"], session_path.to_string_lossy().as_ref());
    // Otherwise Copilot's wire output is the summary.
    wire.as_object_mut().unwrap().remove("source");
    wire.as_object_mut().unwrap().remove("folder");
    let summary = load_cached_summary(&cache, &copilot).unwrap();
    assert_eq!(wire, serde_json::to_value(&summary).unwrap());

    let claude_dir = tempfile::tempdir().unwrap();
    let claude = claude_session(claude_dir.path(), "A Claude title");
    let wire = serde_json::to_value(session_detail(&cache, &claude).unwrap()).unwrap();
    assert_eq!(wire["source"], "claudeCode");
    assert_eq!(wire["summary"], "A Claude title");
    assert_eq!(wire["id"], claude.locator.id.as_str());
    // A Claude Code session's folder is the project folder holding its
    // transcript, not a Copilot-style `<id>` directory.
    let project = claude_dir.path().join("projects").join("demo");
    assert_eq!(wire["folder"], project.to_string_lossy().as_ref());
}
