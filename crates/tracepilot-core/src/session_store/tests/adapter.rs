//! Opening, capability detection and row normalisation.

use std::path::Path;

use crate::session_store::{
    BillingItemsStatus, RequestInitiator, SessionStoreError, SourceAvailability, SourceBinding,
    SourceReader, TABLE_USAGE, USAGE_COLUMNS, read_session,
};

use super::{StoreFixture, UsageRow};

const SESSION: &str = "11111111-2222-3333-4444-555555555555";

#[test]
fn a_missing_store_is_missing_not_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let binding = SourceBinding {
        db_path: dir.path().join("session-store.db"),
        copilot_home: dir.path().to_path_buf(),
        session_state_dir: dir.path().join("session-state"),
        source_id: "test".to_string(),
    };
    let error = SourceReader::open(&binding).unwrap_err();
    assert_eq!(error.availability(), SourceAvailability::Missing);
    // A missing file must never look like a reason to drop cached rows.
    assert!(error.availability().retains_cache());
}

#[test]
fn a_store_without_any_readable_table_is_incompatible() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("session-store.db");
    let conn = rusqlite::Connection::open(&db_path).unwrap();
    conn.execute_batch("CREATE TABLE unrelated (id INTEGER PRIMARY KEY);")
        .unwrap();
    drop(conn);
    let binding = SourceBinding {
        db_path,
        copilot_home: dir.path().to_path_buf(),
        session_state_dir: dir.path().join("session-state"),
        source_id: "test".to_string(),
    };
    assert!(matches!(
        SourceReader::open(&binding),
        Err(SessionStoreError::Incompatible)
    ));
}

#[test]
fn the_connection_refuses_writes() {
    let fixture = StoreFixture::current();
    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let error = reader
        .connection()
        .execute("INSERT INTO sessions (id) VALUES ('x')", [])
        .unwrap_err();
    assert!(error.to_string().to_lowercase().contains("readonly"));
}

#[test]
fn capabilities_are_probed_rather_than_taken_from_schema_version() {
    let fixture = StoreFixture::current();
    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let capabilities = reader.capabilities();
    assert_eq!(capabilities.schema_version, Some(8));
    assert!(capabilities.supports_requests());
    assert!(capabilities.supports_work_refs());
    assert!(
        capabilities
            .missing_columns(TABLE_USAGE, USAGE_COLUMNS)
            .is_empty()
    );
}

/// An older store that predates the newer timing and billing columns.
fn legacy_columns() -> Vec<&'static str> {
    vec![
        "id",
        "session_id",
        "turn_index",
        "model",
        "input_tokens",
        "output_tokens",
        "cache_read_tokens",
        "cache_write_tokens",
        "total_nano_aiu",
        "duration_ms",
        "created_at",
    ]
}

#[test]
fn an_older_schema_still_produces_a_ledger_with_named_gaps() {
    let fixture = StoreFixture::with_usage_columns(&legacy_columns());
    fixture.insert_session(SESSION, Some("owner/name"));
    fixture.insert_usage(&UsageRow::new(SESSION));

    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let enrichment = read_session(&reader, SESSION).unwrap();

    assert_eq!(enrichment.requests.len(), 1);
    let request = &enrichment.requests[0];
    assert_eq!(request.input_tokens, Some(1000));
    // The absent columns are unavailable cells, not a disabled feature.
    assert_eq!(request.output_ttft_ms, None);
    assert_eq!(request.billing_items_status, BillingItemsStatus::Absent);
    assert!(
        enrichment
            .coverage
            .missing_columns
            .contains(&"output_ttft_ms".to_string())
    );
    assert!(
        enrichment
            .coverage
            .missing_columns
            .contains(&"token_details_json".to_string())
    );
}

#[test]
fn real_values_in_integer_columns_are_read_as_milliseconds() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(
        &UsageRow::new(SESSION)
            .set("time_to_first_token_ms", "3306.5")
            .set("inter_token_latency_ms", "6.52")
            .set("output_ttft_ms", "3127.4"),
    );

    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let request = &read_session(&reader, SESSION).unwrap().requests[0];
    assert_eq!(request.time_to_first_token_ms, Some(3306.5));
    assert_eq!(request.inter_token_latency_ms, Some(6.52));
    assert_eq!(request.output_ttft_ms, Some(3127.4));
}

#[test]
fn a_recorded_zero_and_a_null_are_different_answers() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(&UsageRow::new(SESSION).set("cache_read_tokens", "0"));
    fixture.insert_usage(&UsageRow::new(SESSION).set("cache_read_tokens", "NULL"));

    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let requests = read_session(&reader, SESSION).unwrap().requests;
    assert_eq!(requests[0].cache_read_tokens, Some(0));
    assert_eq!(requests[0].reports_cache_reuse(), Some(false));
    assert_eq!(requests[1].cache_read_tokens, None);
    // "Not recorded" must not be reported as "no reuse".
    assert_eq!(requests[1].reports_cache_reuse(), None);
}

