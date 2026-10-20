//! Pull request refreshes against a fake `gh` (no network) and a real index.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tracepilot_core::ids::SessionId;
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_orchestrator::github::pull_requests::{GhCallError, GhOutput, GhRunner};

use super::*;
use crate::services::pull_request_policy::{OPEN_STALE_AFTER, parse_time};
use crate::types::PullRequestState;

const S1: &str = "a1111111-1111-4111-8111-111111111111";
const START: &str = "2026-09-10T02:00:00Z";

fn at(offset: Duration) -> DateTime<Utc> {
    parse_time(Some(START)).unwrap() + offset
}

fn sid(id: &str) -> SessionId {
    SessionId::from_validated(id)
}

/// The value after `flag name=` in an argument vector.
fn variable(args: &[String], flag: &str, name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == flag && pair[1].starts_with(&format!("{name}=")))
        .map(|pair| pair[1][name.len() + 1..].to_string())
}

fn node(number: u32, state: &str, owner: &str, created: &str, ended: Option<&str>) -> Value {
    json!({
        "number": number, "title": format!("PR {number}"), "state": state, "isDraft": false,
        "createdAt": created, "mergedAt": if state == "MERGED" { ended } else { None },
        "closedAt": ended, "headRefName": "fix/ripe", "baseRefName": "main",
        "headRepositoryOwner": {"login": owner}, "reviewDecision": null,
        "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "SUCCESS"}}}]}
    })
}

/// Answers `gh` like GitHub would for the pull requests and branches it knows.
#[derive(Default)]
struct FakeGh {
    calls: Mutex<Vec<Vec<String>>>,
    auth: Mutex<Option<Result<GhOutput, GhCallError>>>,
    graphql_failure: Mutex<Option<Result<GhOutput, GhCallError>>>,
    prs: Mutex<HashMap<u32, Value>>,
    branches: Mutex<HashMap<String, Value>>,
}

impl FakeGh {
    fn kinds(&self) -> Vec<&'static str> {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .map(|args| match args[0].as_str() {
                "auth" => "auth",
                _ if variable(args, "-f", "h0").is_some() => "branches",
                _ => "status",
            })
            .collect()
    }

    fn last_call(&self) -> Vec<String> {
        self.calls.lock().unwrap().last().cloned().unwrap()
    }

    fn clear(&self) {
        self.calls.lock().unwrap().clear();
    }

    fn respond(&self, args: &[String]) -> Result<GhOutput, GhCallError> {
        let mut data = serde_json::Map::new();
        let mut errors = Vec::new();
        let branches = self.branches.lock().unwrap();
        let prs = self.prs.lock().unwrap();
        for i in 0.. {
            if let Some(branch) = variable(args, "-f", &format!("h{i}")) {
                let repo = branches.get(&branch).cloned().unwrap_or_else(
                    || json!({"defaultBranchRef": {"name": "main"}, "pullRequests": {"nodes": []}}),
                );
                data.insert(format!("b{i}"), repo);
            } else if let Some(number) = variable(args, "-F", &format!("p{i}")) {
                let number: u32 = number.parse().unwrap();
                let alias = format!("pr{i}");
                match prs.get(&number) {
                    Some(pr) => {
                        data.insert(alias, json!({ "pullRequest": pr }));
                    }
                    None => {
                        data.insert(alias.clone(), Value::Null);
                        errors.push(json!({"type": "NOT_FOUND", "path": [alias],
                            "message": "Could not resolve to a Repository with the name 'example/orchard'."}));
                    }
                }
            } else {
                break;
            }
        }
        Ok(GhOutput {
            success: errors.is_empty(),
            stdout: json!({"data": data, "errors": errors}).to_string(),
            stderr: String::new(),
        })
    }
}

impl GhRunner for FakeGh {
    fn run(&self, args: &[String], _timeout_secs: u64) -> Result<GhOutput, GhCallError> {
        self.calls.lock().unwrap().push(args.to_vec());
        if args[0] == "auth" {
            return self.auth.lock().unwrap().clone().unwrap_or(Ok(GhOutput {
                success: true,
                ..GhOutput::default()
            }));
        }
        if let Some(failure) = self.graphql_failure.lock().unwrap().clone() {
            return failure;
        }
        self.respond(args)
    }
}

