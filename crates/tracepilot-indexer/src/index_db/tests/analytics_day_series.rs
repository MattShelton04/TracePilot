//! Per-day analytics series and the date range: each run counts on the day it
//! ended, whenever its session was last active. Sessions without runs fall
//! back to their last-activity day for the model series.

use tracepilot_core::analytics::types::AnalyticsData;
use tracepilot_core::provider::SessionSource;

use crate::index_db::IndexDb;

/// One session row; `turn_count` 0 marks it empty.
struct Session {
    id: &'static str,
    repo: &'static str,
    source: &'static str,
    created: &'static str,
    updated: &'static str,
    turns: i64,
}

fn insert_session(db: &IndexDb, s: &Session) {
    db.conn
        .execute(
            "INSERT INTO sessions (id, path, repository, source, created_at, updated_at,
                                   turn_count, indexed_at)
             VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
            rusqlite::params![s.id, s.repo, s.source, s.created, s.updated, s.turns],
        )
        .unwrap();
}

/// One accounting run ending at `end` with `tokens` (split 4:1 input/output
/// for the model series), one premium request per 500 tokens and
/// `tokens / 2000` USD.
fn insert_run(db: &IndexDb, session: &str, end: &str, tokens: i64) {
    let json = format!(
        r#"{{"gpt-5.4":{{"usage":{{"inputTokens":{},"outputTokens":{}}}}}}}"#,
        tokens * 4 / 5,
        tokens / 5
    );
    db.conn
        .execute(
            "INSERT INTO session_segments
             (session_id, start_timestamp, end_timestamp, total_tokens, total_requests,
              total_premium_requests, total_api_duration_ms, current_model,
              model_metrics_json, cost_usd)
             VALUES (?1, ?2, ?2, ?3, 1, ?4, 1000, 'gpt-5.4', ?5, ?6)",
            rusqlite::params![
                session,
                end,
                tokens,
                tokens as f64 / 500.0,
                json,
                tokens as f64 / 2000.0
            ],
        )
        .unwrap();
}

/// Lifetime model usage for a session without runs.
fn insert_model_metrics(db: &IndexDb, session: &str, input: i64) {
    db.conn
        .execute(
            "INSERT INTO session_model_metrics (session_id, model_name, input_tokens, output_tokens)
             VALUES (?1, 'claude-sonnet-4.6', ?2, 0)",
            rusqlite::params![session, input],
        )
        .unwrap();
}

/// Synthetic index:
///
/// - `resumed` (repo-a, Copilot): runs ending Mar 2 (500) and Mar 8 (700),
///   last active Mar 8.
/// - `other-repo` (repo-b, Copilot): run ending Mar 2 (40), last active Mar 9.
/// - `other-source` (repo-a, Claude Code): run ending Mar 2 (60), last active
///   Mar 9.
/// - `empty` (repo-a, Copilot, no turns): run ending Mar 2 (5), last active Mar 9.
/// - `legacy-late` / `legacy-early` (repo-a, Copilot): no runs, model usage
///   only, last active Mar 8 (300 input) and Mar 3 (200 input).
fn fixture() -> (tempfile::TempDir, IndexDb) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let sessions = [
        (
            "resumed",
            "org/repo-a",
            "copilot",
            "2026-03-08T10:00:00Z",
            3,
        ),
        (
            "other-repo",
            "org/repo-b",
            "copilot",
            "2026-03-09T10:00:00Z",
            3,
        ),
        (
            "other-source",
            "org/repo-a",
            "claudeCode",
            "2026-03-09T10:00:00Z",
            3,
        ),
        ("empty", "org/repo-a", "copilot", "2026-03-09T10:00:00Z", 0),
        (
            "legacy-late",
            "org/repo-a",
            "copilot",
            "2026-03-08T10:00:00Z",
            3,
        ),
        (
            "legacy-early",
            "org/repo-a",
            "copilot",
            "2026-03-03T10:00:00Z",
            3,
        ),
    ];
    for (id, repo, source, updated, turns) in sessions {
        insert_session(
            &db,
            &Session {
                id,
                repo,
                source,
                created: "2026-03-02T09:00:00Z",
                updated,
                turns,
            },
        );
    }
    insert_run(&db, "resumed", "2026-03-02T10:00:00Z", 500);
    insert_run(&db, "resumed", "2026-03-08T10:00:00Z", 700);
    insert_run(&db, "other-repo", "2026-03-02T11:00:00Z", 40);
    insert_run(&db, "other-source", "2026-03-02T12:00:00Z", 60);
    insert_run(&db, "empty", "2026-03-02T13:00:00Z", 5);
    insert_model_metrics(&db, "legacy-late", 300);
    insert_model_metrics(&db, "legacy-early", 200);
    (tmp, db)
}

fn query(
    db: &IndexDb,
    from: &str,
    to: &str,
    repo: Option<&str>,
    hide_empty: bool,
    source: Option<SessionSource>,
) -> AnalyticsData {
    db.query_analytics(Some(from), Some(to), repo, hide_empty, source)
        .unwrap()
}

fn tokens(data: &AnalyticsData) -> Vec<(String, u64)> {
    data.token_usage_by_day
        .iter()
        .map(|d| (d.date.clone(), d.tokens))
        .collect()
}

fn activity(data: &AnalyticsData) -> Vec<(String, u32)> {
    data.activity_per_day
        .iter()
        .map(|d| (d.date.clone(), d.count))
        .collect()
}

