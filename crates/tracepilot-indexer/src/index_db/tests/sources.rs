//! Session source identity: the source guard on metadata and search writes,
//! per-source pruning, `source` on listed rows, and billing columns that
//! follow the provider's capabilities rather than its source.

use std::collections::HashSet;
use std::sync::Arc;

use tracepilot_core::error::Result as CoreResult;
use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::{
    CopilotProvider, Liveness, ProviderSnapshot, SessionLocator, SessionProvider, SessionRole,
    SessionSource, SourceCapabilities, SourceFingerprint,
};

use super::common::write_session_with_tools;
use crate::error::IndexerError;
use crate::index_db::search_writer::SearchContentRow;
use crate::index_db::{IndexDb, session_writer};
use crate::{reindex_all, reindex_incremental, reindex_search_content};

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

fn search_row(id: &str, content: &str) -> SearchContentRow {
    SearchContentRow {
        session_id: id.to_string(),
        content_type: "user_message",
        turn_number: Some(0),
        event_index: 0,
        timestamp_unix: None,
        tool_name: None,
        content: content.to_string(),
        metadata_json: None,
    }
}

/// Give `id` to Claude Code with its own search snapshot.
fn claim_with_search(db: &IndexDb, id: &str) {
    claim_for_claude(db, id);
    let session_id = SessionId::from_validated(id);
    db.upsert_search_snapshot(
        SessionSource::ClaudeCode,
        &session_id,
        &[search_row(id, "claude_search_sentinel")],
        Some("claude-fingerprint"),
        &|| false,
    )
    .unwrap();
}

