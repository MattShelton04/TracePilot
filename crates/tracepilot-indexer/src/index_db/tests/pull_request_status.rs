//! GitHub lookups stored for linked pull requests: status rows, pushed-branch
//! lookups, and how both reach the session's pull request list.

use std::collections::HashSet;

use tracepilot_core::provider::SessionSource;
use tracepilot_core::pull_requests::{PullRequestKey, PullRequestRole};

use super::pull_requests::{count, indexed, session_events, sid, write_raw_session};
use crate::index_db::{
    BranchLookupUpdate, IndexDb, PullRequestRefreshWrite, PullRequestStatusUpdate,
};

const T1: &str = "2026-09-10T02:00:00Z";
const T2: &str = "2026-09-10T03:00:00Z";

fn key(owner: &str, number: u32) -> PullRequestKey {
    PullRequestKey {
        host: "github.com".into(),
        owner: owner.into(),
        repo: "orchard".into(),
        number,
    }
}

fn status(number: u32, state: &str, title: &str) -> PullRequestStatusUpdate {
    PullRequestStatusUpdate {
        key: key("example", number),
        state: Some(state.into()),
        is_draft: false,
        title: Some(title.into()),
        head_ref: Some("fix/ripe".into()),
        base_ref: Some("main".into()),
        head_owner: Some("example".into()),
        created_at: Some("2026-09-10T00:30:00Z".into()),
        merged_at: None,
        closed_at: None,
        review_decision: Some("approved".into()),
        checks_state: Some("success".into()),
    }
}

fn branch(name: &str, numbers: &[u32]) -> BranchLookupUpdate {
    BranchLookupUpdate {
        session_id: sid(),
        host: "github.com".into(),
        owner: "example".into(),
        repo: "orchard".into(),
        branch: name.into(),
        numbers: numbers.to_vec(),
    }
}

fn write(db: &IndexDb, write: PullRequestRefreshWrite, at: &str) -> bool {
    db.write_pull_request_refresh(&write, at).unwrap()
}

/// (number, roles, primary, found_by_branch) in display order.
fn links(db: &IndexDb) -> Vec<(u32, Vec<PullRequestRole>, bool, bool)> {
    db.get_session_pull_requests(&sid())
        .unwrap()
        .iter()
        .map(|pr| {
            (
                pr.key.number,
                pr.roles.iter().collect(),
                pr.primary,
                pr.found_by_branch,
            )
        })
        .collect()
}

#[test]
fn an_error_keeps_the_last_known_state_and_a_status_clears_it() {
    let (_tmp, db) = indexed();
    let mut first = status(42, "open", "Fix ripeness");
    first.key.owner = "Example".into();
    write(
        &db,
        PullRequestRefreshWrite {
            statuses: vec![first],
            ..Default::default()
        },
        T1,
    );
    write(
        &db,
        PullRequestRefreshWrite {
            errors: vec![(key("example", 42), "FORBIDDEN: no access".into())],
            ..Default::default()
        },
        T2,
    );
    assert_eq!(count(&db, "pull_request_status"), 1);
    let prs = db.get_session_pull_requests(&sid()).unwrap();
    let kept = prs[0].status.as_ref().expect("status");
    assert_eq!(kept.state.as_deref(), Some("open"));
    assert_eq!(kept.title.as_deref(), Some("Fix ripeness"));
    assert_eq!(kept.error.as_deref(), Some("FORBIDDEN: no access"));
    assert_eq!(kept.fetched_at, T2);

    write(
        &db,
        PullRequestRefreshWrite {
            statuses: vec![status(42, "merged", "Fix ripeness")],
            ..Default::default()
        },
        T2,
    );
    let prs = db.get_session_pull_requests(&sid()).unwrap();
    let fresh = prs[0].status.as_ref().expect("status");
    assert_eq!(fresh.state.as_deref(), Some("merged"));
    assert_eq!(fresh.error, None);
    let session = &db.list_sessions(None, None, None, false).unwrap()[0];
    assert_eq!(
        session
            .primary_pr
            .as_ref()
            .and_then(|pr| pr.state.as_deref()),
        Some("merged")
    );
}

