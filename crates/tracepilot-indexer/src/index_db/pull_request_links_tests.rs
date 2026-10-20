//! Sessions that share a pull request, read from `session_pull_requests`.

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::SessionSource;
use tracepilot_core::pull_requests::{PullRequestKey, PullRequestRole};

use super::{
    IndexedRelatedPullRequestCount, MAX_PULL_REQUEST_SESSIONS, PULL_REQUEST_SESSIONS_SQL,
    RELATED_COUNTS_SQL,
};
use crate::index_db::IndexDb;

const A: &str = "a0000000-0000-4000-8000-000000000001";
const B: &str = "b0000000-0000-4000-8000-000000000002";
const C: &str = "c0000000-0000-4000-8000-000000000003";
const LONE: &str = "d0000000-0000-4000-8000-000000000004";

fn db() -> (tempfile::TempDir, IndexDb) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    (tmp, db)
}

fn session(db: &IndexDb, id: &str, source: &str, updated_at: Option<&str>) {
    db.conn
        .execute(
            "INSERT INTO sessions (id, path, summary, repository, source, updated_at)
             VALUES (?1, 'synthetic', 'Summary ' || ?1, 'example/orchard', ?2, ?3)",
            rusqlite::params![id, source, updated_at],
        )
        .unwrap();
}

/// Link `id` to `host/owner/repo#number` with role bits `roles`.
fn link(db: &IndexDb, id: &str, (host, owner, repo, number): (&str, &str, &str, u32), roles: u8) {
    db.conn
        .execute(
            "INSERT INTO session_pull_requests (session_id, host, owner, repo, number, roles, evidence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![id, host, owner, repo, number, roles],
        )
        .unwrap();
}

fn key(host: &str, owner: &str, repo: &str, number: u32) -> PullRequestKey {
    PullRequestKey {
        host: host.into(),
        owner: owner.into(),
        repo: repo.into(),
        number,
    }
}

fn counts(db: &IndexDb, id: &str) -> Vec<(String, u32, u32)> {
    db.get_session_pull_request_related_counts(&SessionId::from_validated(id))
        .unwrap()
        .into_iter()
        .map(
            |IndexedRelatedPullRequestCount {
                 key,
                 other_session_count,
             }| {
                (
                    format!("{}/{}", key.owner, key.repo),
                    key.number,
                    other_session_count,
                )
            },
        )
        .collect()
}

/// A and B both link orchard#58 (B spells it in another case), C links it
/// too on another host, and only A links #580 and #5.
fn fixture() -> (tempfile::TempDir, IndexDb) {
    let (tmp, db) = db();
    session(&db, A, "copilot", Some("2026-09-10T03:00:00Z"));
    session(&db, B, "claudeCode", Some("2026-09-10T05:00:00Z"));
    session(&db, C, "copilot", Some("2026-09-10T04:00:00Z"));
    session(&db, LONE, "copilot", None);
    link(&db, A, ("github.com", "example", "orchard", 58), 1);
    link(&db, A, ("github.com", "example", "orchard", 580), 2);
    link(&db, A, ("github.com", "example", "orchard", 5), 8);
    link(&db, B, ("GitHub.com", "Example", "ORCHARD", 58), 4 | 8);
    link(&db, C, ("github.com", "example", "orchard", 58), 16);
    link(&db, C, ("ghe.example.com", "example", "orchard", 58), 2);
    (tmp, db)
}

#[test]
fn related_counts_count_other_sessions_case_insensitively() {
    let (_tmp, db) = fixture();
    // #580 and #5 are linked by A alone; the other host's #58 is not counted.
    assert_eq!(counts(&db, A), vec![("example/orchard".into(), 58, 2)]);
    // B's row keeps its own spelling.
    assert_eq!(counts(&db, B), vec![("Example/ORCHARD".into(), 58, 2)]);
    let c = counts(&db, C);
    assert_eq!(c, vec![("example/orchard".into(), 58, 2)]);
}

#[test]
fn related_counts_are_empty_for_sessions_without_shared_pull_requests() {
    let (_tmp, db) = fixture();
    assert!(counts(&db, LONE).is_empty());
    assert!(counts(&db, "e0000000-0000-4000-8000-000000000005").is_empty());
    link(&db, LONE, ("github.com", "example", "orchard", 9), 1);
    assert!(counts(&db, LONE).is_empty());
}

#[test]
fn related_counts_count_each_other_session_once() {
    let (_tmp, db) = fixture();
    // B now has a second spelling of #58: still one other session for A.
    link(&db, B, ("github.com", "example", "orchard", 58), 2);
    assert_eq!(counts(&db, A), vec![("example/orchard".into(), 58, 2)]);
}

