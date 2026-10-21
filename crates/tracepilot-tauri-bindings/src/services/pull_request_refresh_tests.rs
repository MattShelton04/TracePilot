//! Refresh failure handling, caps and the forced-refresh limit.

use tracepilot_orchestrator::github::pull_requests::MAX_ALIASES_PER_CALL;

use super::*;

/// A pushed-branch lookup GitHub refused: the earlier matches stay and the
/// branch stays due. A repository GitHub reports missing records "none".
#[tokio::test]
async fn a_refused_branch_lookup_keeps_its_earlier_matches() {
    let fx = fixture();
    fx.gh.branches.lock().unwrap().insert(
        "fix/ripe".into(),
        json!({"defaultBranchRef": {"name": "main"}, "pullRequests": {"nodes": [
            node(43, "OPEN", "example", "2026-09-10T00:30:00Z", None)]}}),
    );
    fx.session(at(Duration::zero()), false).await;
    assert_eq!(fx.branch_rows(), vec![("fix/ripe".to_string(), 43)]);

    fx.gh
        .branches
        .lock()
        .unwrap()
        .insert("fix/ripe".into(), json!({"error": "FORBIDDEN"}));
    let refused = fx.session(at(Duration::minutes(30)), false).await;
    assert_eq!(refused.lookup, PullRequestLookup::Ok);
    assert!(!refused.links_changed);
    assert_eq!(fx.branch_rows(), vec![("fix/ripe".to_string(), 43)]);

    // Still due: the next refresh asks again.
    fx.gh.clear();
    fx.gh
        .branches
        .lock()
        .unwrap()
        .insert("fix/ripe".into(), json!({"error": "NOT_FOUND"}));
    let gone = fx.session(at(Duration::minutes(31)), false).await;
    assert!(fx.gh.kinds().contains(&"branches"));
    assert!(gone.links_changed);
    assert_eq!(fx.branch_rows(), vec![("fix/ripe".to_string(), 0)]);
}

/// `gh auth status` failing for another reason than a sign-out (offline, a
/// slow server) backs off briefly and is not remembered as signed out.
#[tokio::test]
async fn an_unclear_auth_failure_is_not_cached_as_signed_out() {
    let fx = fixture();
    *fx.gh.auth.lock().unwrap() = Some(Ok(GhOutput {
        success: false,
        stdout: String::new(),
        stderr: "error connecting to api.github.com".into(),
    }));
    let failed = fx.session(at(Duration::zero()), false).await;
    assert_eq!(failed.lookup, PullRequestLookup::Failed);
    let backed_off = fx.session(at(Duration::minutes(1)), false).await;
    assert_ne!(backed_off.lookup, PullRequestLookup::SignedOut);
    assert_eq!(fx.gh.kinds(), vec!["auth"]);

    *fx.gh.auth.lock().unwrap() = None;
    let later = fx.session(at(FAILURE_BACKOFF), false).await;
    assert_eq!(later.lookup, PullRequestLookup::Ok);
    assert_eq!(fx.gh.kinds()[..2], ["auth", "auth"]);
    assert_eq!(fx.statuses().len(), 2);
}

#[tokio::test]
async fn a_session_gets_one_forced_refresh_per_ten_seconds() {
    let fx = fixture();
    fx.session(at(Duration::zero()), true).await;
    assert_eq!(fx.gh.kinds(), vec!["auth", "branches", "status"]);

    // A second force right away acts unforced: everything is fresh.
    fx.gh.clear();
    fx.session(at(Duration::seconds(5)), true).await;
    assert!(fx.gh.kinds().is_empty());

    fx.session(at(FORCE_INTERVAL), true).await;
    assert_eq!(fx.gh.kinds(), vec!["branches", "status"]);
}

/// Statuses asked for across a refresh's status calls.
fn status_numbers(fx: &Fixture) -> Vec<u32> {
    fx.gh
        .calls
        .lock()
        .unwrap()
        .iter()
        .filter(|args| args[0] != "auth")
        .flat_map(|args| {
            (0..MAX_ALIASES_PER_CALL)
                .filter_map(|i| variable(args, "-F", &format!("p{i}")))
                .map(|n| n.parse::<u32>().unwrap())
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Add `count` reviewed pull requests numbered from `first` to the session.
fn add_reviewed(fx: &Fixture, first: u32, count: u32) {
    let conn = rusqlite::Connection::open(&fx.path).unwrap();
    for number in first..first + count {
        conn.execute(
            "INSERT INTO session_pull_requests (session_id, host, owner, repo, number, roles, evidence, is_primary)
             VALUES (?1, 'github.com', 'example', 'orchard', ?2, 8, 0, 0)",
            rusqlite::params![S1, number],
        )
        .unwrap();
        fx.gh.prs.lock().unwrap().insert(
            number,
            node(number, "OPEN", "example", "2026-09-10T00:02:00Z", None),
        );
    }
}

#[tokio::test]
async fn a_session_refresh_fetches_at_most_two_hundred_strongest_first() {
    let fx = fixture();
    add_reviewed(&fx, 1000, 250);
    let first = fx.session(at(Duration::zero()), false).await;
    let asked = status_numbers(&fx);
    assert_eq!(asked.len(), MAX_SESSION_PULL_REQUESTS);
    // The primary and the merged link come before the reviewed ones.
    assert_eq!(asked[..2], [42, 41]);
    assert_eq!(first.updated.len(), MAX_SESSION_PULL_REQUESTS);

    fx.gh.clear();
    let rest = fx.session(at(Duration::minutes(1)), false).await;
    assert_eq!(status_numbers(&fx).len(), 252 - MAX_SESSION_PULL_REQUESTS);
    assert_eq!(rest.updated.len(), 52);
}

#[tokio::test]
async fn answers_from_calls_before_a_failed_one_are_written() {
    let fx = fixture();
    add_reviewed(&fx, 1000, 60);
    // Call 0 is the branch lookup, call 1 the first status batch.
    *fx.gh.fail_from_call.lock().unwrap() = Some(2);
    let partial = fx.session(at(Duration::zero()), false).await;
    assert_eq!(partial.lookup, PullRequestLookup::Ok);
    assert_eq!(partial.updated.len(), MAX_ALIASES_PER_CALL);
    assert_eq!(fx.statuses().len(), MAX_ALIASES_PER_CALL);
    assert_eq!(fx.branch_rows(), vec![("fix/ripe".to_string(), 0)]);

    // The host is backed off after the failure.
    fx.gh.clear();
    fx.session(at(Duration::minutes(1)), false).await;
    assert!(fx.gh.kinds().is_empty());
}
