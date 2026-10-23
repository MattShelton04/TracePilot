//! Per-day Analytics series add up to the headline figures over the same
//! range: AI Credits a running session's checkpoint holds, errors and rate
//! limits on the day they happened, and prompt-cache replies inside the range.

use tracepilot_core::analytics::types::{AnalyticsData, DayIncidents};

use super::range_totals::{checkpoint, resume};
use super::segment_totals::{shutdown, write_copilot};
use crate::index_db::IndexDb;

const NANO: u64 = 1_000_000_000;

fn day_nano(data: &AnalyticsData) -> u64 {
    data.model_usage_by_day
        .iter()
        .filter_map(|d| d.total_nano_aiu)
        .sum()
}

fn index(root: &std::path::Path, sessions: &[std::path::PathBuf]) -> IndexDb {
    let db = IndexDb::open_or_create(&root.join("index.db")).unwrap();
    for path in sessions {
        db.upsert_session(path).unwrap();
    }
    db
}

/// The running run's AI Credits are only in the session's checkpoint total,
/// so the day series puts them on its last-active day, as the headline does.
#[test]
fn a_running_copilot_sessions_checkpoint_credits_reach_the_day_series() {
    let marker = r#","eventsFileSizeBytes":10"#;
    let events = [
        checkpoint("k1", "2026-03-01T09:59:00Z", NANO, 1.0),
        shutdown("s1", "2026-03-01T10:00:00Z", 100, NANO, 1.0, marker),
        resume("r2", "2026-03-03T09:00:00Z"),
        checkpoint("k2", "2026-03-03T09:30:00Z", 3 * NANO, 2.0),
    ];
    let events: Vec<&str> = events.iter().map(String::as_str).collect();
    let temp = tempfile::tempdir().unwrap();
    let path = write_copilot(
        temp.path(),
        "44444444-4444-4444-8444-444444444444",
        "2026-03-03T09:30:00Z",
        &events,
    );
    let db = index(temp.path(), &[path]);

    let all = db.query_analytics(None, None, None, false, None).unwrap();
    assert_eq!(all.total_nano_aiu, 3 * NANO);
    assert_eq!(day_nano(&all), all.total_nano_aiu);
    let ranged = db
        .query_analytics(Some("2026-03-03"), Some("2026-03-05"), None, false, None)
        .unwrap();
    assert_eq!(ranged.total_nano_aiu, 2 * NANO);
    assert_eq!(day_nano(&ranged), ranged.total_nano_aiu);
    // The running run has no recorded tokens: credits only, on its day,
    // under the session's model.
    let running: Vec<_> = ranged
        .model_usage_by_day
        .iter()
        .map(|d| {
            (
                d.date.as_str(),
                d.model.as_str(),
                d.input_tokens + d.output_tokens,
                d.total_nano_aiu,
            )
        })
        .collect();
    assert_eq!(running, [("2026-03-03", "gpt-5.5", 0, Some(2 * NANO))]);
    // The completed run before the range stays out.
    let before = db
        .query_analytics(Some("2026-03-01"), Some("2026-03-02"), None, false, None)
        .unwrap();
    assert_eq!(before.total_nano_aiu, 0);

    // A first run that has not shut down yet has no segments or model rows.
    let temp = tempfile::tempdir().unwrap();
    let path = write_copilot(
        temp.path(),
        "55555555-5555-4555-8555-555555555555",
        "2026-03-01T09:59:00Z",
        &[events[0]],
    );
    let db = index(temp.path(), &[path]);
    for (from, to) in [(None, None), (Some("2026-03-01"), Some("2026-03-01"))] {
        let data = db.query_analytics(from, to, None, false, None).unwrap();
        assert_eq!(data.total_nano_aiu, NANO, "from={from:?}");
        assert_eq!(day_nano(&data), data.total_nano_aiu, "from={from:?}");
    }
}

