//! Agent-run extraction at index time and the Agents explorer queries.

use std::fs;
use std::path::{Path, PathBuf};

use crate::index_db::IndexDb;

fn write_raw_session(root: &Path, session_id: &str, repo: &str, events: &[String]) -> PathBuf {
    let dir = root.join(session_id);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {session_id}\nsummary: \"Agents session\"\nrepository: \"{repo}\"\n\
             created_at: \"2026-09-10T00:00:00Z\"\nupdated_at: \"2026-09-12T01:00:00Z\"\n"
        ),
    )
    .unwrap();
    fs::write(dir.join("events.jsonl"), events.join("\n") + "\n").unwrap();
    dir
}

fn line(event_type: &str, time: &str, data: &str, agent_id: Option<&str>) -> String {
    let agent = agent_id
        .map(|id| format!(r#","agentId":"{id}""#))
        .unwrap_or_default();
    format!(
        r#"{{"type":"{event_type}","data":{data},"id":"{event_type}-{time}","timestamp":"{time}","parentId":null{agent}}}"#
    )
}

/// One user turn launching `explore` twice in parallel on `day` and a nested
/// `code-review` run that fails.
fn agent_session(day: &str) -> Vec<String> {
    let t = |time: &str| format!("{day}T{time}Z");
    vec![
        line(
            "session.start",
            &t("00:00:00"),
            r#"{"copilotVersion":"1.0.83"}"#,
            None,
        ),
        line("user.message", &t("00:00:01"), r#"{"content":"go"}"#, None),
        line(
            "tool.execution_start",
            &t("00:00:02"),
            r#"{"toolCallId":"c1","toolName":"task","arguments":{"agent_type":"explore","name":"one"}}"#,
            None,
        ),
        line(
            "subagent.started",
            &t("00:00:02"),
            r#"{"toolCallId":"c1","agentName":"explore","agentType":"explore","executionMode":"background"}"#,
            Some("a1"),
        ),
        line(
            "subagent.configured",
            &t("00:00:02"),
            r#"{"model":"claude-haiku-4.5","reasoningEffort":"low"}"#,
            Some("a1"),
        ),
        line(
            "tool.execution_start",
            &t("00:00:03"),
            r#"{"toolCallId":"c2","toolName":"task","arguments":{"agent_type":"explore","name":"two"}}"#,
            None,
        ),
        line(
            "subagent.started",
            &t("00:00:03"),
            r#"{"toolCallId":"c2","agentName":"explore","agentType":"explore"}"#,
            Some("a2"),
        ),
        line(
            "tool.execution_start",
            &t("00:00:04"),
            r#"{"toolCallId":"c3","toolName":"task","arguments":{"agent_type":"code-review","name":"nested"}}"#,
            Some("a2"),
        ),
        line(
            "subagent.started",
            &t("00:00:04"),
            r#"{"toolCallId":"c3","agentName":"code-review","agentType":"code-review"}"#,
            Some("a3"),
        ),
        line(
            "subagent.failed",
            &t("00:00:05"),
            r#"{"toolCallId":"c3","agentName":"code-review","error":"Request 429 after 30s"}"#,
            None,
        ),
        line(
            "subagent.completed",
            &t("00:00:08"),
            r#"{"toolCallId":"c1","agentName":"explore","model":"gpt-5.4-mini","firstDispatchedModel":"gpt-5.4-mini","totalTokens":1000,"totalToolCalls":5,"durationMs":6000}"#,
            None,
        ),
        line(
            "subagent.completed",
            &t("00:00:09"),
            r#"{"toolCallId":"c2","agentName":"explore","model":"gpt-5.4-mini","totalTokens":3000,"totalToolCalls":9,"durationMs":6000}"#,
            None,
        ),
        line(
            "session.shutdown",
            &t("00:00:10"),
            r#"{"agentMetrics":{"a1":{"agentName":"explore","totalNanoAiu":400,"modelMetrics":{}}}}"#,
            None,
        ),
    ]
}

fn count(db: &IndexDb, table: &str) -> i64 {
    db.conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn indexing_stores_runs_once_and_summarizes_them() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = write_raw_session(
        tmp.path(),
        "d4444444-4444-4444-4444-444444444444",
        "org/agents",
        &agent_session("2026-09-12"),
    );

    db.upsert_session(&session).unwrap();
    db.upsert_session(&session).unwrap();
    assert_eq!(
        count(&db, "session_agent_runs"),
        3,
        "re-indexing replaces rows"
    );

    let summary = db.query_agent_usage_summary(None, None, None).unwrap();
    assert_eq!(summary.total_runs, 3);
    assert_eq!(summary.total_sessions, 1);
    assert_eq!(summary.failed_runs, 1);
    assert_eq!(summary.max_depth, 1);
    assert_eq!(summary.peak_parallelism, 2);
    assert_eq!(summary.runs_with_credits, 1);
    assert_eq!(summary.total_own_nano_aiu, 400);

    let explore = &summary.agents[0];
    assert_eq!(explore.name, "explore");
    assert_eq!(explore.runs, 2);
    assert_eq!(explore.completed, 2);
    assert_eq!(explore.duration_ms.count, 2);
    assert_eq!(explore.duration_ms.p50, Some(6000));
    assert_eq!(explore.total_tokens.max, Some(3000));
    assert_eq!(explore.runs_with_configuration, 1);
    assert_eq!(
        explore.mismatch_runs, 1,
        "configured haiku, dispatched mini"
    );
    assert_eq!(explore.top_models[0].label, "gpt-5.4-mini");
    assert_eq!(explore.own_nano_aiu, Some(400));
    assert_eq!(explore.daily_runs.len(), 1);
    assert_eq!(
        explore.display_name, None,
        "per-call names that differ between runs do not name the agent"
    );

    let review = summary
        .agents
        .iter()
        .find(|a| a.name == "code-review")
        .unwrap();
    assert_eq!(review.failed, 1);
    assert_eq!(review.display_name.as_deref(), Some("nested"));
    assert_eq!(
        review.own_nano_aiu, None,
        "no ledger coverage is unknown, not zero"
    );
}

#[test]
fn messaging_survives_indexing_and_appears_in_agent_usage() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tracepilot-core/tests/fixtures/versions/v1_0_88_agent_messaging.jsonl");
    let events = fs::read_to_string(fixture).unwrap();
    let session = write_raw_session(
        tmp.path(),
        "d9999999-9999-9999-9999-999999999999",
        "org/messaging",
        &events.lines().map(str::to_string).collect::<Vec<_>>(),
    );

    db.upsert_session(&session).unwrap();
    let summary = db.query_agent_usage_summary(None, None, None).unwrap();
    let agent = summary
        .agents
        .iter()
        .find(|agent| agent.name == "general-purpose")
        .unwrap();
    assert_eq!(agent.runs, 2);
    assert_eq!(agent.messaging_runs, 2);
    assert_eq!(agent.messages_sent, 2);
    assert_eq!(agent.messages_received, 4);
    assert_eq!(agent.peer_messages, 4);
    assert_eq!(agent.queued_messages, 1);

    let detail = db
        .query_agent_usage_detail("general-purpose", None, None, None)
        .unwrap();
    assert_eq!(detail.stats.messages_received, 4);
}

#[test]
fn detail_keeps_models_beyond_the_managers_top_three() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for (index, model) in ["model-a", "model-b", "model-c", "model-d"]
        .iter()
        .enumerate()
    {
        let events: Vec<String> = agent_session("2026-09-12")
            .into_iter()
            .map(|line| line.replace("gpt-5.4-mini", model))
            .collect();
        let session = write_raw_session(
            tmp.path(),
            &format!("model-session-{index}"),
            "org/models",
            &events,
        );
        db.upsert_session(&session).unwrap();
    }
    let summary = db.query_agent_usage_summary(None, None, None).unwrap();
    assert_eq!(
        summary
            .agents
            .iter()
            .find(|agent| agent.name == "explore")
            .unwrap()
            .top_models
            .len(),
        3
    );
    let detail = db
        .query_agent_usage_detail("explore", None, None, None)
        .unwrap();
    assert_eq!(detail.stats.top_models.len(), 4);
    assert_eq!(
        detail
            .stats
            .top_models
            .iter()
            .map(|model| model.runs)
            .sum::<u64>(),
        detail.stats.runs
    );
}

#[test]
fn detail_breaks_down_parents_failures_and_recent_runs() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = write_raw_session(
        tmp.path(),
        "d5555555-5555-5555-5555-555555555555",
        "org/agents",
        &agent_session("2026-09-12"),
    );
    db.upsert_session(&session).unwrap();

    let detail = db
        .query_agent_usage_detail("CODE-REVIEW", None, None, None)
        .unwrap();
    assert_eq!(detail.stats.runs, 1);
    assert_eq!(detail.invoked_by[0].parent.as_deref(), Some("explore"));
    assert_eq!(detail.depths[0].value, 1);
    assert_eq!(detail.failure_reasons[0].reason, "Request # after #s");
    assert_eq!(detail.recent_runs.len(), 1);
    assert_eq!(detail.recent_runs[0].outcome, "failed");
    assert_eq!(detail.repositories[0].label, "org/agents");

    let explore = db
        .query_agent_usage_detail("explore", None, None, None)
        .unwrap();
    assert_eq!(
        explore.invoked_by[0].parent, None,
        "launched by the main agent"
    );
    assert_eq!(explore.parallelism[0].value, 2);
    assert_eq!(explore.execution_modes[0].label, "background");
    assert_eq!(
        explore.dispatch[0].configured_model.as_deref(),
        Some("claude-haiku-4.5")
    );
}

