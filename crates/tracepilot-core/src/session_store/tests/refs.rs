//! Linked-work normalisation, reconciliation scopes and distributions.

use crate::models::event_types::session_lifecycle_data::{
    ModelMetricDetail, RequestMetrics, ShutdownData, UsageMetrics,
};
use crate::session_store::{
    ReconciliationStatus, RefResolution, SourceReader, StoreRequest, WorkRef, WorkRefKind,
    cache_reuse, read_session, reconcile_session, request_performance,
};

use super::{StoreFixture, UsageRow};

const SESSION: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

fn normalize(ref_type: &str, value: &str, repository: Option<&str>) -> WorkRef {
    WorkRef::normalize(SESSION, Some(1), ref_type, value, repository, None, None)
}

#[test]
fn a_bare_number_is_session_context_not_a_verified_link() {
    let work_ref = normalize("pr", "123", Some("owner/name"));
    assert_eq!(work_ref.kind, WorkRefKind::PullRequest);
    assert_eq!(work_ref.normalized_value, "123");
    assert_eq!(work_ref.resolution, RefResolution::SessionContext);
    assert_eq!(work_ref.resolved_repository.as_deref(), Some("owner/name"));
    // Context is a guess about which repository was meant, so no link.
    assert!(!work_ref.resolution.is_navigable());
    assert_eq!(work_ref.number(), Some(123));
}

#[test]
fn a_bare_number_without_context_stays_searchable() {
    let work_ref = normalize("issue", "#42", None);
    assert_eq!(work_ref.normalized_value, "42");
    assert_eq!(work_ref.resolution, RefResolution::Unresolved);
    assert_eq!(work_ref.resolved_repository, None);
}

#[test]
fn an_explicit_url_resolves_its_own_host_and_repository() {
    let work_ref = normalize(
        "pr",
        "https://github.example.com/owner/name/pull/77",
        Some("other/repo"),
    );
    assert_eq!(work_ref.resolution, RefResolution::Explicit);
    assert!(work_ref.resolution.is_navigable());
    // An Enterprise host is taken from the reference, never assumed to be
    // github.com and never derived from the session's `host_type`.
    assert_eq!(
        work_ref.resolved_host.as_deref(),
        Some("github.example.com")
    );
    assert_eq!(work_ref.resolved_repository.as_deref(), Some("owner/name"));
    assert_eq!(work_ref.candidate_repository.as_deref(), Some("other/repo"));
}

#[test]
fn unsupported_schemes_and_zero_numbers_are_rejected() {
    for value in [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "ftp://host/owner/name/pull/1",
    ] {
        let work_ref = normalize("pr", value, None);
        assert_ne!(
            work_ref.resolution,
            RefResolution::Explicit,
            "{value} must not become a link"
        );
    }
    assert_eq!(
        normalize("pr", "0", None).resolution,
        RefResolution::Rejected
    );
    assert_eq!(
        normalize("issue", "not-a-number", None).resolution,
        RefResolution::Rejected
    );
}

#[test]
fn commit_values_are_git_refs_and_only_sometimes_sha_shaped() {
    let sha = normalize("commit", "A1B2C3D4E5F6", None);
    assert_eq!(sha.kind, WorkRefKind::GitRef);
    assert_eq!(sha.normalized_value, "a1b2c3d4e5f6");
    assert!(sha.is_commit_sha_shaped());

    let branch = normalize("commit", "feature/my-branch", None);
    assert_eq!(branch.kind, WorkRefKind::GitRef);
    // Twenty-six of 85 locally recorded "commit" values are not SHAs.
    assert!(!branch.is_commit_sha_shaped());
}

#[test]
fn the_same_number_in_two_repositories_stays_two_references() {
    let left = normalize("pr", "https://github.com/a/one/pull/5", None);
    let right = normalize("pr", "https://github.com/b/two/pull/5", None);
    assert_ne!(left.identity(), right.identity());
}

#[test]
fn an_unknown_ref_type_is_preserved() {
    let work_ref = normalize("discussion", "9", None);
    assert_eq!(work_ref.kind, WorkRefKind::Other("discussion".to_string()));
    assert_eq!(work_ref.kind.qualifier(), None);
}

#[test]
fn duplicate_source_rows_collapse_once_per_session() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, Some("owner/name"));
    fixture.insert_ref(SESSION, "pr", "123");
    fixture.insert_ref(SESSION, "pr", "#123");
    fixture.insert_ref(SESSION, "issue", "7");

    let reader = SourceReader::open(&fixture.binding()).unwrap();
    let refs = read_session(&reader, SESSION).unwrap().work_refs;
    assert_eq!(refs.len(), 2);
}

fn shutdown_with(requests: u64, input: u64, output: u64, cache_read: u64) -> ShutdownData {
    let mut model_metrics = std::collections::HashMap::new();
    model_metrics.insert(
        "gpt-5.6-luna".to_string(),
        ModelMetricDetail {
            requests: Some(RequestMetrics {
                count: Some(requests),
                cost: None,
            }),
            usage: Some(UsageMetrics {
                input_tokens: Some(input),
                output_tokens: Some(output),
                cache_read_tokens: Some(cache_read),
                cache_write_tokens: Some(0),
                reasoning_tokens: None,
            }),
            total_nano_aiu: None,
            token_details: None,
        },
    );
    ShutdownData {
        model_metrics: Some(model_metrics),
        ..Default::default()
    }
}