fn premium(data: &AnalyticsData) -> Vec<(String, f64)> {
    data.cost_by_day
        .iter()
        .map(|d| (d.date.clone(), d.cost))
        .collect()
}

fn usd(data: &AnalyticsData) -> Vec<(String, f64)> {
    data.cost_usd_by_day
        .iter()
        .map(|d| (d.date.clone(), d.cost))
        .collect()
}

/// `(date, model, source, input tokens)` per model-day row.
fn model_days(data: &AnalyticsData) -> Vec<(String, String, SessionSource, u64)> {
    data.model_usage_by_day
        .iter()
        .map(|d| (d.date.clone(), d.model.clone(), d.source, d.input_tokens))
        .collect()
}

fn day<T>(date: &str, value: T) -> (String, T) {
    (date.to_string(), value)
}

#[test]
fn run_counts_on_its_end_day_when_session_resumed_after_range() {
    let (_tmp, db) = fixture();
    let data = query(
        &db,
        "2026-03-01",
        "2026-03-03",
        Some("org/repo-a"),
        true,
        Some(SessionSource::Copilot),
    );

    // Only `resumed`'s Mar 2 run: its Mar 8 run is outside the range, and the
    // other sessions are filtered by repository, source or emptiness.
    assert_eq!(tokens(&data), vec![day("2026-03-02", 500)]);
    assert_eq!(activity(&data), vec![day("2026-03-02", 1)]);
    assert_eq!(premium(&data), vec![day("2026-03-02", 1.0)]);
    assert_eq!(usd(&data), vec![day("2026-03-02", 0.25)]);
    let gpt = |date: &str, input| {
        (
            date.to_string(),
            "gpt-5.4".to_string(),
            SessionSource::Copilot,
            input,
        )
    };
    let legacy = |date: &str, input| {
        (
            date.to_string(),
            "claude-sonnet-4.6".to_string(),
            SessionSource::Copilot,
            input,
        )
    };
    // The session without runs is bucketed on its last-activity day, which
    // is also what bounds it.
    assert_eq!(
        model_days(&data),
        vec![gpt("2026-03-02", 400), legacy("2026-03-03", 200)]
    );

    // Lifetime KPIs still select sessions by last activity: only
    // `legacy-early` was last active in the range.
    assert_eq!(data.total_sessions, 1);
}

#[test]
fn run_outside_range_is_excluded() {
    let (_tmp, db) = fixture();
    let copilot = Some(SessionSource::Copilot);

    // Between the two runs: nothing ended, so every per-day series is empty.
    let gap = query(&db, "2026-03-04", "2026-03-06", None, false, None);
    assert!(gap.token_usage_by_day.is_empty());
    assert!(gap.activity_per_day.is_empty());
    assert!(gap.cost_by_day.is_empty());
    assert!(gap.cost_usd_by_day.is_empty());
    assert!(gap.model_usage_by_day.is_empty());

    // The later run only; the Mar 2 run of the same session stays out.
    let late = query(
        &db,
        "2026-03-07",
        "2026-03-09",
        Some("org/repo-a"),
        true,
        copilot,
    );
    assert_eq!(tokens(&late), vec![day("2026-03-08", 700)]);
    assert_eq!(usd(&late), vec![day("2026-03-08", 0.35)]);
    assert_eq!(
        model_days(&late),
        vec![
            (
                "2026-03-08".to_string(),
                "claude-sonnet-4.6".to_string(),
                SessionSource::Copilot,
                300
            ),
            (
                "2026-03-08".to_string(),
                "gpt-5.4".to_string(),
                SessionSource::Copilot,
                560
            ),
        ]
    );
}

#[test]
fn repository_source_and_empty_filters_still_apply() {
    let (_tmp, db) = fixture();
    let (from, to) = ("2026-03-01", "2026-03-03");

    // No filters: every run that ended Mar 2, including the empty session's.
    let all = query(&db, from, to, None, false, None);
    assert_eq!(tokens(&all), vec![day("2026-03-02", 500 + 40 + 60 + 5)]);
    assert_eq!(activity(&all), vec![day("2026-03-02", 4)]);

    // Hide empty drops the session without turns.
    let non_empty = query(&db, from, to, None, true, None);
    assert_eq!(tokens(&non_empty), vec![day("2026-03-02", 600)]);

    // Repository keeps one repository.
    let repo_b = query(&db, from, to, Some("org/repo-b"), false, None);
    assert_eq!(tokens(&repo_b), vec![day("2026-03-02", 40)]);
    assert_eq!(activity(&repo_b), vec![day("2026-03-02", 1)]);
    assert_eq!(usd(&repo_b), vec![day("2026-03-02", 0.02)]);

    // Source keeps one provider, in every series.
    let claude = query(&db, from, to, None, false, Some(SessionSource::ClaudeCode));
    assert_eq!(tokens(&claude), vec![day("2026-03-02", 60)]);
    assert_eq!(premium(&claude), vec![day("2026-03-02", 60.0 / 500.0)]);
    assert_eq!(usd(&claude), vec![day("2026-03-02", 0.03)]);
    assert_eq!(
        model_days(&claude),
        vec![(
            "2026-03-02".to_string(),
            "gpt-5.4".to_string(),
            SessionSource::ClaudeCode,
            48
        )]
    );
}