#[test]
fn date_range_splits_runs_from_the_trend_window() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for (id, day) in [
        ("d6666666-6666-6666-6666-666666666666", "2026-09-12"),
        ("d7777777-7777-7777-7777-777777777777", "2026-09-02"),
    ] {
        let session = write_raw_session(tmp.path(), id, "org/agents", &agent_session(day));
        db.upsert_session(&session).unwrap();
    }

    let summary = db
        .query_agent_usage_summary(Some("2026-09-10"), Some("2026-09-19"), None)
        .unwrap();
    assert_eq!(summary.total_runs, 3, "the earlier session is trend-only");
    let explore = &summary.agents[0];
    assert_eq!(explore.runs, 2);
    assert_eq!(explore.previous_median_duration_ms, Some(6000));

    let everything = db.query_agent_usage_summary(None, None, None).unwrap();
    assert_eq!(everything.total_runs, 6);
    assert_eq!(everything.agents[0].previous_median_duration_ms, None);
}

#[test]
fn main_agent_selections_are_counted_per_session() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let events = vec![
        line("session.start", "2026-09-12T00:00:00Z", "{}", None),
        line(
            "subagent.selected",
            "2026-09-12T00:00:01Z",
            r#"{"agentName":"reviewer","agentDisplayName":"Reviewer","tools":[]}"#,
            None,
        ),
        line(
            "user.message",
            "2026-09-12T00:00:02Z",
            r#"{"content":"hi"}"#,
            None,
        ),
    ];
    let session = write_raw_session(
        tmp.path(),
        "d8888888-8888-8888-8888-888888888888",
        "org/agents",
        &events,
    );
    db.upsert_session(&session).unwrap();

    let summary = db.query_agent_usage_summary(None, None, None).unwrap();
    assert_eq!(summary.main_agent_selections.len(), 1);
    assert_eq!(summary.main_agent_selections[0].name, "reviewer");
    assert_eq!(summary.main_agent_selections[0].sessions, 1);
}