struct Fixture {
    _tmp: tempfile::TempDir,
    path: PathBuf,
    gh: Arc<FakeGh>,
    refresher: Arc<PullRequestRefresher>,
}

/// One session that created #42 (primary, open) and merged #41, and pushed
/// `fix/ripe` and `main` to example/orchard.
fn fixture() -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("index.db");
    IndexDb::open_or_create(&path).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    add_session(&conn, S1, 42);
    conn.execute_batch(&format!(
        "INSERT INTO session_pull_requests (session_id, host, owner, repo, number, roles, evidence, is_primary)
         VALUES ('{S1}', 'github.com', 'example', 'orchard', 41, 4, 0, 0);
         INSERT INTO session_pushed_branches (session_id, host, owner, repo, branch, first_push_at)
         VALUES ('{S1}', 'github.com', 'example', 'orchard', 'fix/ripe', '2026-09-10T00:01:00Z'),
                ('{S1}', 'github.com', 'example', 'orchard', 'main', '2026-09-10T00:01:00Z');"
    ))
    .unwrap();
    let gh = Arc::new(FakeGh::default());
    gh.prs.lock().unwrap().extend([
        (
            42,
            node(42, "OPEN", "example", "2026-09-10T00:02:00Z", None),
        ),
        (
            41,
            node(
                41,
                "MERGED",
                "example",
                "2026-09-01T00:00:00Z",
                Some("2026-09-10T00:03:00Z"),
            ),
        ),
    ]);
    let refresher = Arc::new(PullRequestRefresher::new(gh.clone()));
    Fixture {
        _tmp: tmp,
        path,
        gh,
        refresher,
    }
}

fn add_session(conn: &rusqlite::Connection, id: &str, primary: u32) {
    conn.execute_batch(&format!(
        "INSERT INTO sessions (id, path, source, created_at, updated_at, linked_pr_count,
             primary_pr_host, primary_pr_owner, primary_pr_repo, primary_pr_number)
         VALUES ('{id}', '{id}', 'copilot', '2026-09-10T00:00:00Z', '2026-09-10T01:00:00Z', 1,
             'github.com', 'example', 'orchard', {primary});
         INSERT INTO session_pull_requests (session_id, host, owner, repo, number, roles, evidence, is_primary)
         VALUES ('{id}', 'github.com', 'example', 'orchard', {primary}, 1, 0, 1);"
    ))
    .unwrap();
}

impl Fixture {
    fn ctx(&self, now: DateTime<Utc>) -> RefreshContext {
        RefreshContext {
            index_path: self.path.clone(),
            enabled: true,
            now,
        }
    }

    async fn session(&self, now: DateTime<Utc>, force: bool) -> PullRequestRefreshResult {
        self.refresher
            .refresh_session(self.ctx(now), sid(S1), force)
            .await
            .unwrap()
    }

    fn db(&self) -> IndexDb {
        IndexDb::open_readonly(&self.path).unwrap()
    }

    /// (number, state, error) per stored status row.
    fn statuses(&self) -> Vec<(u32, Option<String>, Option<String>)> {
        let conn = rusqlite::Connection::open(&self.path).unwrap();
        let mut stmt = conn
            .prepare("SELECT number, state, error FROM pull_request_status ORDER BY number")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn branch_rows(&self) -> Vec<(String, u32)> {
        let conn = rusqlite::Connection::open(&self.path).unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT branch, number FROM session_branch_pull_requests ORDER BY branch, number",
            )
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }
}

fn numbers(result: &PullRequestRefreshResult) -> Vec<(u32, Option<PullRequestState>)> {
    let mut refs: Vec<_> = result
        .updated
        .iter()
        .map(|pr| (pr.number, pr.state))
        .collect();
    refs.sort_by_key(|(number, _)| *number);
    refs
}

