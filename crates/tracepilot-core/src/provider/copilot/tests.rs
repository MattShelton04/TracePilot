//! `CopilotProvider` must return exactly what the direct loaders return.

use std::path::Path;
use std::time::{Duration, SystemTime};

use serde_json::{Value, json};
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;
use tracepilot_test_support::golden::canonical;

use super::*;
use crate::parsing::checkpoints::parse_checkpoints;
use crate::parsing::events::TypedEvent;
use crate::session::discovery::discover_sessions;
use crate::summary::{load_session_snapshot, load_session_summary};

fn same<T: serde::Serialize>(a: &T, b: &T) -> bool {
    canonical(json!(a)) == canonical(json!(b))
}

fn events_json(events: Option<&Vec<TypedEvent>>) -> Value {
    json!(events.map(|events| {
        events
            .iter()
            .map(|e| (e.event_type.to_string(), &e.raw))
            .collect::<Vec<_>>()
    }))
}

fn assert_snapshot_matches(snapshot: &ProviderSnapshot, load: &SessionLoadResult, name: &str) {
    assert!(same(&snapshot.summary, &load.summary), "{name}: summary");
    assert_eq!(
        canonical(events_json(snapshot.events.as_ref())),
        canonical(events_json(load.typed_events.as_ref())),
        "{name}: events"
    );
    assert!(same(&snapshot.turns, &load.turns), "{name}: turns");
    assert!(
        same(&snapshot.diagnostics, &load.diagnostics),
        "{name}: diagnostics"
    );
    assert!(snapshot.metrics.is_none(), "{name}: metrics");
}

fn corpus_provider() -> (tempfile::TempDir, CopilotProvider) {
    let temp = tempfile::tempdir().unwrap();
    write_copilot_corpus(temp.path());
    let provider = CopilotProvider::new(temp.path());
    (temp, provider)
}

#[test]
fn discovery_matches_direct_scan() {
    let (temp, provider) = corpus_provider();
    let direct = discover_sessions(temp.path()).unwrap();
    let located = provider.discover(&|| false).unwrap();
    assert_eq!(located.len(), direct.len());
    for (locator, session) in located.iter().zip(&direct) {
        assert_eq!(locator.id, session.id);
        assert_eq!(locator.primary_path, session.path);
        assert_eq!(locator.source, SessionSource::Copilot);
        assert_eq!(locator.role, SessionRole::Primary);
        assert_eq!(locator.parent_id, None);
        let events_size =
            std::fs::metadata(session.path.join("events.jsonl")).map_or(0, |m| m.len());
        assert_eq!(locator.source_bytes_hint, events_size);
    }
    assert!(provider.discover(&|| true).is_err());
}

#[test]
fn strict_loads_match_load_session_snapshot() {
    let (_temp, provider) = corpus_provider();
    for locator in provider.discover(&|| false).unwrap() {
        let name = locator.id.to_string();
        let snapshot = provider.load_snapshot(&locator, true, &|| false).unwrap();
        let (load, fingerprint) = load_session_snapshot(&locator.primary_path, &|| false).unwrap();
        assert_snapshot_matches(&snapshot, &load, &name);
        assert_eq!(
            snapshot.fingerprint,
            source_fingerprint(&locator.primary_path, fingerprint),
            "{name}"
        );
    }
}

#[test]
fn display_loads_match_load_session_summary_with_events() {
    let (_temp, provider) = corpus_provider();
    for locator in provider.discover(&|| false).unwrap() {
        let name = locator.id.to_string();
        let snapshot = provider.load_snapshot(&locator, false, &|| false).unwrap();
        let load = load_session_summary_with_events(&locator.primary_path).unwrap();
        assert_snapshot_matches(&snapshot, &load, &name);
        assert!(
            same(
                &snapshot.summary,
                &load_session_summary(&locator.primary_path).unwrap()
            ),
            "{name}: load_session_summary"
        );
    }
}

#[test]
fn fingerprint_is_the_two_file_session_fingerprint() {
    let (_temp, provider) = corpus_provider();
    for locator in provider.discover(&|| false).unwrap() {
        let dir = &locator.primary_path;
        let direct = SessionFingerprint::read(dir).unwrap();
        let fingerprint = provider.fingerprint(&locator).unwrap();
        assert_eq!(
            fingerprint.files,
            vec![
                (dir.join("events.jsonl"), direct.events),
                (dir.join("workspace.yaml"), direct.workspace),
            ]
        );
        assert_eq!(fingerprint.version_token, None);
    }
}

