//! Enrichment lifecycle: replacement, survival across baseline reindex,
//! pruning rules, generations and paging.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tracepilot_core::session_store::{
    ReconciliationReport, SessionCoverage, SourceAvailability, SourceBinding, SourceReader,
    StoreRequest, WorkRef, read_session,
};

use crate::index_db::IndexDb;
use crate::index_db::enrichment::{
    RequestCursor, RequestLedgerFilter, SessionEnrichmentWrite, StoreSourceRow,
};

const SESSION: &str = "c0ffee00-1111-2222-3333-444455556666";

fn write_raw_session(root: &Path, session_id: &str, repo: &str) -> PathBuf {
    let dir = root.join(session_id);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {session_id}\nsummary: \"Store session\"\nrepository: \"{repo}\"\n\
             created_at: \"2026-09-10T00:00:00Z\"\nupdated_at: \"2026-09-12T01:00:00Z\"\n"
        ),
    )
    .unwrap();
    fs::write(
        dir.join("events.jsonl"),
        "{\"type\":\"user.message\",\"data\":{\"content\":\"hi\"},\"id\":\"e1\",\
         \"timestamp\":\"2026-09-10T00:00:01.000Z\",\"parentId\":null}\n",
    )
    .unwrap();
    dir
}

/// A synthetic source store with one session and one request.
struct SourceFixture {
    dir: tempfile::TempDir,
    db_path: PathBuf,
}

impl SourceFixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("session-store.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, repository TEXT);
             CREATE TABLE assistant_usage_events (
                 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                 model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
                 cache_read_tokens INTEGER, total_nano_aiu INTEGER, duration_ms INTEGER,
                 initiator TEXT, agent_id TEXT, token_details_json TEXT, created_at TEXT);
             CREATE TABLE session_refs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                 ref_type TEXT NOT NULL, ref_value TEXT NOT NULL);
             CREATE TABLE schema_version (version INTEGER);
             INSERT INTO schema_version (version) VALUES (8);",
        )
        .unwrap();
        drop(conn);
        Self { dir, db_path }
    }

    fn binding(&self) -> SourceBinding {
        SourceBinding {
            db_path: self.db_path.clone(),
            copilot_home: self.dir.path().to_path_buf(),
            session_state_dir: self.dir.path().join("session-state"),
            source_id: "fixture-source".to_string(),
        }
    }

    fn seed(&self, session_id: &str, requests: usize, refs: &[(&str, &str)]) {
        let conn = Connection::open(&self.db_path).unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO sessions (id, repository) VALUES (?1, 'owner/name')",
            [session_id],
        )
        .unwrap();
        for index in 0..requests {
            conn.execute(
                "INSERT INTO assistant_usage_events
                 (session_id, model, input_tokens, output_tokens, cache_read_tokens,
                  total_nano_aiu, duration_ms, created_at, token_details_json)
                 VALUES (?1, 'gpt-5.6-luna', 1000, 200, 800, 1000000, 4000, ?2,
                         '[{\"tokenType\":\"input\",\"tokenCount\":200,\"batchSize\":1000000,\"costPerBatch\":5000000}]')",
                rusqlite::params![
                    session_id,
                    format!("2026-09-20T10:00:{:02}.000Z", index)
                ],
            )
            .unwrap();
        }
        for (kind, value) in refs {
            conn.execute(
                "INSERT INTO session_refs (session_id, ref_type, ref_value) VALUES (?1, ?2, ?3)",
                rusqlite::params![session_id, kind, value],
            )
            .unwrap();
        }
    }

    fn delete_requests(&self) {
        Connection::open(&self.db_path)
            .unwrap()
            .execute("DELETE FROM assistant_usage_events", [])
            .unwrap();
    }
}

/// Index a baseline session and write its enrichment from a source fixture.
fn indexed(source: &SourceFixture) -> (tempfile::TempDir, IndexDb, PathBuf, String) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session_dir = write_raw_session(tmp.path(), SESSION, "owner/name");
    db.upsert_session(&session_dir).unwrap();
    let generation = refresh(&db, source);
    (tmp, db, session_dir, generation)
}

