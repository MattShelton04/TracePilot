//! Session source identity: the upsert source guard, per-source pruning and
//! `source` on listed rows.

use std::collections::HashSet;

use tracepilot_core::provider::{SessionRole, SessionSource};

use super::common::write_session_with_tools;
use crate::error::IndexerError;
use crate::index_db::{IndexDb, session_writer};

const COPILOT_ID: &str = "11111111-1111-4111-8111-111111111111";
const OTHER_ID: &str = "22222222-2222-4222-8222-222222222222";

fn setup() -> (tempfile::TempDir, IndexDb) {
    let temp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    for id in [COPILOT_ID, OTHER_ID] {
        let path = write_session_with_tools(temp.path(), id, "org/repo", "2026-03-10T07:15:00Z");
        db.upsert_session(&path).unwrap();
    }
    (temp, db)
}

/// Stand-in for a row another provider wrote, until one is wired in (F6).
fn claim_for_claude(db: &IndexDb, id: &str) {
    db.conn
        .execute(
            "UPDATE sessions SET source = 'claudeCode' WHERE id = ?1",
            [id],
        )
        .unwrap();
}

fn identity_row(db: &IndexDb, id: &str) -> (String, Option<String>, String, i64, Option<String>) {
    db.conn
        .query_row(
            "SELECT source, parent_session_id, role, hidden, source_format_version
             FROM sessions WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap()
}

fn tool_call_rows(db: &IndexDb, id: &str) -> i64 {
    db.conn
        .query_row(
            "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn copilot_upsert_writes_copilot_identity() {
    let (_temp, db) = setup();
    assert_eq!(
        identity_row(&db, COPILOT_ID),
        ("copilot".into(), None, "primary".into(), 0, None)
    );
}

#[test]
fn upsert_refuses_a_row_owned_by_another_source() {
    let (temp, db) = setup();
    claim_for_claude(&db, OTHER_ID);
    let summary_before: Option<String> = db
        .conn
        .query_row(
            "SELECT summary FROM sessions WHERE id = ?1",
            [OTHER_ID],
            |r| r.get(0),
        )
        .unwrap();
    let tool_calls_before = tool_call_rows(&db, OTHER_ID);
    assert!(tool_calls_before > 0);

    let err = db.upsert_session(&temp.path().join(OTHER_ID)).unwrap_err();
    assert!(
        matches!(
            &err,
            IndexerError::SourceConflict { session_id, existing, incoming }
                if session_id == OTHER_ID && existing == "claudeCode" && incoming == "copilot"
        ),
        "unexpected error: {err}"
    );

    // The existing row and its child rows are untouched.
    assert_eq!(identity_row(&db, OTHER_ID).0, "claudeCode");
    let summary_after: Option<String> = db
        .conn
        .query_row(
            "SELECT summary FROM sessions WHERE id = ?1",
            [OTHER_ID],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(summary_after, summary_before);
    assert_eq!(tool_call_rows(&db, OTHER_ID), tool_calls_before);
}

#[test]
fn upsert_writes_and_updates_family_identity() {
    let (temp, db) = setup();
    let mut prepared = session_writer::prepare_session_data(&temp.path().join(OTHER_ID)).unwrap();
    prepared.identity.parent_session_id = Some(COPILOT_ID.into());
    prepared.identity.role = SessionRole::Guardian;
    prepared.identity.source_format_version = Some("2.1.0".into());
    db.write_prepared_session(&prepared).unwrap();
    assert_eq!(
        identity_row(&db, OTHER_ID),
        (
            "copilot".into(),
            Some(COPILOT_ID.into()),
            "guardian".into(),
            1,
            Some("2.1.0".into())
        )
    );

    db.upsert_session(&temp.path().join(OTHER_ID)).unwrap();
    assert_eq!(
        identity_row(&db, OTHER_ID),
        ("copilot".into(), None, "primary".into(), 0, None)
    );
}

#[test]
fn prune_only_touches_the_given_source() {
    let (_temp, db) = setup();
    claim_for_claude(&db, OTHER_ID);
    let none = HashSet::new();

    assert_eq!(db.prune_deleted(SessionSource::Copilot, &none).unwrap(), 1);
    let remaining: Vec<_> = db
        .list_sessions(None, None, None, false)
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(remaining, [OTHER_ID]);

    assert_eq!(
        db.prune_deleted(SessionSource::ClaudeCode, &none).unwrap(),
        1
    );
    assert_eq!(db.session_count().unwrap(), 0);
}

#[test]
fn prune_keeps_live_ids_of_the_source() {
    let (_temp, db) = setup();
    claim_for_claude(&db, OTHER_ID);
    let live: HashSet<&str> = [COPILOT_ID].into();

    assert_eq!(db.prune_deleted(SessionSource::Copilot, &live).unwrap(), 0);
    assert_eq!(db.session_count().unwrap(), 2);
}

#[test]
fn listed_and_searched_rows_carry_their_source() {
    let (_temp, db) = setup();
    claim_for_claude(&db, OTHER_ID);

    let mut listed: Vec<_> = db
        .list_sessions(None, None, None, false)
        .unwrap()
        .into_iter()
        .map(|s| (s.id, s.source))
        .collect();
    listed.sort();
    assert_eq!(
        listed,
        [
            (COPILOT_ID.to_string(), SessionSource::Copilot),
            (OTHER_ID.to_string(), SessionSource::ClaudeCode),
        ]
    );

    let searched = db.search_sessions("tools").unwrap();
    assert_eq!(searched.len(), 2);
    assert!(
        searched
            .iter()
            .any(|s| s.id == OTHER_ID && s.source == SessionSource::ClaudeCode)
    );
}

#[test]
fn unknown_stored_source_is_a_read_error() {
    let (_temp, db) = setup();
    db.conn
        .execute(
            "UPDATE sessions SET source = 'futureSource' WHERE id = ?1",
            [OTHER_ID],
        )
        .unwrap();
    assert!(db.list_sessions(None, None, None, false).is_err());
}
