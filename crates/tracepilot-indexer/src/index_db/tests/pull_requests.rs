//! Linked pull requests written at index time and read back for the list
//! and the session detail.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::index_db::IndexDb;
use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::SessionSource;
use tracepilot_core::pull_requests::PullRequestRole;

const SESSION: &str = "f6666666-6666-4666-8666-666666666666";

fn write_raw_session(root: &Path, events: &[String]) -> PathBuf {
    let dir = root.join(SESSION);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("workspace.yaml"),
        format!(
            "id: {SESSION}\nsummary: \"Ship it\"\nrepository: \"example/orchard\"\nbranch: main\n\
             host_type: github\ncreated_at: \"2026-09-10T00:00:00Z\"\nupdated_at: \"2026-09-10T01:00:00Z\"\n"
        ),
    )
    .unwrap();
    fs::write(dir.join("events.jsonl"), events.join("\n") + "\n").unwrap();
    dir
}

fn line(event_type: &str, time: &str, data: serde_json::Value) -> String {
    serde_json::json!({
        "type": event_type,
        "data": data,
        "id": format!("{event_type}-{time}"),
        "timestamp": format!("2026-09-10T{time}Z"),
        "parentId": null,
    })
    .to_string()
}

fn shell(id: &str, time: &str, command: &str, output: &str) -> [String; 2] {
    [
        line(
            "tool.execution_start",
            time,
            serde_json::json!({"toolCallId": id, "toolName": "powershell", "arguments": {"command": command}}),
        ),
        line(
            "tool.execution_complete",
            time,
            serde_json::json!({"toolCallId": id, "success": true, "result": {"content": output}}),
        ),
    ]
}

/// Pushes a branch, opens a pull request for it, merges an older one by
/// number and reviews a third.
fn session_events() -> Vec<String> {
    let mut events = vec![
        line(
            "session.start",
            "00:00:00",
            serde_json::json!({"copilotVersion": "1.0.90", "context": {
                "cwd": "C:\\work\\orchard", "repository": "example/orchard",
                "hostType": "github", "repositoryHost": "github.com", "branch": "main"}}),
        ),
        line(
            "user.message",
            "00:00:01",
            serde_json::json!({"content": "ship the fix"}),
        ),
    ];
    events.extend(shell(
        "push",
        "00:01:00",
        "git push -u origin fix/ripe",
        "To https://github.com/example/orchard.git\n * [new branch]      fix/ripe -> fix/ripe\n\
         remote: Create a pull request for 'fix/ripe' on GitHub by visiting:\n\
         remote:      https://github.com/example/orchard/pull/new/fix/ripe\n<exited with exit code 0>",
    ));
    events.extend(shell(
        "create",
        "00:02:00",
        "gh pr create --title \"Fix ripeness\" --body done",
        "https://github.com/example/orchard/pull/42\n<exited with exit code 0>",
    ));
    events.extend(shell(
        "merge",
        "00:03:00",
        "gh pr merge 41 --squash",
        "✓ Squashed and merged pull request example/orchard#41 (Older fix)\n<exited with exit code 0>",
    ));
    events.extend(shell(
        "view",
        "00:04:00",
        "gh pr view 40",
        "title:\tReview me\nstate:\tOPEN\nurl:\thttps://github.com/example/orchard/pull/40\n<exited with exit code 0>",
    ));
    events
}

fn indexed() -> (tempfile::TempDir, IndexDb) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session = write_raw_session(tmp.path(), &session_events());
    db.upsert_session(&session).unwrap();
    (tmp, db)
}

fn sid() -> SessionId {
    SessionId::from_validated(SESSION)
}

