//! Skill-invocation extraction at index time and the Skills usage queries.

use std::fs;
use std::path::{Path, PathBuf};

use crate::index_db::IndexDb;

fn write_raw_session(root: &Path, session_id: &str, repo: &str, events: &[String]) -> PathBuf {
    let dir = root.join(session_id);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {session_id}\nsummary: \"Skills session\"\nrepository: \"{repo}\"\n\
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

/// One turn that invokes `frontend-design` (with an event), a subagent that
/// invokes `playwright-cli`, and a `pdf` call the CLI recorded without an
/// event — the three shapes the local corpus actually holds.
fn skills_session(day: &str) -> Vec<String> {
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
            r#"{"toolCallId":"s1","toolName":"skill","arguments":{"skill":"frontend-design"}}"#,
            None,
        ),
        line(
            "tool.execution_complete",
            &t("00:00:03"),
            r#"{"toolCallId":"s1","success":true}"#,
            None,
        ),
        format!(
            r#"{{"type":"skill.invoked","data":{{"name":"frontend-design","path":"C:\\Users\\a\\.copilot\\skills\\frontend-design\\SKILL.md","content":"---\nname: frontend-design\ndescription: Design work\n---\nUse the tokens.","description":"Design work","trigger":"user-invoked","source":"personal-copilot","model":"gpt-5.4-mini"}},"id":"skill-1","timestamp":"{}","parentId":"tool.execution_complete-{}"}}"#,
            t("00:00:04"),
            t("00:00:03")
        ),
        line(
            "tool.execution_start",
            &t("00:00:05"),
            r#"{"toolCallId":"c1","toolName":"task","arguments":{"agent_type":"explore","name":"look"}}"#,
            None,
        ),
        line(
            "subagent.started",
            &t("00:00:05"),
            r#"{"toolCallId":"c1","agentName":"explore","agentType":"explore"}"#,
            Some("a1"),
        ),
        format!(
            r#"{{"type":"skill.invoked","data":{{"name":"playwright-cli","path":"/home/a/.copilot/skills/playwright-cli/SKILL.md","content":"---\nname: playwright-cli\n---\nDrive the CLI."}},"id":"skill-2","timestamp":"{}","parentId":null,"agentId":"a1"}}"#,
            t("00:00:06")
        ),
        line(
            "subagent.completed",
            &t("00:00:07"),
            r#"{"toolCallId":"c1","agentName":"explore","durationMs":2000}"#,
            None,
        ),
        // A skill tool call with no event behind it.
        line(
            "tool.execution_start",
            &t("00:00:08"),
            r#"{"toolCallId":"s2","toolName":"skill","arguments":{"skill":"pdf"}}"#,
            None,
        ),
        line(
            "tool.execution_complete",
            &t("00:00:09"),
            r#"{"toolCallId":"s2","success":true}"#,
            None,
        ),
    ]
}

fn count(db: &IndexDb, table: &str) -> i64 {
    db.conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

fn indexed(day: &str) -> (tempfile::TempDir, IndexDb) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = write_raw_session(
        tmp.path(),
        "e5555555-5555-5555-5555-555555555555",
        "org/skills",
        &skills_session(day),
    );
    db.upsert_session(&session).unwrap();
    (tmp, db)
}

#[test]
fn indexing_stores_invocations_once_and_summarizes_them() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = write_raw_session(
        tmp.path(),
        "e5555555-5555-5555-5555-555555555555",
        "org/skills",
        &skills_session("2026-09-12"),
    );

    db.upsert_session(&session).unwrap();
    db.upsert_session(&session).unwrap();
    assert_eq!(
        count(&db, "session_skill_invocations"),
        3,
        "re-indexing replaces rows rather than appending"
    );

    let summary = db.query_skill_usage_summary(None, None, None).unwrap();
    assert_eq!(summary.total_uses, 3);
    assert_eq!(summary.total_sessions, 1);
    assert_eq!(summary.fallback_uses, 1, "the pdf call had no event");
    assert_eq!(summary.skills.len(), 3);

    let frontend = summary
        .skills
        .iter()
        .find(|skill| skill.normalized_name == "frontend-design")
        .unwrap();
    assert_eq!(frontend.uses, 1);
    assert_eq!(frontend.sessions, 1);
    assert_eq!(frontend.repositories, 1);
    assert_eq!(frontend.user_invoked, 1);
    assert_eq!(frontend.unknown_trigger, 0);
    assert_eq!(frontend.main_agent_uses, 1);
    assert_eq!(frontend.description.as_deref(), Some("Design work"));
    assert_eq!(frontend.source.as_deref(), Some("personal-copilot"));
    assert_eq!(frontend.top_models[0].label, "gpt-5.4-mini");
    assert_eq!(
        frontend.paths[0].directory, "c:/users/a/.copilot/skills/frontend-design",
        "the path is folded for matching but kept for display"
    );
    assert!(frontend.latest_content_sha256.is_some());
    assert!(frontend.median_content_tokens.unwrap() > 0);
    assert_eq!(frontend.uses_with_content, 1);
    assert_eq!(frontend.daily_uses.len(), 1);
}

#[test]
fn a_subagent_invocation_is_attributed_to_it() {
    let (_tmp, db) = indexed("2026-09-12");
    let summary = db.query_skill_usage_summary(None, None, None).unwrap();

    let playwright = summary
        .skills
        .iter()
        .find(|skill| skill.normalized_name == "playwright-cli")
        .unwrap();
    assert_eq!(playwright.subagent_uses, 1);
    assert_eq!(playwright.main_agent_uses, 0);

    let detail = db
        .query_skill_usage_detail("playwright-cli", None, None, None)
        .unwrap();
    assert_eq!(detail.invoked_by[0].label, "explore");
}