#[test]
fn a_branch_lookup_adds_an_updated_link_without_touching_the_primary() {
    let (_tmp, db) = indexed();
    let changed = write(
        &db,
        PullRequestRefreshWrite {
            statuses: vec![status(43, "open", "Follow-up")],
            branches: vec![branch("fix/ripe", &[43])],
            ..Default::default()
        },
        T1,
    );
    assert!(changed);
    assert_eq!(
        links(&db),
        vec![
            (42, vec![PullRequestRole::Created], true, false),
            (43, vec![PullRequestRole::Updated], false, true),
            (41, vec![PullRequestRole::Merged], false, false),
            (40, vec![PullRequestRole::Reviewed], false, false),
        ]
    );
    let prs = db.get_session_pull_requests(&sid()).unwrap();
    let found = &prs[1];
    assert_eq!(found.head_ref.as_deref(), Some("fix/ripe"));
    assert_eq!(found.base_ref.as_deref(), Some("main"));
    assert_eq!(found.title.as_deref(), Some("Follow-up"));
    assert_eq!(found.first_seen_at.as_deref(), Some("2026-09-10T00:30:00Z"));
    assert_eq!(found.event_index, None);

    // The list's count and primary stay the extractor's.
    let session = &db.list_sessions(None, None, None, false).unwrap()[0];
    assert_eq!(session.linked_pr_count, 3);
    assert_eq!(
        session.primary_pr.as_ref().map(|pr| pr.key.number),
        Some(42)
    );

    // The same answer again changes no link.
    let again = write(
        &db,
        PullRequestRefreshWrite {
            branches: vec![branch("fix/ripe", &[43])],
            ..Default::default()
        },
        T2,
    );
    assert!(!again);
}

#[test]
fn a_known_link_gains_the_updated_role_once_and_duplicates_merge() {
    let (_tmp, db) = indexed();
    write(
        &db,
        PullRequestRefreshWrite {
            branches: vec![
                branch("fix/ripe", &[40, 44]),
                branch("fix/other", &[44, 42]),
            ],
            ..Default::default()
        },
        T1,
    );
    assert_eq!(
        links(&db),
        vec![
            (
                42,
                vec![PullRequestRole::Created, PullRequestRole::Updated],
                true,
                true
            ),
            (
                40,
                vec![PullRequestRole::Updated, PullRequestRole::Reviewed],
                false,
                true
            ),
            (44, vec![PullRequestRole::Updated], false, true),
            (41, vec![PullRequestRole::Merged], false, false),
        ]
    );
}

#[test]
fn a_lookup_that_matches_nothing_leaves_a_marker_readers_ignore() {
    let (_tmp, db) = indexed();
    write(
        &db,
        PullRequestRefreshWrite {
            branches: vec![branch("fix/ripe", &[43])],
            ..Default::default()
        },
        T1,
    );
    let changed = write(
        &db,
        PullRequestRefreshWrite {
            branches: vec![branch("fix/ripe", &[])],
            ..Default::default()
        },
        T2,
    );
    assert!(changed);
    let numbers: Vec<i64> = db
        .conn
        .prepare("SELECT number FROM session_branch_pull_requests")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(numbers, vec![0]);
    assert_eq!(links(&db).len(), 3);

    let lookups = db.session_pull_request_lookups(&sid()).unwrap().unwrap();
    assert_eq!(lookups.branches.len(), 1);
    assert_eq!(lookups.branches[0].branch, "fix/ripe");
    assert_eq!(lookups.branches[0].last_lookup_at.as_deref(), Some(T2));
    assert_eq!(lookups.pull_requests.len(), 3);
}