#[test]
fn an_unusable_cell_costs_that_field_and_not_the_row() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(
        &UsageRow::new(SESSION)
            .set("duration_ms", "-5")
            .set("reasoning_tokens", "'not a number'")
            .set("token_details_json", "'{\"nope\": 1}'"),
    );

    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let enrichment = read_session(&reader, SESSION).unwrap();
    let request = &enrichment.requests[0];

    assert_eq!(request.input_tokens, Some(1000));
    assert_eq!(request.duration_ms, None);
    assert_eq!(request.reasoning_tokens, None);
    assert!(request.invalid_fields.contains(&"duration_ms".to_string()));
    assert!(
        request
            .invalid_fields
            .contains(&"reasoning_tokens".to_string())
    );
    assert_eq!(request.billing_items_status, BillingItemsStatus::Invalid);
    assert_eq!(enrichment.coverage.request_rows, 1);
    assert_eq!(enrichment.coverage.request_rows_rejected, 0);
    assert_eq!(enrichment.coverage.fields["durationMs"].invalid, 1);
    assert_eq!(enrichment.coverage.billing_invalid, 1);
}

#[test]
fn unknown_initiators_survive_instead_of_collapsing_into_user() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(&UsageRow::new(SESSION).set("initiator", "'sub-agent'"));
    fixture.insert_usage(&UsageRow::new(SESSION).set("initiator", "'orchestrator'"));
    fixture.insert_usage(&UsageRow::new(SESSION).set("initiator", "NULL"));

    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let requests = read_session(&reader, SESSION).unwrap().requests;
    assert_eq!(requests[0].initiator, Some(RequestInitiator::SubAgent));
    assert_eq!(
        requests[1].initiator,
        Some(RequestInitiator::Other("orchestrator".to_string()))
    );
    // A historical NULL is not the same statement as an explicit `user`.
    assert_eq!(requests[2].initiator, None);
}

#[test]
fn an_empty_session_is_a_successful_read_that_may_prune() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let enrichment = read_session(&reader, SESSION).unwrap();

    assert!(enrichment.requests.is_empty());
    assert!(enrichment.coverage.is_empty());
    assert!(enrichment.coverage.is_successful());
    assert!(enrichment.may_prune());
}

#[test]
fn the_generation_fingerprint_moves_when_the_contents_do() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    let before = SourceReader::open(&fixture.binding())
        .unwrap()
        .generation_fingerprint()
        .unwrap();

    fixture.insert_usage(&UsageRow::new(SESSION));
    let after = SourceReader::open(&fixture.binding())
        .unwrap()
        .generation_fingerprint()
        .unwrap();
    assert_ne!(before, after);
}

#[test]
fn the_generation_fingerprint_moves_when_the_schema_does() {
    let full = StoreFixture::current();
    let legacy = StoreFixture::with_usage_columns(&legacy_columns());
    let full_fingerprint = SourceReader::open(&full.binding())
        .unwrap()
        .generation_fingerprint()
        .unwrap();
    let legacy_fingerprint = SourceReader::open(&legacy.binding())
        .unwrap()
        .generation_fingerprint()
        .unwrap();
    // Both stores are empty and would otherwise share a sentinel.
    assert_ne!(full_fingerprint, legacy_fingerprint);
}

#[test]
fn only_sessions_under_the_bound_state_directory_are_eligible() {
    let fixture = StoreFixture::current();
    let binding = fixture.binding();
    let state_dir = &binding.session_state_dir;

    assert!(binding.owns_session_dir(&state_dir.join(SESSION)));
    // An imported session with a coincidentally matching id lives elsewhere
    // and must not pick up this machine's telemetry.
    assert!(!binding.owns_session_dir(Path::new("/elsewhere/imported").join(SESSION).as_path()));
    // Nor may a nested path pass by sharing a prefix.
    assert!(!binding.owns_session_dir(&state_dir.join(SESSION).join("nested")));
}

#[test]
fn a_row_fingerprint_tracks_visible_changes() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(&UsageRow::new(SESSION).set("output_tokens", "200"));
    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let first = read_session(&reader, SESSION).unwrap().requests[0]
        .row_fingerprint
        .clone();

    let second = read_session(&reader, SESSION).unwrap().requests[0]
        .row_fingerprint
        .clone();
    assert_eq!(first, second);

    let other = StoreFixture::current();
    other.insert_session(SESSION, None);
    other.insert_usage(&UsageRow::new(SESSION).set("output_tokens", "201"));
    let other_reader = SourceReader::open(&other.binding()).unwrap();
    let changed = read_session(&other_reader, SESSION).unwrap().requests[0]
        .row_fingerprint
        .clone();
    assert_ne!(first, changed);
}