#[test]
fn a_missing_trigger_is_unknown_rather_than_user_invoked() {
    let (_tmp, db) = indexed("2026-09-12");
    let summary = db.query_skill_usage_summary(None, None, None).unwrap();

    let playwright = summary
        .skills
        .iter()
        .find(|skill| skill.normalized_name == "playwright-cli")
        .unwrap();
    assert_eq!(playwright.unknown_trigger, 1);
    assert_eq!(playwright.user_invoked, 0);
    assert_eq!(playwright.agent_invoked, 0);
    assert_eq!(summary.unknown_trigger_uses, 2, "playwright and pdf");
}

#[test]
fn a_fallback_invocation_reports_no_cost_or_fingerprint() {
    let (_tmp, db) = indexed("2026-09-12");
    let summary = db.query_skill_usage_summary(None, None, None).unwrap();

    let pdf = summary
        .skills
        .iter()
        .find(|skill| skill.normalized_name == "pdf")
        .unwrap();
    assert_eq!(pdf.uses, 1);
    assert_eq!(pdf.fallback_uses, 1);
    assert_eq!(pdf.median_content_tokens, None);
    assert_eq!(pdf.uses_with_content, 0);
    assert_eq!(pdf.latest_content_sha256, None);
    assert!(pdf.paths.is_empty(), "a fallback records no path");
}

#[test]
fn the_injected_total_counts_only_the_uses_that_recorded_content() {
    let (_tmp, db) = indexed("2026-09-12");
    let summary = db.query_skill_usage_summary(None, None, None).unwrap();

    let with_content: u64 = summary
        .skills
        .iter()
        .map(|skill| skill.uses_with_content)
        .sum();
    assert_eq!(summary.uses_with_content, with_content);
    assert_eq!(
        summary.uses_with_content, 2,
        "the pdf fallback carried no content"
    );
    assert!(
        summary.total_content_tokens > 0,
        "the two invocations with content contribute a floor, not zero"
    );
}

#[test]
fn detail_links_back_to_the_turn_that_used_it() {
    let (_tmp, db) = indexed("2026-09-12");
    let detail = db
        .query_skill_usage_detail("Frontend-Design", None, None, None)
        .unwrap();

    assert_eq!(detail.stats.uses, 1, "the name matches case-insensitively");
    let record = &detail.recent_invocations[0];
    assert_eq!(record.repository.as_deref(), Some("org/skills"));
    assert_eq!(record.session_summary.as_deref(), Some("Skills session"));
    assert_eq!(record.origin, "event");
    assert_eq!(record.turn_index, 0);
    assert!(record.content_tokens.unwrap() > 0);
}

#[test]
fn the_range_and_repository_filters_apply() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for (index, (day, repo)) in [("2026-09-12", "org/a"), ("2026-06-01", "org/b")]
        .iter()
        .enumerate()
    {
        let session = write_raw_session(
            tmp.path(),
            &format!("range-session-{index}"),
            repo,
            &skills_session(day),
        );
        db.upsert_session(&session).unwrap();
    }

    let all = db.query_skill_usage_summary(None, None, None).unwrap();
    assert_eq!(all.total_uses, 6);

    let recent = db
        .query_skill_usage_summary(Some("2026-09-01"), Some("2026-09-30"), None)
        .unwrap();
    assert_eq!(recent.total_uses, 3);

    let by_repo = db
        .query_skill_usage_summary(None, None, Some("org/b"))
        .unwrap();
    assert_eq!(by_repo.total_uses, 3);
    assert_eq!(by_repo.total_sessions, 1);
}

#[test]
fn the_same_skill_used_from_two_clones_keeps_both_directories() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for (index, root) in ["C:\\\\git\\\\one", "C:\\\\git\\\\two"].iter().enumerate() {
        let events: Vec<String> = skills_session("2026-09-12")
            .into_iter()
            .map(|line| line.replace("C:\\\\Users\\\\a\\\\.copilot\\\\skills", root))
            .collect();
        let session = write_raw_session(
            tmp.path(),
            &format!("clone-session-{index}"),
            "org/clones",
            &events,
        );
        db.upsert_session(&session).unwrap();
    }

    let summary = db.query_skill_usage_summary(None, None, None).unwrap();
    let frontend = summary
        .skills
        .iter()
        .find(|skill| skill.normalized_name == "frontend-design")
        .unwrap();
    assert_eq!(frontend.uses, 2);
    assert_eq!(
        frontend.paths.len(),
        2,
        "one name, two installed directories: {:?}",
        frontend.paths
    );
}

#[test]
fn pruning_a_session_removes_its_invocations() {
    let (_tmp, db) = indexed("2026-09-12");
    assert_eq!(count(&db, "session_skill_invocations"), 3);

    // The session is gone from disk, so nothing is live any more.
    assert_eq!(
        db.prune_deleted(&std::collections::HashSet::new()).unwrap(),
        1
    );

    assert_eq!(count(&db, "session_skill_invocations"), 0);
    assert_eq!(
        db.query_skill_usage_summary(None, None, None)
            .unwrap()
            .total_uses,
        0
    );
}

#[test]
fn an_empty_index_returns_an_empty_summary() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let summary = db.query_skill_usage_summary(None, None, None).unwrap();
    assert_eq!(summary.total_uses, 0);
    assert!(summary.skills.is_empty());

    let detail = db
        .query_skill_usage_detail("nothing", None, None, None)
        .unwrap();
    assert_eq!(detail.stats.uses, 0);
    assert!(detail.recent_invocations.is_empty());
}