fn error(id: &str, at: Option<&str>, error_type: &str) -> String {
    let timestamp = at
        .map(|at| format!(r#","timestamp":"{at}""#))
        .unwrap_or_default();
    format!(
        r#"{{"type":"session.error","data":{{"errorType":"{error_type}","message":"failed"}},"id":"{id}"{timestamp}}}"#
    )
}

fn incidents(data: &AnalyticsData) -> Vec<(&str, u64, u64, u64)> {
    data.incidents_by_day
        .iter()
        .map(|d: &DayIncidents| (d.date.as_str(), d.errors, d.rate_limits, d.compactions))
        .collect()
}

/// Errors and rate limits keep a timestamped row each, so they land on the
/// day they happened; compactions stay on the session's last-active day.
#[test]
fn errors_and_rate_limits_count_on_the_day_they_happened() {
    let compaction = r#"{"type":"session.compaction_complete","data":{"preCompactionTokens":50000,"success":true,"checkpointNumber":1},"id":"c1","timestamp":"2026-03-01T09:40:00Z"}"#;
    let events = [
        error("e1", Some("2026-03-01T09:30:00Z"), "rate_limit"),
        compaction.to_string(),
        shutdown("s1", "2026-03-01T10:00:00Z", 100, NANO, 1.0, ""),
        resume("r2", "2026-03-03T09:00:00Z"),
        error("e2", Some("2026-03-03T09:10:00Z"), "api_error"),
        // No timestamp: the session's last-active day.
        error("e3", None, "api_error"),
        shutdown("s2", "2026-03-03T10:00:00Z", 100, NANO, 1.0, ""),
    ];
    let events: Vec<&str> = events.iter().map(String::as_str).collect();
    let temp = tempfile::tempdir().unwrap();
    let path = write_copilot(
        temp.path(),
        "66666666-6666-4666-8666-666666666666",
        "2026-03-03T10:00:00Z",
        &events,
    );
    let db = index(temp.path(), &[path]);

    let all = db.query_analytics(None, None, None, false, None).unwrap();
    assert_eq!(
        incidents(&all),
        [("2026-03-01", 1, 1, 0), ("2026-03-03", 2, 0, 1)]
    );
    assert_eq!((all.total_rate_limits, all.total_compactions), (1, 1));
    assert_eq!(all.sessions_with_errors, 1);

    let ranged = db
        .query_analytics(Some("2026-03-03"), Some("2026-03-05"), None, false, None)
        .unwrap();
    assert_eq!(incidents(&ranged), [("2026-03-03", 2, 0, 1)]);
    // The headline rate limits are the day rows' sum.
    assert_eq!(ranged.total_rate_limits, 0);

    // Like runs, an incident in the range counts even when its session was
    // resumed after it.
    let before = db
        .query_analytics(Some("2026-03-01"), Some("2026-03-01"), None, false, None)
        .unwrap();
    assert_eq!(incidents(&before), [("2026-03-01", 1, 1, 0)]);
    assert_eq!(before.total_rate_limits, 1);
    // Other repositories' incidents stay out.
    let other = db
        .query_analytics(None, None, Some("org/other"), false, None)
        .unwrap();
    assert!(other.incidents_by_day.is_empty());
    assert_eq!(other.sessions_with_errors, 0);
}

/// Sessions affected counts the sessions behind the errors and rate limits
/// beside it: those with an incident on a day in the range, whatever day the
/// session was last active.
#[test]
fn sessions_affected_follow_the_incident_days_in_the_range() {
    let events = [
        error("e1", Some("2026-03-01T09:30:00Z"), "rate_limit"),
        shutdown("s1", "2026-03-01T10:00:00Z", 100, NANO, 1.0, ""),
        resume("r2", "2026-03-03T09:00:00Z"),
        shutdown("s2", "2026-03-03T10:00:00Z", 100, NANO, 1.0, ""),
    ];
    let events: Vec<&str> = events.iter().map(String::as_str).collect();
    let temp = tempfile::tempdir().unwrap();
    let path = write_copilot(
        temp.path(),
        "77777777-7777-4777-8777-777777777777",
        "2026-03-03T10:00:00Z",
        &events,
    );
    let db = index(temp.path(), &[path]);

    let affected = |from, to| {
        let data = db.query_analytics(from, to, None, false, None).unwrap();
        let errors: u64 = data.incidents_by_day.iter().map(|d| d.errors).sum();
        (errors, data.total_rate_limits, data.sessions_with_errors)
    };
    assert_eq!(affected(None, None), (1, 1, 1));
    // The rate limit's day: the session was resumed after it.
    assert_eq!(affected(Some("2026-03-01"), Some("2026-03-01")), (1, 1, 1));
    // The session's last-active day has no incident.
    assert_eq!(affected(Some("2026-03-03"), Some("2026-03-03")), (0, 0, 0));
}

const CACHE_FIXTURE: &str =
    include_str!("../../../../tracepilot-core/tests/fixtures/versions/v1_0_83_prompt_cache.jsonl");

/// The cache panel's replies after an idle gap count windows resumed in the
/// range, like the cache composition beside them.
#[test]
fn prompt_cache_replies_count_only_windows_resumed_in_the_range() {
    let temp = tempfile::tempdir().unwrap();
    let id = "c3333333-3333-3333-3333-333333333333";
    let dir = temp.path().join(id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {id}\nsummary: \"Cache session\"\nrepository: \"org/cache\"\n\
             created_at: \"2026-09-11T00:00:00Z\"\nupdated_at: \"2026-09-12T01:05:00Z\"\n"
        ),
    )
    .unwrap();
    std::fs::write(dir.join("events.jsonl"), CACHE_FIXTURE).unwrap();
    let db = index(temp.path(), &[dir]);
    // The session was resumed across midnight: its first reply was on 09-11.
    db.conn
        .execute(
            "UPDATE session_cache_windows SET resume_at = '2026-09-11T23:50:00Z'
             WHERE window_index = (SELECT MIN(window_index) FROM session_cache_windows)",
            [],
        )
        .unwrap();

    let all = db
        .query_analytics(None, None, None, false, None)
        .unwrap()
        .prompt_cache;
    assert_eq!(all.resumed_windows, 3);
    let day = db
        .query_analytics(Some("2026-09-12"), Some("2026-09-12"), None, false, None)
        .unwrap()
        .prompt_cache;
    assert_eq!(day.resumed_windows, 2);
    assert_eq!(day.sessions_with_predicted, 1);
    // Observed cache lifetimes stay whole-session.
    assert_eq!(day.observed_ttls, all.observed_ttls);
}
