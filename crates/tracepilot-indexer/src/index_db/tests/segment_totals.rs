//! Do a session's segments add up to its lifetime totals? Range-limited
//! headline totals subtract the segments outside the range from the lifetime
//! values, so any part the segments do not explain stays on the session's
//! last-active day. These tests pin where the two agree, per source.

use std::path::Path;
use std::sync::Arc;

use tracepilot_core::provider::{SessionProvider, claude_code::ClaudeCodeProvider};
use tracepilot_test_support::claude::SessionFiles;
use tracepilot_test_support::{claude_metrics, claude_scenarios};

use crate::index_db::{IndexDb, session_writer};

/// One session's lifetime row next to the sum of its segments.
#[derive(Debug)]
pub(super) struct Totals {
    pub segments: i64,
    pub tokens: (i64, i64),
    pub cost_usd: (Option<f64>, Option<f64>),
    pub unpriced_segments: i64,
    pub nano_aiu: (Option<i64>, Option<i64>),
    pub premium: (Option<f64>, Option<f64>),
}

pub(super) fn totals(db: &IndexDb) -> Totals {
    db.conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM session_segments g WHERE g.session_id = s.id),
                    s.total_tokens,
                    (SELECT COALESCE(SUM(total_tokens), 0) FROM session_segments g WHERE g.session_id = s.id),
                    s.cost_usd,
                    (SELECT SUM(cost_usd) FROM session_segments g WHERE g.session_id = s.id),
                    (SELECT COUNT(*) - COUNT(cost_usd) FROM session_segments g WHERE g.session_id = s.id),
                    s.total_nano_aiu,
                    (SELECT SUM(total_nano_aiu) FROM session_segments g WHERE g.session_id = s.id),
                    s.total_premium_requests,
                    (SELECT SUM(total_premium_requests) FROM session_segments g WHERE g.session_id = s.id)
             FROM sessions s",
            [],
            |r| {
                Ok(Totals {
                    segments: r.get(0)?,
                    tokens: (r.get(1)?, r.get(2)?),
                    cost_usd: (r.get(3)?, r.get(4)?),
                    unpriced_segments: r.get(5)?,
                    nano_aiu: (r.get(6)?, r.get(7)?),
                    premium: (r.get(8)?, r.get(9)?),
                })
            },
        )
        .unwrap()
}

pub(super) fn index_claude(files: &SessionFiles) -> IndexDb {
    let provider: Arc<dyn SessionProvider> = Arc::new(ClaudeCodeProvider::new(files.root.path()));
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let db = IndexDb::open_or_create(&files.root.path().join("index.db")).unwrap();
    let prepared = session_writer::prepare_snapshot(&provider, &locator, &|| false).unwrap();
    db.write_prepared_session(&prepared).unwrap();
    db
}

fn close(a: Option<f64>, b: Option<f64>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => (a - b).abs() < 1e-9,
        (None, None) => true,
        _ => false,
    }
}

#[test]
fn claude_segments_add_up_to_the_session_totals() {
    let cases: Vec<(&str, SessionFiles)> = vec![
        ("one run, no tail", claude_metrics::snapshot_and_tail(false)),
        (
            "one run plus a subagent tail",
            claude_metrics::snapshot_and_tail(true),
        ),
        ("no cost-state snapshot", claude_metrics::recorded_only()),
        ("two runs", claude_metrics::resumed_across_days(false)),
        (
            "two runs plus a priced tail",
            claude_metrics::resumed_across_days(true),
        ),
        ("resumed, exited", claude_scenarios::resumed(false)),
        ("resumed, still running", claude_scenarios::resumed(true)),
        (
            "live, never exited",
            claude_scenarios::interrupted_and_live(),
        ),
        ("subagents", claude_scenarios::subagents()),
        ("foreground agents", claude_scenarios::foreground_agents()),
        (
            "agent resumed after a session resume",
            claude_scenarios::agent_resumed_after_session_resume(),
        ),
        ("tool hazards", claude_scenarios::tool_hazards()),
    ];
    for (name, files) in cases {
        let t = totals(&index_claude(&files));
        assert!(t.segments > 0, "{name}: {t:?}");
        assert_eq!(t.tokens.0, t.tokens.1, "{name}: tokens {t:?}");
        assert!(close(t.cost_usd.0, t.cost_usd.1), "{name}: cost {t:?}");
        // Claude Code has neither AI Credits nor premium requests.
        assert_eq!(t.nano_aiu, (None, None), "{name}: {t:?}");
        assert_eq!(t.premium.0, None, "{name}: {t:?}");
        assert_eq!(t.unpriced_segments, 0, "{name}: {t:?}");
    }
}