/// `(search contents, search_source_fingerprint)` for one session.
fn search_state(db: &IndexDb, id: &str) -> (Vec<String>, Option<String>) {
    let contents = db
        .conn
        .prepare("SELECT content FROM search_content WHERE session_id = ?1 ORDER BY content")
        .unwrap()
        .query_map([id], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let fingerprint = db
        .conn
        .query_row(
            "SELECT search_source_fingerprint FROM sessions WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    (contents, fingerprint)
}

fn claude_search_state() -> (Vec<String>, Option<String>) {
    (
        vec!["claude_search_sentinel".to_string()],
        Some("claude-fingerprint".to_string()),
    )
}

#[test]
fn rejected_session_keeps_its_search_content_through_both_phases() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("session-state");
    let db_path = temp.path().join("index.db");
    write_session_with_tools(&root, COPILOT_ID, "org/repo", "2026-03-10T07:15:00Z");
    reindex_all(&root, &db_path).unwrap();
    reindex_search_content(&root, &db_path, |_| {}, || false).unwrap();

    let db = IndexDb::open_or_create(&db_path).unwrap();
    claim_with_search(&db, COPILOT_ID);
    // Make Phase 1 see the Copilot files as changed.
    db.conn
        .execute(
            "UPDATE sessions SET summary = 'Claude original', source_fingerprint = NULL",
            [],
        )
        .unwrap();
    drop(db);

    assert_eq!(reindex_incremental(&root, &db_path).unwrap(), (0, 0));
    assert_eq!(
        reindex_search_content(&root, &db_path, |_| {}, || false).unwrap(),
        (0, 0)
    );

    let db = IndexDb::open_readonly(&db_path).unwrap();
    assert_eq!(identity_row(&db, COPILOT_ID).0, "claudeCode");
    let summary: Option<String> = db
        .conn
        .query_row("SELECT summary FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(summary.as_deref(), Some("Claude original"));
    assert_eq!(search_state(&db, COPILOT_ID), claude_search_state());
}

#[test]
fn coalesced_search_write_skips_only_the_conflicting_session() {
    let (_temp, db) = setup();
    claim_with_search(&db, OTHER_ID);
    let batch: Vec<_> = [COPILOT_ID, OTHER_ID]
        .map(|id| {
            (
                SessionId::from_validated(id),
                vec![search_row(id, "copilot_text")],
            )
        })
        .into();

    let written = db
        .upsert_search_snapshots(
            SessionSource::Copilot,
            &batch,
            &["copilot-a".into(), "copilot-b".into()],
            &|| false,
        )
        .unwrap();

    assert_eq!(written, 1);
    assert_eq!(
        search_state(&db, COPILOT_ID),
        (vec!["copilot_text".into()], Some("copilot-a".into()))
    );
    assert_eq!(search_state(&db, OTHER_ID), claude_search_state());
}

#[test]
fn bulk_search_write_rolls_back_on_a_conflicting_session() {
    let (_temp, db) = setup();
    claim_with_search(&db, OTHER_ID);
    let copilot_before = search_state(&db, COPILOT_ID);
    let batch: Vec<_> = [COPILOT_ID, OTHER_ID]
        .map(|id| {
            (
                SessionId::from_validated(id),
                vec![search_row(id, "copilot_text")],
            )
        })
        .into();

    let err = db
        .bulk_write_search_snapshots(
            SessionSource::Copilot,
            &batch,
            &["copilot-a".into(), "copilot-b".into()],
            &|| false,
        )
        .unwrap_err();

    assert!(matches!(err, IndexerError::SourceConflict { .. }), "{err}");
    assert_eq!(search_state(&db, COPILOT_ID), copilot_before);
    assert_eq!(search_state(&db, OTHER_ID), claude_search_state());
    let triggers: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'trigger' AND name LIKE 'search_content_a%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(triggers, 3, "FTS triggers restored after rollback");
}

#[test]
fn session_locator_reads_the_stored_source_path_and_family() {
    let (temp, db) = setup();
    let copilot = db
        .get_session_locator(&SessionId::from_validated(COPILOT_ID))
        .unwrap()
        .unwrap();
    assert_eq!(copilot.source, SessionSource::Copilot);
    assert_eq!(copilot.primary_path, temp.path().join(COPILOT_ID));
    assert_eq!(copilot.role, SessionRole::Primary);
    assert_eq!(copilot.parent_id, None);

    claim_for_claude(&db, OTHER_ID);
    db.conn
        .execute(
            "UPDATE sessions SET role = 'subagent', parent_session_id = ?1 WHERE id = ?2",
            [COPILOT_ID, OTHER_ID],
        )
        .unwrap();
    let other = db
        .get_session_locator(&SessionId::from_validated(OTHER_ID))
        .unwrap()
        .unwrap();
    assert_eq!(other.source, SessionSource::ClaudeCode);
    assert_eq!(other.role, SessionRole::Subagent);
    assert_eq!(
        other.parent_id.as_ref().map(SessionId::as_str),
        Some(COPILOT_ID)
    );

    // A source only a newer build knows is not resolvable here.
    db.conn
        .execute(
            "UPDATE sessions SET source = 'codex' WHERE id = ?1",
            [OTHER_ID],
        )
        .unwrap();
    let unknown = SessionId::from_validated(OTHER_ID);
    assert_eq!(db.get_session_locator(&unknown).unwrap(), None);
    // The raw name stays readable so import can still refuse the id.
    assert_eq!(
        db.get_session_source_name(&unknown).unwrap().as_deref(),
        Some("codex")
    );
    let missing = SessionId::from_validated("33333333-3333-4333-8333-333333333333");
    assert_eq!(db.get_session_locator(&missing).unwrap(), None);
    assert_eq!(db.get_session_source_name(&missing).unwrap(), None);
}

/// A third source that reads Copilot-shaped files but bills differently from
/// both real sources: no premium requests or AIC, yet final exit totals.
struct ThirdSource(CopilotProvider);

impl SessionProvider for ThirdSource {
    fn source(&self) -> SessionSource {
        self.0.source()
    }
    fn capabilities(&self) -> SourceCapabilities {
        SourceCapabilities {
            has_exit_metrics: true,
            ..SourceCapabilities::default()
        }
    }
    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> CoreResult<Vec<SessionLocator>> {
        self.0.discover(is_cancelled)
    }
    fn fingerprint(&self, session: &SessionLocator) -> CoreResult<SourceFingerprint> {
        self.0.fingerprint(session)
    }
    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<ProviderSnapshot> {
        self.0.load_snapshot(session, strict, is_cancelled)
    }
    fn liveness(&self, session: &SessionLocator) -> Liveness {
        self.0.liveness(session)
    }
    fn resolve(&self, id: &SessionId) -> CoreResult<Option<SessionLocator>> {
        self.0.resolve(id)
    }
}

fn cost_columns(db: &IndexDb, id: &str) -> (Option<f64>, Option<f64>, Option<f64>) {
    db.conn
        .query_row(
            "SELECT s.total_cost, m.cost, s.cost_usd FROM sessions s
             JOIN session_model_metrics m ON m.session_id = s.id WHERE s.id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap()
}

#[test]
fn premium_request_cost_follows_capabilities_not_the_source_name() {
    let (temp, db) = setup();
    // The same shutdown totals indexed by Copilot carry premium-request cost.
    assert_eq!(cost_columns(&db, COPILOT_ID), (Some(0.5), Some(0.5), None));

    let provider: Arc<dyn SessionProvider> =
        Arc::new(ThirdSource(CopilotProvider::new(temp.path())));
    let locator = provider
        .discover(&|| false)
        .unwrap()
        .into_iter()
        .find(|locator| locator.id.as_str() == COPILOT_ID)
        .unwrap();
    let prepared = session_writer::prepare_snapshot(&provider, &locator, &|| false).unwrap();
    db.write_prepared_session(&prepared).unwrap();
    // No premium-request cost, and with exit totals but no provider metrics
    // the session stays unpriced rather than free.
    assert_eq!(cost_columns(&db, COPILOT_ID), (None, None, None));
}