#[tokio::test]
async fn the_setting_off_asks_nothing() {
    let fx = fixture();
    let mut ctx = fx.ctx(at(Duration::zero()));
    ctx.enabled = false;
    let done = fx
        .refresher
        .refresh_session(ctx.clone(), sid(S1), true)
        .await
        .unwrap();
    assert_eq!(done.lookup, PullRequestLookup::Disabled);
    let done = fx.refresher.refresh_list(ctx, vec![sid(S1)]).await.unwrap();
    assert_eq!(done.lookup, PullRequestLookup::Disabled);
    assert!(fx.gh.kinds().is_empty());
}

#[tokio::test]
async fn a_session_refresh_looks_up_branches_then_statuses_and_stores_them() {
    let fx = fixture();
    fx.gh.branches.lock().unwrap().insert(
        "fix/ripe".into(),
        json!({"defaultBranchRef": {"name": "main"}, "pullRequests": {"nodes": [
            node(43, "OPEN", "example", "2026-09-10T00:30:00Z", None),
            node(50, "OPEN", "someone-else", "2026-09-10T00:30:00Z", None),
            node(51, "CLOSED", "example", "2026-09-01T00:00:00Z", Some("2026-09-05T00:00:00Z")),
            node(52, "OPEN", "example", "2026-09-12T00:00:00Z", None),
            node(53, "MERGED", "example", "2026-09-01T00:00:00Z", Some("2026-09-10T00:20:00Z")),
        ]}}),
    );
    let done = fx.session(at(Duration::zero()), false).await;

    assert_eq!(done.lookup, PullRequestLookup::Ok);
    assert!(done.links_changed);
    assert_eq!(fx.gh.kinds(), vec!["auth", "branches", "status"]);
    // `main` is never asked about; #43 and #53 came with the branch lookup.
    let calls = fx.gh.calls.lock().unwrap().clone();
    assert_eq!(variable(&calls[1], "-f", "h0").as_deref(), Some("fix/ripe"));
    assert!(variable(&calls[1], "-f", "h1").is_none());
    let status_numbers: Vec<_> = (0..3)
        .filter_map(|i| variable(&calls[2], "-F", &format!("p{i}")))
        .collect();
    assert_eq!(status_numbers, vec!["42", "41"]);
    assert_eq!(
        numbers(&done),
        vec![
            (41, Some(PullRequestState::Merged)),
            (42, Some(PullRequestState::Open)),
            (43, Some(PullRequestState::Open)),
            (53, Some(PullRequestState::Merged)),
        ]
    );
    assert_eq!(
        fx.branch_rows(),
        vec![("fix/ripe".to_string(), 43), ("fix/ripe".to_string(), 53)]
    );
    let linked: Vec<(u32, bool)> = fx
        .db()
        .get_session_pull_requests(&sid(S1))
        .unwrap()
        .iter()
        .map(|pr| (pr.key.number, pr.found_by_branch))
        .collect();
    assert_eq!(
        linked,
        vec![(42, false), (53, true), (43, true), (41, false)]
    );

    // Everything is fresh now: no gh at all, not even auth.
    fx.gh.clear();
    let again = fx.session(at(Duration::minutes(5)), false).await;
    assert_eq!(again.lookup, PullRequestLookup::Ok);
    assert!(again.updated.is_empty() && !again.links_changed);
    assert!(fx.gh.kinds().is_empty());

    // A forced refresh reuses the cached sign-in and asks for everything.
    let forced = fx.session(at(Duration::minutes(6)), true).await;
    assert_eq!(fx.gh.kinds(), vec!["branches", "status"]);
    assert!(!forced.links_changed);
}

