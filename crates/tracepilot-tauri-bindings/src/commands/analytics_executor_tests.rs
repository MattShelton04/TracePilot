use super::*;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tracepilot_indexer::IndexerError;

#[test]
fn test_analytics_query_params_from_options() {
    let params = AnalyticsQueryParams::from_options(
        Some("2026-01-01".to_string()),
        Some("2026-01-31".to_string()),
        Some("myrepo".to_string()),
        Some(true),
        Some(SessionSource::ClaudeCode),
    );

    assert_eq!(params.from_date, Some("2026-01-01".to_string()));
    assert_eq!(params.to_date, Some("2026-01-31".to_string()));
    assert_eq!(params.repo, Some("myrepo".to_string()));
    assert!(params.hide_empty);
    assert_eq!(params.source, Some(SessionSource::ClaudeCode));
}

#[test]
fn test_analytics_query_params_defaults() {
    let params = AnalyticsQueryParams::from_options(None, None, None, None, None);

    assert!(params.from_date.is_none());
    assert!(params.to_date.is_none());
    assert!(params.repo.is_none());
    assert!(!params.hide_empty);
    assert!(params.source.is_none());
}

#[test]
fn test_analytics_query_params_as_refs() {
    let params = AnalyticsQueryParams {
        from_date: Some("2026-01-01".to_string()),
        to_date: Some("2026-01-31".to_string()),
        repo: Some("myrepo".to_string()),
        hide_empty: true,
        source: Some(SessionSource::Copilot),
    };

    let (from, to, repo, hide, source) = params.as_refs();

    assert_eq!(from, Some("2026-01-01"));
    assert_eq!(to, Some("2026-01-31"));
    assert_eq!(repo, Some("myrepo"));
    assert!(hide);
    assert_eq!(source, Some(SessionSource::Copilot));
}

/// The index file a test query finds.
#[derive(Clone, Copy)]
enum Index {
    Missing,
    Corrupt,
    /// Built, with no sessions.
    Empty,
    /// Built, with one session.
    Populated,
}

fn write_index(path: &Path, index: Index) {
    match index {
        Index::Missing => {}
        Index::Corrupt => std::fs::write(path, b"not a sqlite db").unwrap(),
        Index::Empty => drop(IndexDb::open_or_create(path).unwrap()),
        Index::Populated => {
            drop(IndexDb::open_or_create(path).unwrap());
            let conn = rusqlite::Connection::open(path).unwrap();
            conn.execute(
                "INSERT INTO sessions (id, path, source) VALUES (?1, ?2, ?3)",
                [
                    "cccccccc-0000-4000-8000-000000000001",
                    "/sessions/one",
                    "copilot",
                ],
            )
            .unwrap();
        }
    }
}

/// A query failure as the indexer reports it.
fn malformed() -> BindingsError {
    IndexerError::Database(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
        Some("database disk image is malformed".into()),
    ))
    .into()
}

/// Run a query whose SQL path returns `sql` (the disk scan returns 7), and
/// report whether the disk scan ran.
async fn run(
    index: Index,
    copilot_only: bool,
    source: Option<SessionSource>,
    sql: CmdResult<u32>,
) -> (CmdResult<u32>, bool) {
    let dir = tempfile::tempdir().unwrap();
    let index_path = dir.path().join("index.db");
    write_index(&index_path, index);
    let ctx = AnalyticsContext {
        index_path,
        session_state_dir: dir.path().to_path_buf(),
        copilot_only,
        gates: None,
    };
    let params = AnalyticsQueryParams::from_options(None, None, None, None, source);
    let scanned = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&scanned);
    let result = execute_analytics_query(
        ctx,
        params,
        "Test",
        move |_, _| sql,
        move |_, _| {
            flag.store(true, Ordering::SeqCst);
            Ok(7)
        },
    )
    .await;
    (result, scanned.load(Ordering::SeqCst))
}

#[tokio::test]
async fn the_index_answers_when_it_has_sessions() {
    for source in [
        None,
        Some(SessionSource::Copilot),
        Some(SessionSource::ClaudeCode),
    ] {
        let (result, scanned) = run(Index::Populated, false, source, Ok(3)).await;
        assert_eq!(result.unwrap(), 3);
        assert!(!scanned);
    }
}

#[tokio::test]
async fn disk_scan_stands_in_for_copilot_and_all_sources() {
    for index in [Index::Missing, Index::Corrupt, Index::Empty] {
        for (source, copilot_only) in [
            (None, true),
            (Some(SessionSource::Copilot), true),
            (Some(SessionSource::Copilot), false),
        ] {
            let (result, scanned) = run(index, copilot_only, source, Ok(3)).await;
            assert_eq!(result.unwrap(), 7);
            assert!(scanned);
        }
    }
}

#[tokio::test]
async fn disk_scan_never_answers_for_other_sources() {
    for index in [Index::Missing, Index::Corrupt] {
        let (result, scanned) = run(index, false, Some(SessionSource::ClaudeCode), Ok(3)).await;
        let message = result.unwrap_err().to_string();
        assert!(message.contains("Claude Code"), "{message}");
        assert!(
            !scanned,
            "the Copilot-only scan must not stand in for Claude Code"
        );
    }
}

#[tokio::test]
async fn disk_scan_never_answers_for_all_sources_while_claude_code_is_enabled() {
    for index in [Index::Missing, Index::Corrupt] {
        let (result, scanned) = run(index, false, None, Ok(3)).await;
        let message = result.unwrap_err().to_string();
        assert!(message.contains("session index"), "{message}");
        assert!(!scanned, "the totals would leave out Claude Code sessions");
    }
}

#[tokio::test]
async fn an_empty_index_answers_what_the_disk_scan_cannot() {
    for source in [None, Some(SessionSource::ClaudeCode)] {
        let (result, scanned) = run(Index::Empty, false, source, Ok(0)).await;
        assert_eq!(result.unwrap(), 0);
        assert!(!scanned);
    }
}

/// Run a query whose SQL fails, and check the failure reaches the caller.
async fn assert_query_failure_reported(source: Option<SessionSource>, copilot_only: bool) {
    let (result, scanned) = run(Index::Populated, copilot_only, source, Err(malformed())).await;
    let error = result.expect_err("a failed query must not return disk-scan numbers");
    assert_eq!(error.code(), crate::error::ErrorCode::Indexer);
    assert_eq!(error.to_string(), "database disk image is malformed");
    assert!(
        !scanned,
        "{source:?}: the disk scan must not hide the failure"
    );
}

#[tokio::test]
async fn a_failed_claude_code_query_reports_its_cause() {
    assert_query_failure_reported(Some(SessionSource::ClaudeCode), false).await;
}

#[tokio::test]
async fn a_failed_query_for_all_sources_never_returns_disk_scan_numbers() {
    for copilot_only in [true, false] {
        assert_query_failure_reported(None, copilot_only).await;
    }
}

#[tokio::test]
async fn a_failed_copilot_query_reports_its_cause() {
    assert_query_failure_reported(Some(SessionSource::Copilot), true).await;
}

#[test]
fn test_analytics_context_paths() {
    let ctx = AnalyticsContext {
        index_path: PathBuf::from("/tmp/index.db"),
        session_state_dir: PathBuf::from("/tmp/sessions"),
        copilot_only: true,
        gates: None,
    };

    assert_eq!(ctx.index_path, Path::new("/tmp/index.db"));
    assert_eq!(ctx.session_state_dir, Path::new("/tmp/sessions"));
}