/// Read the source and replace the session's enrichment, as the pass does.
fn refresh(db: &IndexDb, source: &SourceFixture) -> String {
    let binding = source.binding();
    let reader = SourceReader::open(&binding).unwrap();
    let generation = reader.generation_fingerprint().unwrap();
    db.upsert_store_source(
        &StoreSourceRow::ready(&binding, &generation, reader.capabilities()),
        true,
    )
    .unwrap();
    let enrichment = read_session(&reader, SESSION).unwrap();
    let links = db
        .build_request_links(SESSION, &enrichment.requests, &[], None)
        .unwrap();
    db.replace_session_enrichment(&SessionEnrichmentWrite {
        source_id: &binding.source_id,
        generation: &generation,
        session_id: SESSION,
        requests: &enrichment.requests,
        work_refs: &enrichment.work_refs,
        links: &links,
        coverage: &enrichment.coverage,
    })
    .unwrap();
    generation
}

fn count(db: &IndexDb, table: &str) -> i64 {
    db.conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn a_refresh_stores_requests_billing_items_and_refs() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[("pr", "123"), ("commit", "feature/branch")]);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    assert_eq!(count(&db, "session_request_usage"), 2);
    assert_eq!(count(&db, "session_request_billing_items"), 2);
    assert_eq!(count(&db, "session_work_refs"), 2);

    let refs = db.list_session_work_refs(SESSION).unwrap();
    let git_ref = refs.iter().find(|r| r.kind == "gitRef").unwrap();
    // A branch name recorded as a "commit" is a Git ref, not a SHA.
    assert!(!git_ref.sha_shaped);
    let pull_request = refs.iter().find(|r| r.kind == "pullRequest").unwrap();
    assert_eq!(pull_request.resolution, "sessionContext");
}

#[test]
fn a_repeated_refresh_replaces_rather_than_appends_and_reports_no_change() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[("pr", "123")]);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    let before = db.session_store_status().unwrap().unwrap().revision;
    refresh(&db, &source);
    let after = db.session_store_status().unwrap().unwrap().revision;

    assert_eq!(count(&db, "session_request_usage"), 2);
    // Nothing a reader would see moved, so no revision is published and no
    // UI cache is invalidated.
    assert_eq!(before, after);
}

#[test]
fn a_baseline_reindex_keeps_enrichment_the_store_cannot_repopulate() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[("pr", "123")]);
    let (_tmp, db, session_dir, _generation) = indexed(&source);

    // The baseline pipeline re-runs whenever the log changes. It has no
    // access to the external store, so wiping these rows here would destroy
    // data on every unrelated edit.
    db.upsert_session(&session_dir).unwrap();

    assert_eq!(count(&db, "session_request_usage"), 2);
    assert_eq!(count(&db, "session_work_refs"), 1);
    assert_eq!(count(&db, "session_store_coverage"), 1);
}

#[test]
fn deleting_a_session_cascades_its_enrichment() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[("pr", "123")]);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    db.prune_deleted(&std::collections::HashSet::new()).unwrap();

    assert_eq!(count(&db, "session_request_usage"), 0);
    assert_eq!(count(&db, "session_request_billing_items"), 0);
    assert_eq!(count(&db, "session_work_refs"), 0);
    assert_eq!(count(&db, "session_store_coverage"), 0);
}

#[test]
fn a_successful_empty_read_prunes_the_sessions_former_rows() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[("pr", "123")]);
    let (_tmp, db, _dir, _generation) = indexed(&source);
    assert_eq!(count(&db, "session_request_usage"), 2);

    // A healthy read confirming the source now has nothing is the one case
    // that may remove cached rows.
    source.delete_requests();
    refresh(&db, &source);

    assert_eq!(count(&db, "session_request_usage"), 0);
    assert_eq!(count(&db, "session_work_refs"), 1);
}

#[test]
fn an_unreadable_source_keeps_cached_rows_and_marks_them_stale() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[("pr", "123")]);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    let binding = source.binding();
    let missing = SourceBinding {
        db_path: binding.db_path.with_file_name("gone.db"),
        ..binding.clone()
    };
    let error = SourceReader::open(&missing).unwrap_err();
    db.mark_source_unavailable(&binding, error.availability(), &error)
        .unwrap();
    db.mark_enrichment_stale().unwrap();

    assert_eq!(count(&db, "session_request_usage"), 2);
    let coverage = db.session_store_coverage(SESSION).unwrap().unwrap();
    assert_eq!(coverage.freshness, "stale");
    let status = db.session_store_status().unwrap().unwrap();
    assert_eq!(status.availability, SourceAvailability::Missing.as_str());
    // A failed attempt must not erase when the source was last read.
    assert!(status.last_success_at.is_some());
    // Routine status must not carry the resolved path.
    assert!(!status.status_detail.unwrap().contains("gone.db"));
}

