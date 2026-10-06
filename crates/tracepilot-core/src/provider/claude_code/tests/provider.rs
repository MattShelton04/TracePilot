//! `ClaudeCodeProvider` through the `SessionProvider` trait.

use std::path::Path;
use std::sync::Arc;

use tracepilot_test_support::claude::{OPUS, SESSION_ID, write_pid_file};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::super::{ClaudeCodeProvider, ProcessStart};
use crate::ids::SessionId;
use crate::provider::{Liveness, RunStatus, SessionProvider, SessionRole, SessionSource};

const PID: u32 = 4242;
const STARTED: &str = "134000000000000000";

fn provider(config_dir: &Path) -> ClaudeCodeProvider {
    ClaudeCodeProvider::new(config_dir)
}

fn session_id() -> SessionId {
    SessionId::from_validated(SESSION_ID)
}

#[test]
fn discover_lists_main_transcripts_only() {
    let files = fixtures::subagents();
    let root = files.root.path();
    let project = files.main.parent().unwrap();
    std::fs::write(project.join("notes.jsonl"), "{}\n").unwrap();
    std::fs::create_dir_all(project.join("memory")).unwrap();
    std::fs::write(project.join("memory").join("MEMORY.md"), "x").unwrap();

    let sessions = provider(root).discover(&|| false).unwrap();
    assert_eq!(
        sessions.len(),
        1,
        "subagent files and other files are not sessions"
    );
    let session = &sessions[0];
    assert_eq!(session.source, SessionSource::ClaudeCode);
    assert_eq!(session.id.as_str(), SESSION_ID);
    assert_eq!(session.primary_path, files.main);
    assert_eq!(session.role, SessionRole::Primary);
    let subagent_dir = files.main.with_extension("").join("subagents");
    let subagent_bytes: u64 = std::fs::read_dir(subagent_dir)
        .unwrap()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .map(|e| e.metadata().unwrap().len())
        .sum();
    assert!(subagent_bytes > 0);
    let main_bytes = std::fs::metadata(&files.main).unwrap().len();
    assert_eq!(session.source_bytes_hint, main_bytes + subagent_bytes);
}

#[test]
fn discover_fails_on_a_missing_root_and_on_cancellation() {
    let dir = tempfile::tempdir().unwrap();
    let missing = provider(&dir.path().join("gone")).discover(&|| false);
    assert!(
        missing.is_err(),
        "a missing root must not look like an empty inventory"
    );
    assert!(provider(dir.path()).discover(&|| false).unwrap().is_empty());

    let files = fixtures::tool_hazards();
    assert!(provider(files.root.path()).discover(&|| true).is_err());
}

#[test]
fn fingerprint_covers_every_file_a_load_reads() {
    let files = fixtures::subagents();
    let provider = provider(files.root.path());
    let session = provider.resolve(&session_id()).unwrap().expect("resolved");
    let fingerprint = provider.fingerprint(&session).unwrap();
    let names: Vec<_> = fingerprint
        .files
        .iter()
        .map(|(path, fp)| {
            assert!(fp.is_some());
            path.file_name().unwrap().to_string_lossy().into_owned()
        })
        .collect();
    assert!(names.contains(&format!("{SESSION_ID}.jsonl")));
    assert!(names.iter().any(|n| n.ends_with(".meta.json")));
    assert!(names.iter().filter(|n| n.starts_with("agent-")).count() >= 2);
    let mut sorted = fingerprint.files.clone();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(sorted, fingerprint.files);

    // A new subagent file changes the fingerprint.
    let subagents = files.main.with_extension("").join("subagents");
    std::fs::write(subagents.join("agent-new.jsonl"), "{}\n").unwrap();
    assert_ne!(provider.fingerprint(&session).unwrap(), fingerprint);
}

