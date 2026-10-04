//! Reasoning-effort usage: per-user-turn rows from events plus the
//! session store, replaced on re-index and aggregated by the dashboard.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::index_db::IndexDb;

const SESSION_ID: &str = "e4444444-4444-4444-4444-444444444444";

fn ev(kind: &str, id: &str, at: &str, data: &str) -> String {
    format!(
        r#"{{"type":"{kind}","data":{data},"id":"{id}","timestamp":"2026-10-04T08:{at}Z","parentId":null}}"#
    )
}

/// Two typed messages: the first at medium effort, the second at high.
fn events() -> String {
    [
        ev("session.start", "e0", "00:00", r#"{"selectedModel":"gpt-5.6-luna","reasoningEffort":"medium"}"#),
        ev("user.message", "u1", "00:01", r#"{"content":"fix it","messageId":"m1","source":"user"}"#),
        ev("assistant.turn_start", "t1", "00:02", r#"{"turnId":"0"}"#),
        ev("assistant.message", "a1", "00:05", r#"{"messageId":"am1","content":"done","originatingMessageId":"m1"}"#),
        ev("assistant.turn_end", "t1e", "00:06", r#"{"turnId":"0"}"#),
        ev("session.model_change", "mc", "01:00", r#"{"newModel":"gpt-5.6-luna","reasoningEffort":"high","previousReasoningEffort":"medium"}"#),
        ev("user.message", "u2", "01:01", r#"{"content":"now test it","messageId":"m2","source":"user"}"#),
        ev("assistant.turn_start", "t2", "01:02", r#"{"turnId":"0"}"#),
        ev("assistant.message", "a2", "01:09", r#"{"messageId":"am2","content":"ok","originatingMessageId":"m2"}"#),
        ev("assistant.turn_end", "t2e", "01:10", r#"{"turnId":"0"}"#),
    ]
    .join("\n")
        + "\n"
}

/// A Copilot home with one session and a store holding a request per turn.
fn copilot_home(root: &Path) -> PathBuf {
    let dir = root.join("session-state").join(SESSION_ID);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {SESSION_ID}\nsummary: \"Effort session\"\nrepository: \"org/effort\"\n\
             created_at: \"2026-10-04T08:00:00Z\"\nupdated_at: \"2026-10-04T08:01:10Z\"\n"
        ),
    )
    .unwrap();
    fs::write(dir.join("events.jsonl"), events()).unwrap();

    let store = Connection::open(root.join("session-store.db")).unwrap();
    store
        .execute_batch(&format!(
            "CREATE TABLE assistant_usage_events (id INTEGER PRIMARY KEY, session_id TEXT, \
             model TEXT NOT NULL, output_tokens INTEGER, reasoning_tokens INTEGER, \
             total_nano_aiu INTEGER, duration_ms INTEGER, initiator TEXT, \
             parent_tool_call_id TEXT, reasoning_effort TEXT, created_at TEXT);
             INSERT INTO assistant_usage_events VALUES
               (1, '{SESSION_ID}', 'gpt-5.6-luna', 40, 100, 1000000, 3000, 'user', NULL,
                'medium', '2026-10-04T08:00:05.000Z'),
               (2, '{SESSION_ID}', 'gpt-5.6-luna', 90, 900, 4000000, 7000, 'user', NULL,
                'high', '2026-10-04T08:01:09.000Z');"
        ))
        .unwrap();
    dir
}

#[test]
fn indexing_records_per_effort_usage_and_the_dashboard_aggregates_it() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = copilot_home(tmp.path());

    db.upsert_session(&session).unwrap();
    // Re-indexing replaces the rows rather than appending to them.
    db.upsert_session(&session).unwrap();

    let rows: i64 = db
        .conn
        .query_row("SELECT COUNT(*) FROM session_effort_usage", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(rows, 2);

    let data = db.query_analytics(None, None, None, false).unwrap();
    let mut efforts = data.reasoning_effort;
    efforts.sort_by(|a, b| a.reasoning_effort.cmp(&b.reasoning_effort));
    assert_eq!(efforts.len(), 2);
    let (high, medium) = (&efforts[0], &efforts[1]);
    assert_eq!(high.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(high.model.as_deref(), Some("gpt-5.6-luna"));
    assert_eq!(
        (high.sessions, high.user_turns, high.observed_user_turns),
        (1, 1, 1)
    );
    assert_eq!(
        (high.reasoning_tokens, high.api_duration_ms, high.nano_aiu),
        (900, 7000, 4_000_000)
    );
    assert_eq!(medium.reasoning_effort.as_deref(), Some("medium"));
    assert_eq!(medium.reasoning_tokens, 100);
}
