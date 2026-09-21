use super::*;
use crate::indexing::enrichment::refresh_bound_source;

#[test]
fn a_refs_only_source_does_not_claim_request_coverage() {
    let source = SourceFixture::new();
    source.seed(SESSION, 0, &[("pr", "123")]);
    Connection::open(&source.db_path)
        .unwrap()
        .execute_batch("DROP TABLE assistant_usage_events")
        .unwrap();
    let (_tmp, db, _, _) = indexed(&source);
    assert!(db.has_session_store_capability("workRefs").unwrap());
    assert!(!db.has_session_store_capability("requests").unwrap());
    assert!(
        !db.list_request_usage(&RequestLedgerFilter::default())
            .unwrap()
            .available
    );
    assert!(
        !db.query_request_performance(&Default::default())
            .unwrap()
            .available
    );
    assert_eq!(db.list_session_work_refs(SESSION).unwrap().len(), 1);
}

#[test]
fn rollups_do_not_publish_partial_credits_or_unpaired_cache_ratios() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[]);
    Connection::open(&source.db_path).unwrap().execute(
        "UPDATE assistant_usage_events SET total_nano_aiu = NULL, cache_read_tokens = NULL WHERE id = 2", [],
    ).unwrap();
    let (_tmp, db, _, _) = indexed(&source);
    let rollups = db.query_agent_request_rollups(SESSION).unwrap();
    assert_eq!(rollups.len(), 1);
    assert_eq!(rollups[0].request_count, 2);
    assert_eq!(rollups[0].own_nano_aiu, None);
    assert_eq!(rollups[0].input_tokens, 1000);
    assert_eq!(rollups[0].cache_read_tokens, 800);
    assert_eq!(rollups[0].unattributed_requests, 2);
}

#[test]
fn a_missing_new_binding_does_not_publish_the_old_sources_cache() {
    let source = SourceFixture::new();
    source.seed(SESSION, 1, &[("pr", "123")]);
    let (_tmp, db, _, _) = indexed(&source);
    let mut binding = source.binding();
    binding.source_id = "new-source".into();
    binding.db_path = source.dir.path().join("missing.db");
    db.mark_source_unavailable(
        &binding,
        SourceAvailability::Missing,
        &tracepilot_core::session_store::SessionStoreError::Missing(binding.db_path.clone()),
    )
    .unwrap();
    assert!(db.active_generation().unwrap().is_none());
    assert!(
        !db.list_request_usage(&RequestLedgerFilter::default())
            .unwrap()
            .available
    );
    assert!(db.list_session_work_refs(SESSION).unwrap().is_empty());
    assert_eq!(count(&db, "session_request_usage"), 1);
}

#[test]
fn null_timestamp_rows_remain_reachable_after_dated_pages() {
    let source = SourceFixture::new();
    source.seed(SESSION, 4, &[]);
    Connection::open(&source.db_path)
        .unwrap()
        .execute(
            "UPDATE assistant_usage_events SET created_at = NULL WHERE id > 2",
            [],
        )
        .unwrap();
    let (_tmp, db, _, _) = indexed(&source);
    let mut cursor = None;
    let mut ids = Vec::new();
    loop {
        let page = db
            .list_request_usage(&RequestLedgerFilter {
                session_id: Some(SESSION.into()),
                limit: Some(1),
                after: cursor,
                ..Default::default()
            })
            .unwrap();
        ids.extend(page.requests.iter().map(|request| request.source_row_id));
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(ids, vec![1, 2, 3, 4]);
}

#[test]
fn same_size_rewrite_expires_page_cursor() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[]);
    let (_tmp, db, _, _) = indexed(&source);
    let first = db
        .list_request_usage(&RequestLedgerFilter {
            limit: Some(1),
            ..Default::default()
        })
        .unwrap();
    Connection::open(&source.db_path)
        .unwrap()
        .execute(
            "UPDATE assistant_usage_events SET output_tokens = 999 WHERE id = 1",
            [],
        )
        .unwrap();
    refresh(&db, &source);
    let next = db
        .list_request_usage(&RequestLedgerFilter {
            after: first.next_cursor,
            ..Default::default()
        })
        .unwrap();
    assert!(next.cursor_expired);
}

#[test]
fn failed_first_attempt_does_not_claim_an_empty_available_source() {
    let source = SourceFixture::new();
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    db.mark_source_unavailable(
        &source.binding(),
        SourceAvailability::Busy,
        &tracepilot_core::session_store::SessionStoreError::Busy("locked".into()),
    )
    .unwrap();
    assert!(
        !db.list_request_usage(&RequestLedgerFilter::default())
            .unwrap()
            .available
    );
    assert!(
        !db.query_request_performance(&Default::default())
            .unwrap()
            .available
    );
}