#[tokio::test]
async fn open_pull_requests_go_stale_after_ten_minutes_and_merged_ones_never() {
    let fx = fixture();
    fx.session(at(Duration::zero()), false).await;
    fx.gh.clear();
    let almost = fx
        .session(at(OPEN_STALE_AFTER - Duration::seconds(1)), false)
        .await;
    assert!(almost.updated.is_empty());
    assert!(fx.gh.kinds().is_empty());

    let stale = fx.session(at(OPEN_STALE_AFTER), false).await;
    // Only #42: #41 is merged, and the branch was looked up 10 minutes ago.
    assert_eq!(numbers(&stale), vec![(42, Some(PullRequestState::Open))]);
    assert_eq!(fx.gh.kinds(), vec!["auth", "status"]);
    assert_eq!(
        variable(&fx.gh.last_call(), "-F", "p0").as_deref(),
        Some("42")
    );
}

#[tokio::test]
async fn a_missing_pull_request_stores_an_error_and_is_retried_after_an_hour() {
    let fx = fixture();
    fx.gh.prs.lock().unwrap().remove(&41);
    let done = fx.session(at(Duration::zero()), false).await;
    assert_eq!(done.lookup, PullRequestLookup::Ok);
    assert_eq!(
        fx.statuses(),
        vec![
            (
                41,
                None,
                Some(
                    "NOT_FOUND: Could not resolve to a Repository with the name 'example/orchard'."
                        .into()
                )
            ),
            (42, Some("open".into()), None),
        ]
    );
    assert!(numbers(&done).contains(&(41, None)));

    fx.gh.clear();
    fx.session(at(Duration::minutes(59)), false).await;
    let asked: Vec<_> = fx
        .gh
        .calls
        .lock()
        .unwrap()
        .iter()
        .filter_map(|args| variable(args, "-F", "p0"))
        .collect();
    assert_eq!(asked, vec!["42"]);

    fx.gh.clear();
    fx.gh.prs.lock().unwrap().insert(
        41,
        node(
            41,
            "MERGED",
            "example",
            "2026-09-01T00:00:00Z",
            Some("2026-09-10T00:03:00Z"),
        ),
    );
    let retried = fx.session(at(Duration::hours(1)), false).await;
    assert!(numbers(&retried).contains(&(41, Some(PullRequestState::Merged))));
    assert_eq!(fx.statuses()[0], (41, Some("merged".into()), None));
}

#[tokio::test]
async fn a_failed_batch_writes_nothing_and_backs_off() {
    let fx = fixture();
    *fx.gh.graphql_failure.lock().unwrap() = Some(Err(GhCallError::Timeout(30)));
    let done = fx.session(at(Duration::zero()), false).await;
    assert_eq!(done.lookup, PullRequestLookup::Failed);
    assert!(fx.statuses().is_empty() && fx.branch_rows().is_empty());
    assert_eq!(fx.gh.kinds(), vec!["auth", "branches"]);

    fx.gh.clear();
    let backed_off = fx.session(at(Duration::minutes(1)), false).await;
    assert!(backed_off.updated.is_empty());
    assert!(fx.gh.kinds().is_empty());

    *fx.gh.graphql_failure.lock().unwrap() = None;
    let later = fx.session(at(FAILURE_BACKOFF), false).await;
    assert_eq!(later.lookup, PullRequestLookup::Ok);
    assert_eq!(fx.statuses().len(), 2);
}

#[tokio::test]
async fn without_gh_or_a_sign_in_nothing_is_written_and_auth_is_cached() {
    let fx = fixture();
    *fx.gh.auth.lock().unwrap() = Some(Err(GhCallError::NotInstalled));
    let done = fx.session(at(Duration::zero()), false).await;
    assert_eq!(done.lookup, PullRequestLookup::NotInstalled);
    let again = fx.session(at(Duration::minutes(1)), false).await;
    assert_eq!(again.lookup, PullRequestLookup::NotInstalled);
    assert_eq!(fx.gh.kinds(), vec!["auth"]);

    *fx.gh.auth.lock().unwrap() = Some(Ok(GhOutput::default()));
    let signed_out = fx.session(at(AUTH_TTL), false).await;
    assert_eq!(signed_out.lookup, PullRequestLookup::SignedOut);
    assert_eq!(fx.gh.kinds(), vec!["auth", "auth"]);
    assert!(fx.statuses().is_empty() && fx.branch_rows().is_empty());

    // A forced refresh asks again rather than trusting a cached sign-out.
    *fx.gh.auth.lock().unwrap() = None;
    let forced = fx.session(at(AUTH_TTL + Duration::minutes(1)), true).await;
    assert_eq!(forced.lookup, PullRequestLookup::Ok);
    assert_eq!(fx.statuses().len(), 2);
}