#[test]
fn disabling_the_feature_purges_every_owned_row() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[("pr", "123")]);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    db.purge_session_store_enrichment().unwrap();

    for table in [
        "session_request_usage",
        "session_request_billing_items",
        "session_work_refs",
        "session_store_coverage",
        "session_store_sources",
        "session_request_links",
    ] {
        assert_eq!(count(&db, table), 0, "{table} must be purged");
    }
    // The baseline session itself is untouched.
    assert_eq!(count(&db, "sessions"), 1);
}

#[test]
fn a_cursor_from_a_superseded_generation_is_rejected_not_honoured() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[]);
    let (_tmp, db, _dir, generation) = indexed(&source);

    let page = db
        .list_request_usage(&RequestLedgerFilter {
            session_id: Some(SESSION.to_string()),
            after: Some(RequestCursor {
                generation: "an-older-generation".to_string(),
                recorded_at: None,
                source_row_id: 0,
            }),
            ..Default::default()
        })
        .unwrap();

    assert!(page.cursor_expired);
    assert!(page.requests.is_empty());
    assert_eq!(page.generation.as_deref(), Some(generation.as_str()));
}

#[test]
fn paging_is_stable_across_rows_sharing_a_timestamp() {
    let source = SourceFixture::new();
    // All three rows carry the same recorded time, so only the row-ID tie
    // break keeps a cursor from skipping or repeating one.
    let conn = Connection::open(&source.db_path).unwrap();
    conn.execute(
        "INSERT INTO sessions (id, repository) VALUES (?1, 'owner/name')",
        [SESSION],
    )
    .unwrap();
    for _ in 0..3 {
        conn.execute(
            "INSERT INTO assistant_usage_events (session_id, model, created_at)
             VALUES (?1, 'gpt-5.6-luna', '2026-09-20T10:00:00.000Z')",
            [SESSION],
        )
        .unwrap();
    }
    drop(conn);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    let first = db
        .list_request_usage(&RequestLedgerFilter {
            session_id: Some(SESSION.to_string()),
            limit: Some(2),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(first.requests.len(), 2);
    let cursor = first.next_cursor.clone().expect("a further page");

    let second = db
        .list_request_usage(&RequestLedgerFilter {
            session_id: Some(SESSION.to_string()),
            limit: Some(2),
            after: Some(cursor),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(second.requests.len(), 1);
    assert!(!second.requests.iter().any(|request| {
        first
            .requests
            .iter()
            .any(|seen| seen.source_row_id == request.source_row_id)
    }));
}

#[test]
fn an_index_without_migration_20_reports_enrichment_unavailable() {
    // `open_readonly` skips migrations, so the baseline views must keep
    // working against a database that predates these tables.
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("legacy.db");
    Connection::open(&db_path)
        .unwrap()
        .execute_batch("CREATE TABLE sessions (id TEXT PRIMARY KEY);")
        .unwrap();
    let db = IndexDb::open_readonly(&db_path).unwrap();

    assert!(!db.has_session_store_enrichment());
    assert!(db.session_store_status().unwrap().is_none());
    assert!(db.list_session_work_refs(SESSION).unwrap().is_empty());
    let page = db
        .list_request_usage(&RequestLedgerFilter::default())
        .unwrap();
    assert!(!page.available);
    assert!(page.requests.is_empty());
}

#[test]
fn enrichment_is_not_written_for_a_session_the_baseline_has_not_indexed() {
    let source = SourceFixture::new();
    source.seed(SESSION, 1, &[]);
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let coverage = SessionCoverage {
        session_id: SESSION.to_string(),
        source_id: "fixture-source".to_string(),
        generation: "g1".to_string(),
        availability: SourceAvailability::Ready,
        freshness: tracepilot_core::session_store::Freshness::Current,
        request_rows: 0,
        request_rows_rejected: 0,
        work_ref_rows: 0,
        work_ref_rows_rejected: 0,
        billing_absent: 0,
        billing_partial: 0,
        billing_invalid: 0,
        fields: Default::default(),
        missing_columns: Vec::new(),
        schema_version: None,
        read_at: "2026-09-20T10:00:00Z".to_string(),
        reconciliation: ReconciliationReport::unverified("test"),
    };
    let requests: Vec<StoreRequest> = Vec::new();
    let work_refs: Vec<WorkRef> = Vec::new();
    let changed = db
        .replace_session_enrichment(&SessionEnrichmentWrite {
            source_id: "fixture-source",
            generation: "g1",
            session_id: SESSION,
            requests: &requests,
            work_refs: &work_refs,
            links: &[],
            coverage: &coverage,
        })
        .unwrap();

    // The foreign keys would reject every insert, so the write is skipped
    // rather than attempted and failed.
    assert!(!changed);
    assert_eq!(count(&db, "session_store_coverage"), 0);
}

#[test]
fn cross_session_performance_reports_per_model_populations() {
    let source = SourceFixture::new();
    // Two models, so the report has something to separate. Both requests
    // carry a duration; only the fixture's default timings exist, which is
    // exactly the partial-coverage case the distributions must describe.
    let conn = Connection::open(&source.db_path).unwrap();
    conn.execute(
        "INSERT INTO sessions (id, repository) VALUES (?1, 'owner/name')",
        [SESSION],
    )
    .unwrap();
    for (model, duration) in [("gpt-5.6-luna", 4000), ("other-model", 9000)] {
        conn.execute(
            "INSERT INTO assistant_usage_events
             (session_id, model, input_tokens, cache_read_tokens, duration_ms, created_at)
             VALUES (?1, ?2, 1000, 800, ?3, '2026-09-20T10:00:00.000Z')",
            rusqlite::params![SESSION, model, duration],
        )
        .unwrap();
    }
    drop(conn);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    let report = db
        .query_request_performance(&crate::index_db::RequestPerformanceFilter::default())
        .unwrap();
    assert!(report.available);
    assert_eq!(report.session_count, 1);
    assert_eq!(report.by_model.len(), 2);
    let overall = report.overall.expect("a populated overall distribution");
    assert_eq!(overall.request_count, 2);
    assert_eq!(overall.duration_ms.median, Some(6500.0));
    // Two samples is far below the p95 threshold; the median still shows.
    assert_eq!(overall.duration_ms.p95, None);

    let filtered = db
        .query_request_performance(&crate::index_db::RequestPerformanceFilter {
            models: vec!["other-model".to_string()],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(filtered.by_model.len(), 1);
    assert_eq!(
        filtered
            .overall
            .expect("filtered distribution")
            .request_count,
        1
    );
}

#[test]
fn a_filter_matching_nothing_is_still_an_available_source() {
    let source = SourceFixture::new();
    source.seed(SESSION, 1, &[]);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    let report = db
        .query_request_performance(&crate::index_db::RequestPerformanceFilter {
            repository: Some("someone/else".to_string()),
            ..Default::default()
        })
        .unwrap();

    // "The filter matched nothing" and "there is no source" are different
    // statements, and a zero-valued distribution would read as a measurement.
    assert!(report.available);
    assert!(report.overall.is_none());
    assert!(report.by_model.is_empty());
}

#[test]
fn performance_is_unavailable_without_enrichment_tables() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("legacy.db");
    Connection::open(&db_path)
        .unwrap()
        .execute_batch("CREATE TABLE sessions (id TEXT PRIMARY KEY);")
        .unwrap();
    let db = IndexDb::open_readonly(&db_path).unwrap();

    let report = db
        .query_request_performance(&crate::index_db::RequestPerformanceFilter::default())
        .unwrap();
    assert!(!report.available);
    assert!(db.query_agent_request_rollups(SESSION).unwrap().is_empty());
}

#[test]
fn agent_rollups_keep_own_credits_exact_and_show_unattributed_work() {
    let source = SourceFixture::new();
    // Two root requests with large nano totals that lose precision as f64.
    let conn = Connection::open(&source.db_path).unwrap();
    conn.execute(
        "INSERT INTO sessions (id, repository) VALUES (?1, 'owner/name')",
        [SESSION],
    )
    .unwrap();
    for _ in 0..2 {
        conn.execute(
            "INSERT INTO assistant_usage_events
             (session_id, model, input_tokens, cache_read_tokens, total_nano_aiu, created_at)
             VALUES (?1, 'gpt-5.6-luna', 1000, 800, 9007199254740993, '2026-09-20T10:00:00.000Z')",
            [SESSION],
        )
        .unwrap();
    }
    drop(conn);
    let (_tmp, db, _dir, _generation) = indexed(&source);

    let rollups = db.query_agent_request_rollups(SESSION).unwrap();
    assert_eq!(rollups.len(), 1);
    let rollup = &rollups[0];
    assert_eq!(rollup.request_count, 2);
    // Summed with exact decimal arithmetic: f64 would have rounded this.
    assert_eq!(rollup.own_nano_aiu.as_deref(), Some("18014398509481986"));
    assert_eq!(rollup.cache_read_tokens, 1600);
    // No agent ID and no run to join to, so both requests are unattributed
    // and say so rather than vanishing from the breakdown.
    assert_eq!(rollup.unattributed_requests, 2);
}