fn count(db: &IndexDb, table: &str) -> i64 {
    db.conn
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn indexing_links_the_sessions_pull_requests_by_role() {
    let (_tmp, db) = indexed();
    let prs = db.get_session_pull_requests(&sid()).unwrap();
    let summary: Vec<(u32, Vec<PullRequestRole>, bool)> = prs
        .iter()
        .map(|pr| (pr.key.number, pr.roles.iter().collect(), pr.primary))
        .collect();
    assert_eq!(
        summary,
        vec![
            (42, vec![PullRequestRole::Created], true),
            (41, vec![PullRequestRole::Merged], false),
            (40, vec![PullRequestRole::Reviewed], false),
        ]
    );
    assert_eq!(
        prs[0].key.url(),
        "https://github.com/example/orchard/pull/42"
    );
    assert_eq!(prs[0].title.as_deref(), Some("Fix ripeness"));
    assert!(prs.iter().all(|pr| pr.status.is_none()));
}

#[test]
fn the_list_carries_the_primary_pull_request_and_count() {
    let (_tmp, db) = indexed();
    let sessions = db.list_sessions(None, None, None, false).unwrap();
    let session = &sessions[0];
    assert_eq!(session.linked_pr_count, 3);
    let primary = session.primary_pr.as_ref().expect("primary pull request");
    assert_eq!(primary.key.number, 42);
    assert_eq!(primary.state, None);
}

#[test]
fn pushed_branches_are_kept_and_the_new_pull_request_hint_is_not_a_link() {
    let (_tmp, db) = indexed();
    let branches: Vec<(String, String, String)> = db
        .conn
        .prepare("SELECT owner, repo, branch FROM session_pushed_branches")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        branches,
        vec![("example".into(), "orchard".into(), "fix/ripe".into())]
    );
}

#[test]
fn known_github_state_reaches_the_list_and_detail_case_insensitively() {
    let (_tmp, db) = indexed();
    db.conn
        .execute(
            "INSERT INTO pull_request_status (host, owner, repo, number, state, is_draft, title, fetched_at)
             VALUES ('GitHub.com', 'Example', 'Orchard', 42, 'open', 1, 'Fix ripeness', '2026-09-10T02:00:00Z')",
            [],
        )
        .unwrap();
    let session = &db.list_sessions(None, None, None, false).unwrap()[0];
    assert_eq!(
        session
            .primary_pr
            .as_ref()
            .and_then(|pr| pr.state.as_deref()),
        Some("draft")
    );
    let prs = db.get_session_pull_requests(&sid()).unwrap();
    let status = prs[0].status.as_ref().expect("status");
    assert_eq!(status.state.as_deref(), Some("open"));
    assert!(status.is_draft);
}

#[test]
fn reindexing_replaces_links_but_keeps_github_state() {
    let (tmp, db) = indexed();
    db.conn
        .execute(
            "INSERT INTO pull_request_status (host, owner, repo, number, state, fetched_at)
             VALUES ('github.com', 'example', 'orchard', 42, 'merged', '2026-09-10T02:00:00Z')",
            [],
        )
        .unwrap();
    // The session now only reviews one pull request.
    let mut events = session_events();
    events.truncate(2);
    events.extend(shell(
        "view",
        "00:05:00",
        "gh pr view 7",
        "url:\thttps://github.com/example/orchard/pull/7\n<exited with exit code 0>",
    ));
    let session = write_raw_session(tmp.path(), &events);
    db.upsert_session(&session).unwrap();

    let numbers: Vec<u32> = db
        .get_session_pull_requests(&sid())
        .unwrap()
        .iter()
        .map(|pr| pr.key.number)
        .collect();
    assert_eq!(numbers, vec![7]);
    assert_eq!(count(&db, "session_pushed_branches"), 0);
    assert_eq!(count(&db, "pull_request_status"), 1);
    let session = &db.list_sessions(None, None, None, false).unwrap()[0];
    assert_eq!(session.linked_pr_count, 1);
    assert_eq!(session.primary_pr.as_ref().map(|pr| pr.key.number), Some(7));
}

#[test]
fn pruning_a_session_removes_its_links() {
    let (_tmp, db) = indexed();
    assert_eq!(count(&db, "session_pull_requests"), 3);
    db.prune_deleted(SessionSource::Copilot, &HashSet::new())
        .unwrap();
    assert_eq!(count(&db, "session_pull_requests"), 0);
    assert_eq!(count(&db, "session_pushed_branches"), 0);
}