#[test]
fn date_filter_includes_end_day_and_preserves_invalid_timing_coverage() {
    let source = SourceFixture::new();
    source.seed(SESSION, 2, &[]);
    Connection::open(&source.db_path)
        .unwrap()
        .execute(
            "UPDATE assistant_usage_events SET duration_ms = -1 WHERE id = 1",
            [],
        )
        .unwrap();
    let (_tmp, db, _, _) = indexed(&source);
    let filters = crate::index_db::RequestPerformanceFilter {
        from_date: Some("2026-09-20".into()),
        to_date: Some("2026-09-20".into()),
        ..Default::default()
    };
    let report = db
        .query_request_performance(&filters)
        .unwrap()
        .overall
        .unwrap();
    assert_eq!(report.request_count, 2);
    assert_eq!(report.duration_ms.coverage.valid, 1);
    assert_eq!(report.duration_ms.coverage.invalid, 1);
    assert_eq!(report.duration_ms.coverage.missing, 0);
}

#[test]
fn cancelled_sweep_keeps_previous_generation_and_data() {
    let source = SourceFixture::new();
    source.seed(SESSION, 1, &[]);
    let binding = source.binding();
    let session = write_raw_session(&binding.session_state_dir, SESSION, "owner/name");
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    db.upsert_session(&session).unwrap();
    refresh_bound_source(&db, &binding, &binding.session_state_dir, |_| {}, || false).unwrap();
    let before = db.session_store_status().unwrap().unwrap();
    source.seed(SESSION, 1, &[]);
    refresh_bound_source(&db, &binding, &binding.session_state_dir, |_| {}, || true).unwrap();
    let after = db.session_store_status().unwrap().unwrap();
    assert_eq!(after.generation, before.generation);
    assert_eq!(after.last_success_at, before.last_success_at);
    assert_eq!(db.all_session_requests(SESSION).unwrap().len(), 1);
    assert_eq!(
        db.session_store_coverage(SESSION)
            .unwrap()
            .unwrap()
            .freshness,
        "stale"
    );
}

#[test]
fn source_mutation_during_sweep_rolls_back_already_written_sessions() {
    let source = SourceFixture::new();
    source.seed(SESSION, 1, &[]);
    let binding = source.binding();
    let session = write_raw_session(&binding.session_state_dir, SESSION, "owner/name");
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    db.upsert_session(&session).unwrap();
    refresh_bound_source(&db, &binding, &binding.session_state_dir, |_| {}, || false).unwrap();
    source.seed(SESSION, 1, &[]);
    let outcome = refresh_bound_source(
        &db,
        &binding,
        &binding.session_state_dir,
        |_| {
            Connection::open(&source.db_path)
                .unwrap()
                .execute("UPDATE assistant_usage_events SET output_tokens = 999", [])
                .unwrap();
        },
        || false,
    )
    .unwrap();
    assert_eq!(outcome.availability, SourceAvailability::Busy);
    assert_eq!(db.all_session_requests(SESSION).unwrap().len(), 1);
    assert_eq!(
        db.all_session_requests(SESSION).unwrap()[0].output_tokens,
        Some(200)
    );
}

#[test]
fn source_deletion_cascades_all_owned_rows_and_event_rewrites_expire_claims() {
    let source = SourceFixture::new();
    source.seed(SESSION, 1, &[("pr", "123")]);
    let (_tmp, db, _, _) = indexed(&source);
    db.conn
        .execute(
            "UPDATE sessions SET events_size = events_size + 1 WHERE id = ?1",
            [SESSION],
        )
        .unwrap();
    let coverage = db.session_store_coverage(SESSION).unwrap().unwrap();
    assert_eq!(coverage.freshness, "stale");
    assert_eq!(
        coverage.reconciliation_status.as_deref(),
        Some("unverified")
    );
    assert_eq!(count(&db, "session_request_usage"), 1);
    db.conn
        .execute("DELETE FROM session_store_sources", [])
        .unwrap();
    for table in [
        "session_request_usage",
        "session_request_billing_items",
        "session_request_links",
        "session_work_refs",
        "session_store_coverage",
    ] {
        assert_eq!(count(&db, table), 0, "{table}");
    }
    assert_eq!(count(&db, "sessions"), 1);
    assert_eq!(
        db.conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
}

#[test]
fn the_same_work_reference_survives_in_two_sessions() {
    const OTHER: &str = "c0ffee00-1111-2222-3333-444455557777";
    let source = SourceFixture::new();
    source.seed(
        SESSION,
        1,
        &[("pr", "https://github.com/owner/name/pull/123")],
    );
    source.seed(
        OTHER,
        1,
        &[("pr", "https://github.com/owner/name/pull/123")],
    );
    let binding = source.binding();
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for id in [SESSION, OTHER] {
        let dir = write_raw_session(&binding.session_state_dir, id, "owner/name");
        db.upsert_session(&dir).unwrap();
    }
    refresh_bound_source(&db, &binding, &binding.session_state_dir, |_| {}, || false).unwrap();
    assert_eq!(db.list_session_work_refs(SESSION).unwrap().len(), 1);
    assert_eq!(db.list_session_work_refs(OTHER).unwrap().len(), 1);
    assert_eq!(count(&db, "session_work_refs"), 2);
}
