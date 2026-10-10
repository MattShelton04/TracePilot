//! Q3: format drift is recorded at index time and read back per source.

use std::sync::Arc;

use serde_json::json;
use tracepilot_core::provider::{SessionProvider, SessionSource, claude_code::ClaudeCodeProvider};
use tracepilot_test_support::claude::{Transcript, write_session};

use super::common;
use crate::index_db::{FormatNameCount, IndexDb, session_writer};

fn count(name: &str, sessions: u64, records: u64) -> FormatNameCount {
    FormatNameCount {
        name: name.into(),
        sessions,
        records,
    }
}

#[test]
fn claude_format_drift_is_recorded_at_index_time() {
    let mut main = Transcript::main();
    main.prompt("hello");
    main.record("brand-new-record", json!({}));
    main.record("brand-new-record", json!({}));
    main.record(
        "attachment",
        json!({"attachment": {"type": "brand_new_attachment"}}),
    );
    main.record(
        "system",
        json!({"subtype": "informational", "content": "x", "version": "2.1.300"}),
    );
    let files = write_session(&main, &[]);
    let provider: Arc<dyn SessionProvider> = Arc::new(ClaudeCodeProvider::new(files.root.path()));
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let db = IndexDb::open_or_create(&files.root.path().join("index.db")).unwrap();
    let copilot = files.root.path().join("copilot");
    let copilot_session = common::write_session(
        &copilot,
        "00000000-0000-4000-8000-000000000001",
        "s",
        "r",
        "b",
        "u",
        "a",
    );
    db.upsert_session(&copilot_session).unwrap();

    // Indexing twice replaces the rows rather than adding to them.
    for _ in 0..2 {
        let prepared = session_writer::prepare_snapshot(&provider, &locator, &|| false).unwrap();
        db.write_prepared_session(&prepared).unwrap();
    }

    let claude = db.format_diagnostics(SessionSource::ClaudeCode).unwrap();
    assert_eq!(claude.sessions, 1);
    assert_eq!(
        claude.unmapped_record_types,
        vec![count("brand-new-record", 1, 2)]
    );
    assert_eq!(
        claude.unmapped_attachment_types,
        vec![count("brand_new_attachment", 1, 1)]
    );
    // Numeric order: 2.1.280 (the fixture default) before 2.1.300.
    assert_eq!(
        claude.versions,
        vec![count("2.1.280", 1, 4), count("2.1.300", 1, 1)]
    );

    let copilot = db.format_diagnostics(SessionSource::Copilot).unwrap();
    assert_eq!(copilot.sessions, 1);
    assert!(copilot.unmapped_record_types.is_empty() && copilot.versions.is_empty());

    // Claude rows indexed before format observations existed are refreshed.
    db.conn
        .execute("UPDATE sessions SET analytics_version = 23", [])
        .unwrap();
    assert!(db.session_is_stale(provider.as_ref(), &locator));

    // Removing the session removes its observations.
    db.conn
        .execute("DELETE FROM sessions WHERE source = 'claudeCode'", [])
        .unwrap();
    let left: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM session_format_observations",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn copilot_format_drift_is_recorded_at_index_time() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("session-state");
    let dir = common::write_session(
        &root,
        "00000000-0000-4000-8000-000000000002",
        "s",
        "r",
        "b",
        "u",
        "a",
    );
    let line = |kind: &str, data: serde_json::Value| {
        json!({"type": kind, "data": data, "id": "e", "timestamp": "2026-03-10T07:14:53.000Z"})
            .to_string()
    };
    let mut events = std::fs::read_to_string(dir.join("events.jsonl")).unwrap();
    for extra in [
        line("session.start", json!({"copilotVersion": "1.0.83"})),
        line("brand.new_event", json!({})),
        line("brand.new_event", json!({})),
        line("session.resume", json!({"copilotVersion": "1.0.100"})),
    ] {
        events.push_str(&extra);
        events.push('\n');
    }
    std::fs::write(dir.join("events.jsonl"), events).unwrap();
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&dir).unwrap();

    let copilot = db.format_diagnostics(SessionSource::Copilot).unwrap();
    assert_eq!(copilot.sessions, 1);
    assert_eq!(
        copilot.unmapped_record_types,
        vec![count("brand.new_event", 1, 2)]
    );
    assert!(copilot.unmapped_attachment_types.is_empty());
    // Numeric order: 1.0.83 before 1.0.100.
    assert_eq!(
        copilot.versions,
        vec![count("1.0.83", 1, 1), count("1.0.100", 1, 1)]
    );
    assert_eq!(
        db.format_diagnostics(SessionSource::ClaudeCode).unwrap(),
        crate::index_db::FormatDiagnostics::default()
    );

    // Copilot rows indexed before Copilot reported format observations are
    // refreshed.
    db.conn
        .execute("UPDATE sessions SET analytics_version = 17", [])
        .unwrap();
    let provider = tracepilot_core::provider::CopilotProvider::new(&root);
    let locator = tracepilot_core::provider::CopilotProvider::session_at(&dir);
    assert!(db.session_is_stale(&provider, &locator));
}