#[tokio::test]
async fn branch_lookups_respect_the_default_branch_and_recheck_timing() {
    let fx = fixture();
    // The repository's default branch is the pushed one: ignore its results.
    fx.gh.branches.lock().unwrap().insert(
        "fix/ripe".into(),
        json!({"defaultBranchRef": {"name": "fix/ripe"}, "pullRequests": {"nodes": [
            node(43, "OPEN", "example", "2026-09-10T00:30:00Z", None)]}}),
    );
    let done = fx.session(at(Duration::zero()), false).await;
    assert!(!done.links_changed);
    assert_eq!(fx.branch_rows(), vec![("fix/ripe".to_string(), 0)]);

    // Rechecked after 30 minutes while the session's window is open.
    fx.gh.branches.lock().unwrap().insert(
        "fix/ripe".into(),
        json!({"defaultBranchRef": {"name": "main"}, "pullRequests": {"nodes": [
            node(43, "OPEN", "example", "2026-09-10T00:30:00Z", None)]}}),
    );
    fx.gh.clear();
    fx.session(at(Duration::minutes(29)), false).await;
    assert!(!fx.gh.kinds().contains(&"branches"));
    let found = fx.session(at(Duration::minutes(30)), false).await;
    assert!(found.links_changed);
    assert_eq!(fx.branch_rows(), vec![("fix/ripe".to_string(), 43)]);

    // The window closed at 2026-09-11T01:00; a lookup after it is the last.
    fx.gh.clear();
    let closed = at(Duration::hours(30));
    fx.session(closed, false).await;
    assert!(fx.gh.kinds().contains(&"branches"));
    fx.gh.clear();
    fx.session(closed + Duration::hours(2), false).await;
    assert!(!fx.gh.kinds().contains(&"branches"));
}

#[tokio::test]
async fn list_refreshes_take_primaries_in_one_batch_a_minute() {
    let fx = fixture();
    let conn = rusqlite::Connection::open(&fx.path).unwrap();
    let mut ids = vec![sid(S1)];
    for i in 0..60u32 {
        let id = format!("b{i:07}-0000-4000-8000-000000000000");
        add_session(&conn, &id, 100 + i);
        fx.gh.prs.lock().unwrap().insert(
            100 + i,
            node(100 + i, "OPEN", "example", "2026-09-10T00:02:00Z", None),
        );
        ids.push(sid(&id));
    }
    let first = fx
        .refresher
        .refresh_list(fx.ctx(at(Duration::zero())), ids.clone())
        .await
        .unwrap();
    assert_eq!(first.updated.len(), MAX_LIST_PULL_REQUESTS);
    assert_eq!(fx.gh.kinds(), vec!["auth", "status"]);
    assert!(variable(&fx.gh.last_call(), "-F", "p49").is_some());
    assert!(fx.branch_rows().is_empty());

    fx.gh.clear();
    let throttled = fx
        .refresher
        .refresh_list(fx.ctx(at(Duration::seconds(59))), ids.clone())
        .await
        .unwrap();
    assert!(throttled.updated.is_empty());
    assert!(fx.gh.kinds().is_empty());

    let next = fx
        .refresher
        .refresh_list(fx.ctx(at(LIST_INTERVAL)), ids.clone())
        .await
        .unwrap();
    assert_eq!(next.updated.len(), 11);
    assert_eq!(fx.gh.kinds(), vec!["status"]);

    // Nothing due: no call, and the throttle is not spent.
    fx.gh.clear();
    let idle = fx
        .refresher
        .refresh_list(fx.ctx(at(LIST_INTERVAL * 3)), ids)
        .await
        .unwrap();
    assert!(idle.updated.is_empty());
    assert!(fx.gh.kinds().is_empty());
}