#[test]
fn load_snapshot_builds_summary_events_and_turns() {
    let files = fixtures::tool_hazards();
    let provider = provider(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    let snapshot = provider.load_snapshot(&session, true, &|| false).unwrap();
    let summary = &snapshot.summary;
    assert_eq!(summary.id, SESSION_ID);
    assert!(summary.has_events);
    assert_eq!(summary.cwd.as_deref(), Some("C:\\work\\demo"));
    assert_eq!(summary.branch.as_deref(), Some("main"));
    assert_eq!(summary.current_model.as_deref(), Some(OPUS));
    assert!(summary.created_at.is_some());
    assert!(summary.updated_at > summary.created_at);
    let events = snapshot.events.as_ref().unwrap();
    assert_eq!(summary.event_count, Some(events.len()));
    assert_eq!(
        summary.turn_count,
        Some(snapshot.turns.as_ref().unwrap().len())
    );
    assert!(snapshot.metrics.is_none(), "metrics are C5");
    assert_eq!(
        snapshot.fingerprint,
        provider.fingerprint(&session).unwrap()
    );
}

#[test]
fn strict_loads_refuse_damaged_files_that_best_effort_loads_show() {
    let files = fixtures::damaged_lines();
    let provider = provider(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    assert!(provider.load_snapshot(&session, true, &|| false).is_err());
    let snapshot = provider.load_snapshot(&session, false, &|| false).unwrap();
    assert!(snapshot.events.is_some_and(|events| !events.is_empty()));
    assert!(provider.load_snapshot(&session, false, &|| true).is_err());
}

#[test]
fn resolve_finds_sessions_by_id_only() {
    let files = fixtures::tool_hazards();
    let provider = provider(files.root.path());
    let found = provider.resolve(&session_id()).unwrap().expect("found");
    assert_eq!(found.primary_path, files.main);
    let other = SessionId::from_validated("99999999-9999-4999-8999-999999999999");
    assert!(provider.resolve(&other).unwrap().is_none());
    let traversal = SessionId::from_validated("../../outside");
    assert!(provider.resolve(&traversal).unwrap().is_none());
}

fn live(started: &'static str) -> ProcessStart {
    Arc::new(move |pid| (pid == PID).then(|| started.to_string()))
}

#[test]
fn liveness_requires_a_matching_pid_file_and_process() {
    let files = fixtures::tool_hazards();
    let root = files.root.path();
    let session = provider(root).resolve(&session_id()).unwrap().unwrap();
    let check = |provider: ClaudeCodeProvider| provider.liveness(&session);

    assert_eq!(check(provider(root)), Liveness::Idle, "no sessions/ dir");
    write_pid_file(
        root,
        77,
        "99999999-9999-4999-8999-999999999999",
        STARTED,
        "busy",
    );
    assert_eq!(
        check(provider(root).with_process_start(live(STARTED))),
        Liveness::Idle
    );

    write_pid_file(root, PID, SESSION_ID, STARTED, "busy");
    assert_eq!(
        check(provider(root)),
        Liveness::Unknown,
        "a file alone may be stale"
    );
    assert_eq!(
        check(provider(root).with_process_start(live(STARTED))),
        Liveness::Running {
            pid: Some(PID),
            status: Some(RunStatus::Busy)
        }
    );
    // The pid was reused by another process, or nothing runs under it.
    let reused = provider(root).with_process_start(live("134000000000000001"));
    assert_eq!(check(reused), Liveness::Idle);
    let gone = provider(root).with_process_start(Arc::new(|_| None));
    assert_eq!(check(gone), Liveness::Idle);

    write_pid_file(root, PID, SESSION_ID, STARTED, "idle");
    assert_eq!(
        check(provider(root).with_process_start(live(STARTED))),
        Liveness::Running {
            pid: Some(PID),
            status: Some(RunStatus::Waiting)
        }
    );
}

#[test]
fn liveness_never_reads_key_files() {
    let files = fixtures::tool_hazards();
    let root = files.root.path();
    let session = provider(root).resolve(&session_id()).unwrap().unwrap();
    write_pid_file(root, PID, SESSION_ID, STARTED, "busy");
    let sessions = root.join("sessions");
    // A `.key` file shaped like a pid file must still be ignored.
    std::fs::rename(
        sessions.join(format!("{PID}.json")),
        sessions.join(format!("{PID}.abc.key")),
    )
    .unwrap();
    let provider = provider(root).with_process_start(live(STARTED));
    assert_eq!(provider.liveness(&session), Liveness::Idle);
}
