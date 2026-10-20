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

fn listed(session: &crate::index_db::IndexedSession) -> Vec<(u32, Option<&str>)> {
    session
        .pull_requests
        .iter()
        .map(|pr| (pr.number, pr.title.as_deref()))
        .collect()
}

#[test]
fn the_list_carries_every_linked_pull_request_and_github_titles_win() {
    let (_tmp, db) = indexed();
    let session = &db.list_sessions(None, None, None, false).unwrap()[0];
    let numbers: Vec<u32> = listed(session).iter().map(|(n, _)| *n).collect();
    // The detail view's order: primary first, then by role.
    assert_eq!(numbers, vec![42, 41, 40]);
    assert_eq!(listed(session)[0].1, Some("Fix ripeness"));
    assert!(
        session
            .pull_requests
            .iter()
            .all(|pr| pr.owner == "example" && pr.repo == "orchard")
    );

    db.conn
        .execute_batch(
            "INSERT INTO pull_request_status (host, owner, repo, number, title, fetched_at)
             VALUES ('github.com', 'Example', 'Orchard', 41, 'Renamed on GitHub', 'x');
             INSERT INTO pull_request_status (host, owner, repo, number, fetched_at)
             VALUES ('github.com', 'example', 'orchard', 42, 'x');",
        )
        .unwrap();
    let session = &db.list_sessions(None, None, None, false).unwrap()[0];
    let titles = listed(session);
    assert_eq!(titles[0], (42, Some("Fix ripeness")), "no fetched title");
    assert_eq!(titles[1], (41, Some("Renamed on GitHub")));
    // Quick search reads the same rows.
    let found = db.search_sessions("Ship").unwrap();
    assert_eq!(listed(&found[0]), titles);
}

#[test]
fn listed_pull_requests_stay_with_their_session_and_are_capped() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let busy = "a1111111-1111-4111-8111-111111111111";
    let quiet = "b2222222-2222-4222-8222-222222222222";
    let none = "c3333333-3333-4333-8333-333333333333";
    for (id, count) in [(busy, 205), (quiet, 1), (none, 0)] {
        db.conn
            .execute(
                "INSERT INTO sessions (id, path, linked_pr_count, primary_pr_host,
                    primary_pr_owner, primary_pr_repo, primary_pr_number)
                 VALUES (?1, 'synthetic', ?2, 'github.com', 'example', 'orchard', 1)",
                rusqlite::params![id, count],
            )
            .unwrap();
    }
    let link = |id: &str, number: u32, primary: bool| {
        db.conn
            .execute(
                "INSERT INTO session_pull_requests
                    (session_id, host, owner, repo, number, roles, evidence, is_primary)
                 VALUES (?1, 'github.com', 'example', 'orchard', ?2, 2, 0, ?3)",
                rusqlite::params![id, number, primary],
            )
            .unwrap();
    };
    for number in 1..=205 {
        link(busy, number, number == 1);
    }
    link(quiet, 7, true);

    let sessions = db.list_sessions(None, None, None, false).unwrap();
    let by_id = |id: &str| sessions.iter().find(|s| s.id == id).unwrap();
    let busy = by_id(busy);
    assert_eq!(
        busy.pull_requests.len(),
        crate::index_db::MAX_LISTED_PULL_REQUESTS
    );
    // Primary first, then the highest numbers (same role, no timestamps).
    assert_eq!(busy.pull_requests[0].number, 1);
    assert_eq!(busy.pull_requests[1].number, 205);
    assert_eq!(listed(by_id(quiet)), vec![(7, None)]);
    assert!(by_id(none).pull_requests.is_empty());
}
