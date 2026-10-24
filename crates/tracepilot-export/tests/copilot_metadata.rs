// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Copilot export metadata matches what the app shows for the session:
//! `workspace.yaml` enriched from the event log, and sessions without a
//! usable `workspace.yaml` exported from their events.

use std::fs;
use std::path::Path;

use tracepilot_export::document::SessionArchive;
use tracepilot_export::export_session;
use tracepilot_export::options::{ExportFormat, ExportOptions};

/// A `workspace.yaml` written early in the session, before it moved to a
/// repository, as older CLIs left it.
const STALE_YAML: &str = r#"id: stale-session
cwd: /test/project
summary: "Stale workspace"
git_root: /test/project
summary_count: 2
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#;

/// Context on `session.start`, a turn two hours after the yaml's
/// `updated_at`, and a shutdown long after that.
const EVENTS: &str = concat!(
    r#"{"type":"session.start","data":{"sessionId":"stale-session","version":"1.0","producer":"copilot-cli","startTime":"2026-03-10T07:14:50Z","context":{"cwd":"/test","branch":"feature-x","repository":"org/project","hostType":"cli"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50Z","parentId":null}"#,
    "\n",
    r#"{"type":"user.message","data":{"content":"Hi","interactionId":"int-1"},"id":"evt-2","timestamp":"2026-03-10T09:00:00Z","parentId":"evt-1"}"#,
    "\n",
    r#"{"type":"assistant.message","data":{"messageId":"m1","content":"Hello","interactionId":"int-1"},"id":"evt-3","timestamp":"2026-03-10T09:00:05Z","parentId":"evt-2"}"#,
    "\n",
    r#"{"type":"session.shutdown","data":{"shutdownType":"routine"},"id":"evt-4","timestamp":"2026-03-10T12:00:00Z","parentId":null}"#,
    "\n",
);

fn session_dir(yaml: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    if let Some(yaml) = yaml {
        fs::write(dir.path().join("workspace.yaml"), yaml).unwrap();
    }
    fs::write(dir.path().join("events.jsonl"), EVENTS).unwrap();
    dir
}

fn export(dir: &Path, format: ExportFormat) -> String {
    let files = export_session(dir, &ExportOptions::all(format)).unwrap();
    files[0].as_text().unwrap().to_string()
}

fn metadata(dir: &Path) -> tracepilot_export::document::PortableSessionMetadata {
    let archive: SessionArchive = serde_json::from_str(&export(dir, ExportFormat::Json)).unwrap();
    archive.sessions.into_iter().next().unwrap().metadata
}

#[test]
fn metadata_takes_last_activity_and_start_context_from_events() {
    let dir = session_dir(Some(STALE_YAML));
    let meta = metadata(dir.path());

    // The last turn, not the stale yaml and not the shutdown.
    assert_eq!(
        meta.updated_at.unwrap().to_rfc3339(),
        "2026-03-10T09:00:05+00:00"
    );
    assert_eq!(meta.repository.as_deref(), Some("org/project"));
    assert_eq!(meta.branch.as_deref(), Some("feature-x"));
    assert_eq!(meta.host_type.as_deref(), Some("cli"));
    // workspace.yaml still wins where it has a value, and keeps its own fields.
    assert_eq!(meta.id, "stale-session");
    assert_eq!(meta.cwd.as_deref(), Some("/test/project"));
    assert_eq!(meta.summary.as_deref(), Some("Stale workspace"));
    assert_eq!(meta.git_root.as_deref(), Some("/test/project"));
    assert_eq!(meta.summary_count, Some(2));

    let markdown = export(dir.path(), ExportFormat::Markdown);
    assert!(
        markdown.contains("| Updated | 2026-03-10T09:00:05Z |"),
        "{markdown}"
    );
    assert!(
        markdown.contains("| Repository | org/project |"),
        "{markdown}"
    );
    assert!(markdown.contains("| Branch | feature-x |"), "{markdown}");
}

#[test]
fn a_session_without_workspace_yaml_exports_from_its_events() {
    let dir = session_dir(None);
    let meta = metadata(dir.path());

    let dir_name = dir.path().file_name().unwrap().to_str().unwrap();
    assert_eq!(meta.id, dir_name);
    assert_eq!(meta.repository.as_deref(), Some("org/project"));
    assert_eq!(
        meta.created_at.unwrap().to_rfc3339(),
        "2026-03-10T07:14:50+00:00"
    );
    assert_eq!(
        meta.updated_at.unwrap().to_rfc3339(),
        "2026-03-10T09:00:05+00:00"
    );
    assert_eq!(meta.turn_count, Some(1));
    assert!(export(dir.path(), ExportFormat::Markdown).contains("Hello"));
}

#[test]
fn a_malformed_workspace_yaml_falls_back_to_the_events() {
    let dir = session_dir(Some("id: [unclosed\n"));
    let meta = metadata(dir.path());

    let dir_name = dir.path().file_name().unwrap().to_str().unwrap();
    assert_eq!(meta.id, dir_name);
    assert_eq!(meta.branch.as_deref(), Some("feature-x"));
    assert!(meta.summary_count.is_none());
}