pub(super) fn write_copilot(
    root: &Path,
    id: &str,
    updated_at: &str,
    events: &[&str],
) -> std::path::PathBuf {
    let dir = root.join(id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {id}\nsummary: \"Range\"\nrepository: \"org/repo\"\nbranch: main\ncwd: 'C:\\test'\nhost_type: cli\ncreated_at: \"2026-03-01T09:00:00Z\"\nupdated_at: \"{updated_at}\"\n"
        ),
    )
    .unwrap();
    let mut body = String::from(
        r#"{"type":"user.message","data":{"content":"go","interactionId":"int-1"},"id":"u1","timestamp":"2026-03-01T09:00:01Z"}"#,
    );
    body.push('\n');
    for event in events {
        body.push_str(event);
        body.push('\n');
    }
    std::fs::write(dir.join("events.jsonl"), body).unwrap();
    dir
}

/// A `session.shutdown` with one model; `extra` adds payload fields.
pub(super) fn shutdown(
    id: &str,
    at: &str,
    tokens: u64,
    nano: u64,
    premium: f64,
    extra: &str,
) -> String {
    format!(
        r#"{{"type":"session.shutdown","data":{{"shutdownType":"routine","totalPremiumRequests":{premium},"totalApiDurationMs":1000,"totalNanoAiu":{nano}{extra},"modelMetrics":{{"gpt-5.5":{{"requests":{{"count":1,"cost":{premium}}},"usage":{{"inputTokens":{tokens},"outputTokens":0}},"totalNanoAiu":{nano}}}}}}},"id":"{id}","timestamp":"{at}"}}"#
    )
}

#[test]
fn copilot_segments_add_up_to_the_session_totals() {
    let resume =
        r#"{"type":"session.resume","data":{},"id":"r1","timestamp":"2026-03-03T09:00:00Z"}"#;
    // Legacy shutdowns report each run; newer ones are cumulative snapshots.
    let legacy = [
        shutdown("s1", "2026-03-01T10:00:00Z", 100, 1_000_000_000, 1.0, ""),
        resume.to_string(),
        shutdown("s2", "2026-03-03T10:00:00Z", 200, 2_000_000_000, 2.0, ""),
    ];
    let marker = r#","eventsFileSizeBytes":10"#;
    let cumulative = [
        shutdown(
            "s1",
            "2026-03-01T10:00:00Z",
            100,
            1_000_000_000,
            1.0,
            marker,
        ),
        resume.to_string(),
        shutdown(
            "s2",
            "2026-03-03T10:00:00Z",
            300,
            3_000_000_000,
            3.0,
            marker,
        ),
    ];
    for (name, events) in [("legacy", legacy), ("cumulative", cumulative)] {
        let temp = tempfile::tempdir().unwrap();
        let events: Vec<&str> = events.iter().map(String::as_str).collect();
        let path = write_copilot(temp.path(), "c1", "2026-03-03T10:00:00Z", &events);
        let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
        db.upsert_session(&path).unwrap();
        let t = totals(&db);
        assert_eq!(t.segments, 2, "{name}: {t:?}");
        assert_eq!(t.tokens, (300, 300), "{name}: {t:?}");
        assert_eq!(
            t.nano_aiu,
            (Some(3_000_000_000), Some(3_000_000_000)),
            "{name}: {t:?}"
        );
        assert!(close(t.premium.0, t.premium.1), "{name}: {t:?}");
    }

    // A running session before its first shutdown and usage checkpoint has no
    // segments, and no usage on its row either.
    let temp = tempfile::tempdir().unwrap();
    let path = write_copilot(temp.path(), "c2", "2026-03-03T10:00:00Z", &[]);
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    let t = totals(&db);
    assert_eq!((t.segments, t.tokens), (0, (0, 0)), "{t:?}");
}