#[test]
fn pull_request_sessions_list_every_linked_session_newest_first() {
    let (_tmp, db) = fixture();
    let sessions = db
        .get_pull_request_sessions(&key("GITHUB.COM", "EXAMPLE", "orchard", 58))
        .unwrap();
    let ids: Vec<&str> = sessions.iter().map(|s| s.session_id.as_str()).collect();
    assert_eq!(ids, vec![B, C, A]);
    let b = &sessions[0];
    assert_eq!(b.source, SessionSource::ClaudeCode);
    assert_eq!(b.summary.as_deref(), Some(&*format!("Summary {B}")));
    assert_eq!(b.repository.as_deref(), Some("example/orchard"));
    assert_eq!(b.updated_at.as_deref(), Some("2026-09-10T05:00:00Z"));
    assert_eq!(
        b.roles.iter().collect::<Vec<_>>(),
        vec![PullRequestRole::Merged, PullRequestRole::Reviewed]
    );
    assert_eq!(
        sessions[1].roles.iter().collect::<Vec<_>>(),
        vec![PullRequestRole::Mentioned]
    );
}

#[test]
fn pull_request_sessions_match_the_exact_number_and_host() {
    let (_tmp, db) = fixture();
    let ids = |k: PullRequestKey| -> Vec<String> {
        db.get_pull_request_sessions(&k)
            .unwrap()
            .into_iter()
            .map(|s| s.session_id)
            .collect()
    };
    assert_eq!(ids(key("github.com", "example", "orchard", 580)), vec![A]);
    assert_eq!(ids(key("github.com", "example", "orchard", 5)), vec![A]);
    assert_eq!(
        ids(key("ghe.example.com", "example", "orchard", 58)),
        vec![C]
    );
    assert!(ids(key("github.com", "example", "orchard", 59)).is_empty());
    assert!(ids(key("github.com", "example", "orchards", 58)).is_empty());
}

#[test]
fn pull_request_sessions_merge_a_session_linked_in_two_spellings() {
    let (_tmp, db) = fixture();
    link(&db, B, ("github.com", "example", "orchard", 58), 1);
    let sessions = db
        .get_pull_request_sessions(&key("github.com", "example", "orchard", 58))
        .unwrap();
    assert_eq!(sessions.len(), 3);
    assert_eq!(
        sessions[0].roles.iter().collect::<Vec<_>>(),
        vec![
            PullRequestRole::Created,
            PullRequestRole::Merged,
            PullRequestRole::Reviewed
        ]
    );
}

#[test]
fn pull_request_sessions_are_capped() {
    let (_tmp, db) = db();
    for i in 0..(MAX_PULL_REQUEST_SESSIONS + 5) {
        let id = format!("f0000000-0000-4000-8000-{i:012}");
        session(
            &db,
            &id,
            "copilot",
            Some(&format!("2026-09-10T00:{:02}:00Z", i % 60)),
        );
        link(&db, &id, ("github.com", "example", "orchard", 1), 2);
    }
    let sessions = db
        .get_pull_request_sessions(&key("github.com", "example", "orchard", 1))
        .unwrap();
    assert_eq!(sessions.len(), MAX_PULL_REQUEST_SESSIONS);
    assert!(
        sessions
            .windows(2)
            .all(|w| (&w[0].updated_at, &w[1].session_id) >= (&w[1].updated_at, &w[0].session_id))
    );
}

fn plan(db: &IndexDb, sql: &str) -> String {
    let mut stmt = db
        .conn
        .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
        .unwrap();
    let column = stmt.column_count() - 1;
    let rows = stmt
        .query_map(
            rusqlite::params_from_iter(std::iter::repeat_n("x", stmt.parameter_count())),
            |row| row.get::<_, String>(column),
        )
        .unwrap();
    rows.map(Result::unwrap).collect::<Vec<_>>().join("\n")
}

/// Both reads find the other side through the pull request index, with or
/// without `ANALYZE` statistics.
#[test]
fn both_reads_look_up_the_pull_request_index() {
    let (_tmp, db) = fixture();
    for analyzed in [false, true] {
        if analyzed {
            db.conn.execute_batch("ANALYZE").unwrap();
        }
        for sql in [RELATED_COUNTS_SQL, PULL_REQUEST_SESSIONS_SQL] {
            let plan = plan(&db, sql);
            assert!(plan.contains("idx_session_pull_requests_pr"), "{plan}");
        }
    }
}
