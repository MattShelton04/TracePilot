//! Agent usage files a folder-only session (mostly Claude Code) under the
//! repository the session list puts it in, so its repository bars add up.

use crate::index_db::IndexDb;

/// `(id, repository, cwd, ran planner)`.
const SESSIONS: &[(&str, Option<&str>, &str, bool)] = &[
    ("app-git", Some("acme/app"), r"C:\work\app", true),
    // Claude Code records only the folder; spelled differently, same folder.
    ("app-claude", None, "c:/work/app/", true),
    // A blank repository is none, not a repository named "".
    ("app-blank", Some(""), r"C:\work\app", true),
    // Two repositories ran here, so the loose session stays unattributed.
    ("shared-one", Some("acme/one"), r"C:\shared", false),
    ("shared-two", Some("acme/two"), r"C:\shared", false),
    ("shared-loose", None, r"C:\shared", true),
];

fn seeded() -> (tempfile::TempDir, IndexDb) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for (i, (id, repo, cwd, ran)) in SESSIONS.iter().enumerate() {
        db.conn
            .execute(
                "INSERT INTO sessions (id, path, repository, cwd, source, created_at, updated_at,
                                       turn_count, indexed_at)
                 VALUES (?1, ?1, ?2, ?3, 'claude', ?4, ?4, 1, datetime('now'))",
                rusqlite::params![id, repo, cwd, format!("2026-10-01T10:0{i}:00Z")],
            )
            .unwrap();
        if *ran {
            db.conn
                .execute(
                    "INSERT INTO session_agent_runs
                         (session_id, run_key, depth, agent_name, outcome, turn_index, source)
                     VALUES (?1, 'run-1', 1, 'planner', 'completed', 0, 'events')",
                    [id],
                )
                .unwrap();
        }
    }
    (tmp, db)
}

#[test]
fn a_folder_only_run_counts_under_its_folders_repository() {
    let (_tmp, db) = seeded();
    let detail = db
        .query_agent_usage_detail("planner", None, None, None, None)
        .unwrap();
    assert_eq!(detail.stats.runs, 4);
    let repositories: Vec<_> = detail
        .repositories
        .iter()
        .map(|c| (c.label.as_str(), c.runs))
        .collect();
    assert_eq!(repositories, [("acme/app", 3)]);
    let repository_of = |id: &str| {
        detail
            .recent_runs
            .iter()
            .find(|r| r.session_id == id)
            .and_then(|r| r.repository.clone())
    };
    assert_eq!(repository_of("app-claude").as_deref(), Some("acme/app"));
    assert_eq!(repository_of("shared-loose"), None);
}
