//! `ClaudeCodeProvider` through the `SessionProvider` trait.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use tracepilot_test_support::claude::{
    OPUS, SESSION_ID, Transcript, Usage, text, write_pid_file, write_session,
};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::super::reader::MAX_LINE_BYTES;
use super::super::{ClaudeCodeProvider, ProcessStart};
use crate::ids::SessionId;
use crate::provider::{
    Liveness, ProviderRegistry, RunStatus, SessionLocator, SessionProvider, SessionRole,
    SessionSource,
};

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

/// Cancellation that arrives after the last per-project check still stops
/// discovery: one project, so checks 1 and 2 are the entry and project checks.
#[test]
fn discover_honors_cancellation_inside_a_project() {
    let files = fixtures::tool_hazards();
    let checks = std::cell::Cell::new(0);
    let is_cancelled = || {
        checks.set(checks.get() + 1);
        checks.get() > 2
    };
    let result = provider(files.root.path()).discover(&is_cancelled);
    assert!(
        result.is_err(),
        "cancelled discovery must not return an inventory"
    );
}

/// A valid record over the reader's bound is skipped: strict loads refuse
/// the snapshot, and best-effort loads report the skipped line.
#[test]
fn oversized_records_fail_strict_loads_and_warn_best_effort_ones() {
    let mut t = Transcript::main();
    t.prompt(&"x".repeat(MAX_LINE_BYTES));
    t.call(
        "msg_o1",
        OPUS,
        vec![text("Done.")],
        Usage::new(1, 0, 0, 1),
        "end_turn",
    );
    let files = write_session(&t, &[]);
    let provider = provider(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    assert!(provider.load_snapshot(&session, true, &|| false).is_err());
    let snapshot = provider.load_snapshot(&session, false, &|| false).unwrap();
    let diagnostics = snapshot.diagnostics.expect("diagnostics");
    assert!(diagnostics.has_warnings());
    assert_eq!(
        diagnostics.malformed_lines, 1,
        "the skipped line is reported"
    );
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
    assert!(snapshot.metrics.is_some());
    assert!(summary.shutdown_metrics.is_some());
    assert_eq!(
        snapshot.fingerprint,
        provider.fingerprint(&session).unwrap()
    );
}

#[test]
fn resume_launch_uses_the_transcript_cwd_and_skips_subagents() {
    let files = fixtures::subagents();
    let provider = provider(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    let launch = provider.resume_launch(&session, true).unwrap().unwrap();
    // Live attach is Copilot's: no `--ui-server`.
    assert_eq!(launch.args, ["--resume", SESSION_ID]);
    assert_eq!(launch.cwd, Some(std::path::PathBuf::from("C:\\work\\demo")));
    assert_eq!(launch.label, "Claude Code");

    let subagent = SessionLocator {
        role: SessionRole::Subagent,
        ..session
    };
    assert_eq!(provider.resume_launch(&subagent, false).unwrap(), None);
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

#[test]
fn locate_prefers_the_indexed_transcript_when_an_id_is_duplicated() {
    let files = fixtures::tool_hazards();
    let projects = files.root.path().join("projects");
    // The same id in a second project dir: a scan may find either copy.
    let copy = projects
        .join("C--work-other")
        .join(format!("{SESSION_ID}.jsonl"));
    std::fs::create_dir_all(copy.parent().unwrap()).unwrap();
    std::fs::copy(&files.main, &copy).unwrap();
    let elsewhere = files.root.path().join("elsewhere.jsonl");
    std::fs::copy(&files.main, &elsewhere).unwrap();

    let provider = Arc::new(provider(files.root.path()));
    assert_eq!(provider.root(), Some(projects.as_path()));
    let mut registry = ProviderRegistry::new();
    registry.register(provider.clone());
    let stored = |path: std::path::PathBuf| SessionLocator {
        source: SessionSource::ClaudeCode,
        id: session_id(),
        primary_path: path,
        parent_id: None,
        role: SessionRole::Primary,
        source_bytes_hint: 0,
    };
    let locate = |path| {
        registry
            .locate(&session_id(), Some(stored(path)))
            .unwrap()
            .expect("resolved")
            .locator
            .primary_path
    };

    for indexed in [&files.main, &copy] {
        assert!(provider.owns(&stored(indexed.clone())));
        assert_eq!(&locate(indexed.clone()), indexed, "the indexed copy wins");
    }

    // Rows that are not exactly `<projects>/<dir>/<id>.jsonl` are never
    // trusted; resolution falls back to a scan of the real transcripts.
    let subagent = files
        .main
        .with_extension("")
        .join("subagents")
        .join(format!("{SESSION_ID}.jsonl"));
    std::fs::write(
        &subagent, "{}
",
    )
    .unwrap();
    let untrusted = [
        elsewhere,
        projects.join(format!("{SESSION_ID}.jsonl")),
        subagent,
        projects
            .join("C--work-demo")
            .join(format!("{SESSION_ID}.json")),
        projects
            .join("C--work-other")
            .join("..")
            .join("C--work-demo")
            .join(format!("{SESSION_ID}.jsonl")),
        projects
            .join("C--work-gone")
            .join(format!("{SESSION_ID}.jsonl")),
    ];
    for row in untrusted {
        assert!(!provider.owns(&stored(row.clone())), "{}", row.display());
        let found = locate(row);
        assert!(found == files.main || found == copy, "{}", found.display());
    }
}

/// A batch lookup that answers each pid with `start`.
fn per_pid(start: impl Fn(u32) -> Option<String> + Send + Sync + 'static) -> ProcessStart {
    Arc::new(move |pids: &[u32]| {
        pids.iter()
            .filter_map(|&pid| Some((pid, start(pid)?)))
            .collect()
    })
}

fn live(started: &'static str) -> ProcessStart {
    per_pid(move |pid| (pid == PID).then(|| started.to_string()))
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
    let gone = provider(root).with_process_start(per_pid(|_| None));
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

fn locator(id: &str) -> SessionLocator {
    SessionLocator {
        source: SessionSource::ClaudeCode,
        id: SessionId::from_validated(id),
        primary_path: Path::new("unused.jsonl").to_path_buf(),
        parent_id: None,
        role: SessionRole::Primary,
        source_bytes_hint: 0,
    }
}

#[test]
fn liveness_many_checks_only_sessions_a_pid_file_names() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    const STALE: &str = "22222222-2222-4222-8222-222222222222";
    const NO_FILE: &str = "33333333-3333-4333-8333-333333333333";
    const UNLISTED: &str = "44444444-4444-4444-8444-444444444444";
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let sessions = [locator(SESSION_ID), locator(STALE), locator(NO_FILE)];
    let lookups = Arc::new(AtomicUsize::new(0));
    let batches = Arc::new(AtomicUsize::new(0));
    let counted = |lookups: &Arc<AtomicUsize>| -> ProcessStart {
        let (lookups, batches) = (Arc::clone(lookups), Arc::clone(&batches));
        let start = per_pid(move |pid| {
            lookups.fetch_add(1, Ordering::SeqCst);
            (pid == PID).then(|| STARTED.to_string())
        });
        Arc::new(move |pids: &[u32]| {
            batches.fetch_add(1, Ordering::SeqCst);
            start(pids)
        })
    };

    // No `sessions/` directory: every session is idle, with no lookups.
    let provider = provider(root).with_process_start(counted(&lookups));
    assert_eq!(provider.liveness_many(&sessions), [Liveness::Idle; 3]);
    assert_eq!(lookups.load(Ordering::SeqCst), 0);
    assert_eq!(batches.load(Ordering::SeqCst), 0, "no pids, no lookup call");

    write_pid_file(root, PID, SESSION_ID, STARTED, "busy");
    // Stale: the pid is reused by another process, and the pid is gone.
    write_pid_file(root, PID + 4, STALE, "1", "busy");
    write_pid_file(root, PID + 8, STALE, STARTED, "idle");
    // A file for a session the list does not show costs no lookup.
    write_pid_file(root, PID + 12, UNLISTED, STARTED, "busy");
    let running = Liveness::Running {
        pid: Some(PID),
        status: Some(RunStatus::Busy),
    };
    let batch = provider.liveness_many(&sessions);
    assert_eq!(batch, [running, Liveness::Idle, Liveness::Idle]);
    assert_eq!(lookups.load(Ordering::SeqCst), 3, "one per named pid file");
    assert_eq!(batches.load(Ordering::SeqCst), 1, "one call for every pid");
    let single: Vec<_> = sessions.iter().map(|s| provider.liveness(s)).collect();
    assert_eq!(batch, single);

    // An unreadable `sessions` path cannot tell.
    let blocked = tempfile::tempdir().unwrap();
    std::fs::write(blocked.path().join("sessions"), "not a directory").unwrap();
    let provider = self::provider(blocked.path()).with_process_start(counted(&lookups));
    assert_eq!(provider.liveness_many(&sessions), [Liveness::Unknown; 3]);
}

#[test]
fn a_pid_file_whose_pid_was_reused_costs_one_lookup() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    const REUSED: &str = "55555555-5555-4555-8555-555555555555";
    const GONE: &str = "66666666-6666-4666-8666-666666666666";
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    // An earlier process with this pid left its file; the pid now belongs to
    // a process that started at STARTED.
    write_pid_file(root, PID, REUSED, "134000000000000001", "busy");
    let sessions = root.join("sessions");
    std::fs::rename(
        sessions.join(format!("{PID}.json")),
        sessions.join("earlier.json"),
    )
    .unwrap();
    // No process has this pid: a failed lookup looks the same, so it is
    // checked again each time.
    write_pid_file(root, PID + 4, GONE, STARTED, "busy");
    let lookups = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&lookups);
    let provider = provider(root).with_process_start(per_pid(move |pid| {
        counted.fetch_add(1, Ordering::SeqCst);
        (pid == PID).then(|| STARTED.to_string())
    }));
    let listed = [locator(REUSED), locator(GONE)];

    for _ in 0..3 {
        assert_eq!(provider.liveness_many(&listed), [Liveness::Idle; 2]);
        assert_eq!(provider.liveness(&listed[0]), Liveness::Idle);
    }
    // Reused: one lookup ever. Gone: one per batch.
    assert_eq!(lookups.load(Ordering::SeqCst), 1 + 3);

    // A provider sharing the set skips the reused file too.
    let shared = Arc::new(super::super::StalePidFiles::default());
    let first = self::provider(root)
        .with_process_start(live(STARTED))
        .with_stale_pid_files(Arc::clone(&shared));
    assert_eq!(first.liveness(&listed[0]), Liveness::Idle);
    let never = self::provider(root)
        .with_process_start(Arc::new(|_: &[u32]| -> HashMap<u32, String> {
            panic!("a known stale file is never looked up")
        }))
        .with_stale_pid_files(shared);
    assert_eq!(never.liveness(&listed[0]), Liveness::Idle);
}