#[test]
fn strict_failures_match_direct_loader() {
    let (_temp, provider) = corpus_provider();
    let locator = provider.discover(&|| false).unwrap().remove(0);
    std::fs::write(locator.primary_path.join("events.jsonl"), b"{broken\n").unwrap();
    assert!(load_session_snapshot(&locator.primary_path, &|| false).is_err());
    assert!(provider.load_snapshot(&locator, true, &|| false).is_err());
    assert!(provider.load_snapshot(&locator, false, &|| false).is_ok());
    assert!(provider.load_snapshot(&locator, true, &|| true).is_err());
    assert!(provider.load_snapshot(&locator, false, &|| true).is_err());
}

fn set_old_mtime(path: &Path) {
    let old = SystemTime::now() - Duration::from_secs(48 * 60 * 60);
    filetime::set_file_mtime(path, filetime::FileTime::from_system_time(old)).unwrap();
}

#[test]
fn liveness_follows_has_lock_file() {
    let (_temp, provider) = corpus_provider();
    let sessions = provider.discover(&|| false).unwrap();
    // A fresh lock, a stale lock with stale events, and no lock.
    std::fs::write(sessions[0].primary_path.join("inuse.123.lock"), "").unwrap();
    let stale = &sessions[1].primary_path;
    std::fs::write(stale.join("inuse.456.lock"), "").unwrap();
    set_old_mtime(&stale.join("inuse.456.lock"));
    for locator in &sessions {
        let expected = if has_lock_file(&locator.primary_path) {
            Liveness::Running {
                pid: None,
                status: None,
            }
        } else {
            Liveness::Idle
        };
        assert_eq!(provider.liveness(locator), expected);
    }
    assert!(matches!(
        provider.liveness(&sessions[0]),
        Liveness::Running { .. }
    ));
    assert_eq!(provider.liveness(&sessions[1]), Liveness::Idle);
    assert_eq!(provider.liveness(&sessions[2]), Liveness::Idle);
}

#[test]
fn artifacts_wrap_existing_readers() {
    let (_temp, provider) = corpus_provider();
    let sessions = provider.discover(&|| false).unwrap();
    let full = &sessions[0];
    let artifacts = provider.artifacts(full).unwrap();
    assert_eq!(
        artifacts.plan,
        Some(PlanArtifact::File(full.primary_path.join("plan.md")))
    );
    assert!(same(
        &artifacts.checkpoints,
        &parse_checkpoints(&full.primary_path).unwrap()
    ));
    assert!(artifacts.checkpoints.is_some());
    assert!(artifacts.todos.is_none());
    assert!(artifacts.rewind.is_none());
    assert_eq!(artifacts.file_roots, vec![full.primary_path.clone()]);

    let minimal = provider.artifacts(&sessions[1]).unwrap();
    assert!(minimal.plan.is_none() && minimal.checkpoints.is_none());
}

#[test]
fn resolve_matches_direct_resolution() {
    let (_temp, provider) = corpus_provider();
    for locator in provider.discover(&|| false).unwrap() {
        assert_eq!(provider.resolve(&locator.id).unwrap(), Some(locator));
    }
    let missing = SessionId::from_validated("ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert_eq!(provider.resolve(&missing).unwrap(), None);
}

#[test]
fn event_and_summary_loads_match_the_direct_readers() {
    let (_temp, provider) = corpus_provider();
    for locator in provider.discover(&|| false).unwrap() {
        let dir = &locator.primary_path;
        let name = dir.display().to_string();
        let direct = crate::parsing::events::parse_typed_events_if_exists(
            &SessionPaths::from_root(dir).events_jsonl(),
        )
        .unwrap()
        .map(|parsed| parsed.events);
        let events = provider.load_events(&locator, &|| false).unwrap();
        assert_eq!(
            canonical(events_json(events.as_ref())),
            canonical(events_json(direct.as_ref())),
            "{name}: events"
        );
        let events = events.unwrap_or_default();
        let summary = provider.summary_from_events(&locator, &events).unwrap();
        let direct = crate::summary::load_session_summary_from_events(dir, &events).unwrap();
        assert!(same(&summary, &direct), "{name}: summary");
        assert_eq!(provider.file_roots(&locator).unwrap(), vec![dir.clone()]);
    }
}

#[test]
fn owns_only_the_directory_resolve_would_build() {
    let (temp, provider) = corpus_provider();
    assert_eq!(provider.root(), Some(temp.path()));
    let locator = provider.discover(&|| false).unwrap().remove(0);
    assert!(provider.owns(&locator));
    let id = locator.id.as_str();
    for path in [
        temp.path().join("nested").join(id),
        temp.path().join(id).join(id),
        temp.path().join("..").join(id),
        Path::new("elsewhere").join(id),
    ] {
        let moved = SessionLocator {
            primary_path: path,
            ..locator.clone()
        };
        assert!(!provider.owns(&moved), "{}", moved.primary_path.display());
    }
    let foreign = SessionLocator {
        source: SessionSource::ClaudeCode,
        ..locator
    };
    assert!(!provider.owns(&foreign));
}
