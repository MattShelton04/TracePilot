//! C10: every analytics table a Claude Code session feeds.

use std::sync::Arc;

use serde_json::json;
use tracepilot_core::provider::{SessionProvider, claude_code::ClaudeCodeProvider};
use tracepilot_test_support::claude::{
    OPUS, SessionFiles, Transcript, Usage, text, tool_use, write_session,
};
use tracepilot_test_support::claude_scenarios as fixtures;

use crate::index_db::{IndexDb, session_writer};

const NOTES: &str = "C:\\work\\demo\\NOTES.md";

/// An edit, a rejected push, an interrupt and a 429 across three prompts,
/// with a 10-minute and a 70-minute pause before the later ones.
pub(super) fn release_session() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Update the notes and push.");
    let edit = json!({"file_path": NOTES, "old_string": "v1", "new_string": "v2"});
    t.call(
        "msg_1",
        OPUS,
        vec![text("Editing."), tool_use("toolu_e", "Edit", edit)],
        Usage::new(10, 0, 1000, 20),
        "tool_use",
    );
    t.tool_result(
        "toolu_e",
        json!("Updated."),
        json!({"filePath": NOTES, "oldString": "v1", "newString": "v2"}),
        false,
    );
    t.call(
        "msg_2",
        OPUS,
        vec![tool_use("toolu_p", "Bash", json!({"command": "git push"}))],
        Usage::new(1, 1000, 0, 5),
        "tool_use",
    );
    t.user(
        json!({"message": {"role": "user", "content": [{"type": "tool_result",
        "tool_use_id": "toolu_p", "is_error": true, "content": "The user rejected it."}]},
        "toolUseResult": "User rejected tool use", "toolDenialKind": "user-rejected"}),
    );
    t.call(
        "msg_3",
        OPUS,
        vec![text("Not pushed.")],
        Usage::new(1, 1000, 0, 5),
        "end_turn",
    );
    t.idle(600).prompt("Push now.");
    t.call(
        "msg_4",
        OPUS,
        vec![text("Pushing...")],
        Usage::new(1, 1000, 0, 3),
        "tool_use",
    );
    t.user(json!({"message": {"role": "user",
        "content": [{"type": "text", "text": "[Request interrupted by user]"}]}}));
    t.prompt("Status?");
    t.record(
        "assistant",
        json!({"isApiErrorMessage": true, "error": "rate_limit",
        "apiErrorStatus": 429, "message": {"id": "msg_err", "model": "<synthetic>",
        "role": "assistant", "stop_reason": "stop_sequence",
        "content": [text("You've hit your session limit")], "usage": {"input_tokens": 0,
        "output_tokens": 0, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}}),
    );
    t.idle(4200).prompt("Now?");
    t.call(
        "msg_5",
        OPUS,
        vec![text("Pushed.")],
        Usage::new(1, 0, 900, 4),
        "end_turn",
    );
    write_session(&t, &[])
}

fn index(files: &SessionFiles) -> IndexDb {
    let provider: Arc<dyn SessionProvider> = Arc::new(ClaudeCodeProvider::new(files.root.path()));
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let db = IndexDb::open_or_create(&files.root.path().join("index.db")).unwrap();
    let prepared = session_writer::prepare_snapshot(&provider, &locator, &|| false).unwrap();
    db.write_prepared_session(&prepared).unwrap();
    db
}

fn rows<T: rusqlite::types::FromSql>(db: &IndexDb, sql: &str) -> Vec<T> {
    let mut stmt = db.conn.prepare(sql).unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

#[test]
fn claude_sessions_fill_model_tool_file_and_incident_rows() {
    let files = release_session();
    let db = index(&files);

    // Model metrics: five recorded calls, no cost-state, so all tail.
    let model: (String, i64, i64, i64) = db
        .conn
        .query_row(
            "SELECT model_name, request_count, input_tokens, output_tokens
             FROM session_model_metrics",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(model, (OPUS.to_string(), 5, 1010 + 1001 * 3 + 901, 37));

    // Canonical tool rows, and the native names behind them.
    let mut native: Vec<(String, String, i64, i64, i64)> = {
        let mut stmt = db
            .conn
            .prepare(
                "SELECT tool_name, native_tool_name, call_count, success_count, failure_count
                 FROM session_native_tool_calls",
            )
            .unwrap();
        stmt.query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
    };
    native.sort();
    assert_eq!(
        native,
        [
            ("edit".to_string(), "Edit".to_string(), 1, 1, 0),
            ("shell".to_string(), "Bash".to_string(), 1, 0, 1),
        ]
    );
    let mut canonical: Vec<String> = rows(&db, "SELECT tool_name FROM session_tool_calls");
    canonical.sort();
    assert_eq!(canonical, ["edit", "shell"]);

    let modified: Vec<String> = rows(&db, "SELECT file_path FROM session_modified_files");
    assert_eq!(modified, [NOTES]);

    // A 429, a denial and an interrupt.
    let mut incidents: Vec<String> = rows(
        &db,
        "SELECT event_type || ': ' || summary FROM session_incidents",
    );
    incidents.sort();
    assert_eq!(
        incidents,
        [
            "error: Rate limit hit",
            "warning: Interrupted by the user",
            "warning: Tool use rejected by the user",
        ]
    );
    let counts: (i64, i64) = db
        .conn
        .query_row(
            "SELECT error_count, rate_limit_count FROM sessions",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(counts, (1, 1));
}

/// Index, TTL, outcome, idle seconds, prefix tokens, model.
type WindowRow = (
    i64,
    Option<i64>,
    String,
    Option<i64>,
    Option<i64>,
    Option<String>,
);

#[test]
fn claude_cache_windows_use_the_recorded_ttl_tier() {
    let db = index(&release_session());
    let mut stmt = db
        .conn
        .prepare(
            "SELECT window_index, ttl_seconds, outcome, idle_seconds, prefix_tokens, model
             FROM session_cache_windows ORDER BY window_index",
        )
        .unwrap();
    let windows: Vec<WindowRow> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    // msg_1 wrote 1h entries; the later calls only read them. Each window
    // runs from the last call before a prompt to the first call after it,
    // and the last call leaves a pending window for the countdown.
    assert_eq!(
        windows,
        [
            (
                0,
                Some(3600),
                "warm".into(),
                Some(602),
                Some(1000),
                Some(OPUS.into())
            ),
            (
                1,
                Some(3600),
                "expired".into(),
                Some(4205),
                Some(1000),
                Some(OPUS.into())
            ),
            (
                2,
                Some(3600),
                "pending".into(),
                None,
                Some(900),
                Some(OPUS.into())
            ),
        ]
    );
    // TTLs are recorded per call, so none feed the cross-session registry.
    let ttls: Vec<i64> = rows(&db, "SELECT COUNT(*) FROM session_cache_ttls");
    assert_eq!(ttls, [0]);
    let analytics = db
        .query_analytics(None, None, None, false, None)
        .unwrap()
        .prompt_cache;
    assert_eq!(
        (
            analytics.resumed_windows,
            analytics.warm_resumes,
            analytics.resumes_after_expiry
        ),
        (2, 1, 1)
    );
}

#[test]
fn claude_subagents_and_skills_fill_agent_and_skill_rows() {
    let db = index(&fixtures::subagents());
    let runs: Vec<i64> = rows(&db, "SELECT COUNT(*) FROM session_agent_runs");
    assert!(runs[0] >= 3, "agent runs: {runs:?}");

    let db = index(&fixtures::meta_records(false));
    let skills: Vec<String> = rows(&db, "SELECT skill_name FROM session_skill_invocations");
    assert_eq!(skills, ["deploy"]);
}