#[test]
fn lookups_list_each_pull_request_once_with_its_last_fetch() {
    let (_tmp, db) = indexed();
    let before = db.session_pull_request_lookups(&sid()).unwrap().unwrap();
    assert!(before.branches[0].last_lookup_at.is_none());
    assert_eq!(before.branches[0].owner, "example");
    assert!(before.created_at.is_some() && before.updated_at.is_some());
    assert!(
        before
            .pull_requests
            .iter()
            .all(|pr| pr.fetched_at.is_none())
    );

    write(
        &db,
        PullRequestRefreshWrite {
            statuses: vec![status(43, "open", "Follow-up")],
            errors: vec![(key("EXAMPLE", 41), "NOT_FOUND: gone".into())],
            branches: vec![branch("fix/ripe", &[43, 42])],
        },
        T1,
    );
    let after = db.session_pull_request_lookups(&sid()).unwrap().unwrap();
    let numbers: Vec<u32> = after.pull_requests.iter().map(|pr| pr.key.number).collect();
    // Primary first, then strongest role: the branch's #43 is `updated`.
    assert_eq!(numbers, vec![42, 43, 41, 40]);
    let errored = &after.pull_requests[2];
    assert_eq!(errored.error.as_deref(), Some("NOT_FOUND: gone"));
    assert_eq!(errored.fetched_at.as_deref(), Some(T1));
    assert_eq!(after.pull_requests[1].state.as_deref(), Some("open"));

    let missing =
        tracepilot_core::ids::SessionId::from_validated("a0000000-0000-4000-8000-000000000000");
    assert!(db.session_pull_request_lookups(&missing).unwrap().is_none());
    let primaries = db
        .primary_pull_request_fetch_states(&[missing, sid(), sid()])
        .unwrap();
    assert_eq!(primaries.len(), 1);
    assert_eq!(primaries[0].key.number, 42);
    assert!(primaries[0].fetched_at.is_none());
}

#[test]
fn reindexing_keeps_lookups_and_pruning_removes_them() {
    let (tmp, db) = indexed();
    write(
        &db,
        PullRequestRefreshWrite {
            statuses: vec![status(43, "open", "Follow-up")],
            branches: vec![branch("fix/ripe", &[43])],
            ..Default::default()
        },
        T1,
    );
    let mut events = session_events();
    events.extend(super::pull_requests::shell(
        "later",
        "00:06:00",
        "gh pr view 39",
        "url:\thttps://github.com/example/orchard/pull/39\n<exited with exit code 0>",
    ));
    db.upsert_session(&write_raw_session(tmp.path(), &events))
        .unwrap();
    assert_eq!(count(&db, "session_branch_pull_requests"), 1);
    assert!(links(&db).iter().any(|link| link.0 == 43 && link.3));

    db.prune_deleted(SessionSource::Copilot, &HashSet::new())
        .unwrap();
    assert_eq!(count(&db, "session_branch_pull_requests"), 0);
    // Status rows are keyed by pull request, shared across sessions.
    assert_eq!(count(&db, "pull_request_status"), 1);
}

#[test]
fn a_busy_database_fails_the_write_and_says_so() {
    let (tmp, db) = indexed();
    let other = rusqlite::Connection::open(tmp.path().join("index.db")).unwrap();
    other.execute_batch("BEGIN IMMEDIATE").unwrap();
    db.conn.execute_batch("PRAGMA busy_timeout=0").unwrap();
    let error = db
        .write_pull_request_refresh(
            &PullRequestRefreshWrite {
                statuses: vec![status(42, "open", "Fix ripeness")],
                ..Default::default()
            },
            T1,
        )
        .unwrap_err();
    assert!(error.is_busy(), "{error}");
    other.execute_batch("ROLLBACK").unwrap();
    assert_eq!(count(&db, "pull_request_status"), 0);
}

#[test]
fn refresh_writes_take_the_write_lock_before_reading() {
    let (tmp, db) = indexed();
    let other = rusqlite::Connection::open(tmp.path().join("index.db")).unwrap();
    other.execute_batch("PRAGMA busy_timeout=0").unwrap();
    let blocked = db
        .with_immediate_transaction(|_| {
            // Before the closure writes anything, no other writer can start.
            Ok(other.execute_batch("BEGIN IMMEDIATE").is_err())
        })
        .unwrap();
    assert!(blocked);
    let free = db
        .with_transaction(|_| Ok(other.execute_batch("BEGIN IMMEDIATE; ROLLBACK").is_ok()))
        .unwrap();
    assert!(free, "a deferred transaction holds no lock until it writes");
}
