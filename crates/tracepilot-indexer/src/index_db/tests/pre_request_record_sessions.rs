//! A Claude Code session indexed before request records (`api-request*`)
//! were left out of its events is re-indexed once: its metadata, then its
//! search content, because both point at the old event indexes.

use std::sync::Arc;

use tracepilot_core::provider::{SessionLocator, SessionProvider, claude_code::ClaudeCodeProvider};
use tracepilot_test_support::claude::{OPUS, Transcript, Usage, text, write_session};

use crate::index_db::{IndexDb, session_writer};

fn index(db: &IndexDb, provider: &Arc<dyn SessionProvider>, locator: &SessionLocator) {
    let prepared = session_writer::prepare_snapshot(provider, locator, &|| false).unwrap();
    db.write_prepared_session(&prepared).unwrap();
}

/// Mark the session's search content as extracted from its current files.
fn index_search(db: &IndexDb, provider: &Arc<dyn SessionProvider>, locator: &SessionLocator) {
    let fingerprint = provider.fingerprint(locator).unwrap();
    let stored = provider.stored_search_fingerprint(&fingerprint).unwrap();
    db.conn
        .execute(
            "UPDATE sessions SET search_indexed_at = '2026-10-18T00:00:00Z',
                search_source_fingerprint = ?1, search_extractor_version = 1000
             WHERE id = ?2",
            (stored, locator.id.as_str()),
        )
        .unwrap();
}

fn observe(db: &IndexDb, locator: &SessionLocator, name: &str) {
    db.conn
        .execute(
            "INSERT INTO session_format_observations (session_id, kind, name, record_count)
             VALUES (?1, 'record', ?2, 3)",
            (locator.id.as_str(), name),
        )
        .unwrap();
}

fn request_observations(db: &IndexDb, locator: &SessionLocator) -> i64 {
    db.conn
        .query_row(
            "SELECT COUNT(*) FROM session_format_observations
             WHERE session_id = ?1 AND name LIKE 'api-request%'",
            [locator.id.as_str()],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn a_session_whose_observations_list_request_records_is_reindexed_once() {
    let mut t = Transcript::main();
    t.prompt("Hi.");
    t.api_request("req-1", None, "shape-1", OPUS, &[]);
    t.call(
        "msg_1",
        OPUS,
        vec![text("Hello.")],
        Usage::new(1, 1, 0, 1),
        "end_turn",
    );
    let files = write_session(&t, &[]);
    let provider: Arc<dyn SessionProvider> = Arc::new(ClaudeCodeProvider::new(files.root.path()));
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let db = IndexDb::open_or_create(&files.root.path().join("index.db")).unwrap();
    index(&db, &provider, &locator);
    index_search(&db, &provider, &locator);

    // Other unmapped types leave the session current.
    observe(&db, &locator, "brand-new-record");
    assert!(!db.session_is_stale(provider.as_ref(), &locator));
    assert!(!db.search_is_stale(provider.as_ref(), &locator));

    // As the earlier parser stored it.
    observe(&db, &locator, "api-request");
    observe(&db, &locator, "api-request-shape");
    assert!(db.session_is_stale(provider.as_ref(), &locator));
    assert!(
        !db.search_is_stale(provider.as_ref(), &locator),
        "search follows the metadata pass"
    );

    index(&db, &provider, &locator);
    assert_eq!(request_observations(&db, &locator), 0);
    assert!(!db.session_is_stale(provider.as_ref(), &locator), "once");
    assert!(db.search_is_stale(provider.as_ref(), &locator));

    index_search(&db, &provider, &locator);
    assert!(!db.search_is_stale(provider.as_ref(), &locator), "once");
    index(&db, &provider, &locator);
    assert!(!db.search_is_stale(provider.as_ref(), &locator));
}