fn read_requests(fixture: &StoreFixture) -> Vec<StoreRequest> {
    let reader = SourceReader::open(&fixture.binding()).unwrap();
    read_session(&reader, SESSION).unwrap().requests
}

#[test]
fn an_exact_match_reconciles_over_all_requests() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(&UsageRow::new(SESSION));
    let requests = read_requests(&fixture);

    let report = reconcile_session(&requests, Some(&shutdown_with(1, 1000, 200, 800)), None);
    assert_eq!(report.status, ReconciliationStatus::Reconciled);
    assert_eq!(report.scope, "allRequests");
    assert!(report.differences.is_empty());
    // A verdict always names what it compared.
    assert!(report.metrics.contains(&"inputTokens".to_string()));
}

#[test]
fn a_compaction_request_is_reported_as_a_scope_difference() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(&UsageRow::new(SESSION));
    fixture.insert_usage(
        &UsageRow::new(SESSION)
            .set("initiator", "'compaction'")
            .set("input_tokens", "158498")
            .set("output_tokens", "2130")
            .set("cache_read_tokens", "148059"),
    );
    let requests = read_requests(&fixture);

    // Shutdown model metrics cover only the non-compaction request.
    let report = reconcile_session(&requests, Some(&shutdown_with(1, 1000, 200, 800)), None);
    assert_eq!(report.status, ReconciliationStatus::ScopeDifference);
    assert_eq!(report.scope, "excludingCompaction");
}

#[test]
fn an_unexplained_difference_is_a_mismatch_that_names_the_delta() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(&UsageRow::new(SESSION));
    let requests = read_requests(&fixture);

    let report = reconcile_session(&requests, Some(&shutdown_with(1, 4321, 200, 800)), None);
    assert_eq!(report.status, ReconciliationStatus::Mismatch);
    assert!(
        report
            .differences
            .iter()
            .any(|difference| difference.contains("inputTokens"))
    );
}

#[test]
fn no_shutdown_means_unverified_not_reconciled() {
    let report = reconcile_session(&[], None, None);
    assert_eq!(report.status, ReconciliationStatus::Unverified);
}

#[test]
fn cache_reuse_uses_one_population_for_both_answers() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(
        &UsageRow::new(SESSION)
            .set("input_tokens", "1000")
            .set("cache_read_tokens", "800"),
    );
    fixture.insert_usage(
        &UsageRow::new(SESSION)
            .set("input_tokens", "1000")
            .set("cache_read_tokens", "0"),
    );
    // Missing counter: out of numerator and denominator alike.
    fixture.insert_usage(&UsageRow::new(SESSION).set("cache_read_tokens", "NULL"));
    // Internally inconsistent: excluded and counted, never clamped.
    fixture.insert_usage(
        &UsageRow::new(SESSION)
            .set("input_tokens", "10")
            .set("cache_read_tokens", "999"),
    );
    let requests = read_requests(&fixture);

    let reuse = cache_reuse(&requests);
    assert_eq!(reuse.requests_with_counter, 2);
    assert_eq!(reuse.requests_reporting_reuse, 1);
    assert_eq!(reuse.inconsistent_rows, 1);
    assert_eq!(reuse.cache_read_tokens, 800);
    assert_eq!(reuse.input_tokens, 2000);
    assert_eq!(reuse.token_weighted_ratio, Some(0.4));
}

#[test]
fn p95_is_suppressed_below_the_sample_threshold_but_the_median_survives() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    for duration in [1000, 2000, 3000] {
        fixture.insert_usage(&UsageRow::new(SESSION).set("duration_ms", duration.to_string()));
    }
    let requests = read_requests(&fixture);

    let performance = request_performance(&requests);
    assert_eq!(performance.request_count, 3);
    assert_eq!(performance.session_count, 1);
    assert_eq!(performance.duration_ms.median, Some(2000.0));
    assert_eq!(performance.duration_ms.p95, None);
    assert_eq!(performance.duration_ms.coverage.valid, 3);
    // The timing columns have their own populations and say so.
    assert_eq!(performance.output_ttft_ms.coverage.valid, 0);
    assert_eq!(performance.output_ttft_ms.coverage.missing, 3);
    assert_eq!(performance.output_ttft_ms.median, None);
}

#[test]
fn missing_counter_cannot_reconcile_against_a_partial_sum() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(&UsageRow::new(SESSION));
    fixture.insert_usage(&UsageRow::new(SESSION).set("input_tokens", "NULL"));
    let report = reconcile_session(
        &read_requests(&fixture),
        Some(&shutdown_with(2, 1000, 400, 1600)),
        None,
    );
    assert_eq!(report.status, ReconciliationStatus::Partial);
    assert!(!report.metrics.contains(&"inputTokens".to_string()));
}

#[test]
fn invalid_timings_remain_invalid_in_distributions() {
    let fixture = StoreFixture::current();
    fixture.insert_session(SESSION, None);
    fixture.insert_usage(&UsageRow::new(SESSION).set("duration_ms", "-1"));
    let stats = request_performance(&read_requests(&fixture));
    assert_eq!(stats.duration_ms.coverage.invalid, 1);
    assert_eq!(stats.duration_ms.coverage.missing, 0);
}
