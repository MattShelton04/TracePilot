//! The repository filter on Analytics, Tools, Code, Agents, Skills and Search
//! selects exactly the sessions the session list's repository filter shows
//! (`apps/desktop/src/stores/sessions/filtering.ts`): a repository's own
//! sessions plus repository-less sessions run in one of its folders, and a
//! `project:<folder>` key for the repository-less sessions of that folder name.

use std::collections::BTreeSet;

use crate::index_db::{IndexDb, SearchFilters};

/// `(id, repository, cwd)`; every session has one turn.
const SESSIONS: &[(&str, Option<&str>, &str)] = &[
    (
        "orchard-git",
        Some("example/orchard"),
        r"C:\synthetic\orchard",
    ),
    // Claude Code records only the folder; spelled differently, same folder.
    ("orchard-claude", None, "c:/synthetic/orchard/"),
    ("orchard-blank", Some(""), r"C:\synthetic\orchard"),
    // A subfolder can be a clone of its own, so it never folds in.
    ("orchard-sub", None, r"C:\synthetic\orchard\sub"),
    ("harbor-win", None, r"C:\synthetic\harbor"),
    ("harbor-posix", None, "/home/dev/harbor"),
    // Two repositories ran in this folder, so its loose session stays a folder.
    ("shared-one", Some("example/one"), r"C:\shared"),
    ("shared-two", Some("example/two"), r"C:\shared"),
    ("shared-loose", None, r"C:\shared"),
];

fn seeded() -> (tempfile::TempDir, IndexDb) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for (i, (id, repo, cwd)) in SESSIONS.iter().enumerate() {
        db.conn
            .execute(
                "INSERT INTO sessions (id, path, repository, cwd, source, created_at, updated_at,
                                       turn_count, lines_added, indexed_at)
                 VALUES (?1, ?1, ?2, ?3, 'copilot', '2026-10-01T10:00:00Z',
                         '2026-10-01T11:00:00Z', 1, 1, datetime('now'))",
                rusqlite::params![id, repo, cwd],
            )
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO session_tool_calls (session_id, tool_name, call_count, success_count)
                 VALUES (?1, 'grep', 1, 1)",
                [id],
            )
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO session_agent_selections
                     (session_id, event_index, agent_name, selected, timestamp)
                 VALUES (?1, 0, 'planner', 1, '2026-10-01T10:00:00Z')",
                [id],
            )
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO session_skill_invocations
                     (session_id, event_index, turn_index, timestamp, skill_name,
                      normalized_name, origin)
                 VALUES (?1, 0, 0, '2026-10-01T10:00:00Z', 'ship', 'ship', 'event')",
                [id],
            )
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO search_content (session_id, content_type, timestamp_unix, content)
                 VALUES (?1, 'user_message', ?2, ?3)",
                rusqlite::params![id, 1_790_000_000 + i as i64, format!("release notes {id}")],
            )
            .unwrap();
    }
    (tmp, db)
}

/// Sessions the search filter returns for `key`, browsing and with a query.
fn searched(db: &IndexDb, key: &str) -> BTreeSet<String> {
    let filters = SearchFilters {
        repositories: vec![key.to_string()],
        ..SearchFilters::default()
    };
    let browse: BTreeSet<String> = db
        .query_content(None, &filters)
        .unwrap()
        .into_iter()
        .map(|r| r.session_id)
        .collect();
    let matched: BTreeSet<String> = db
        .query_content(Some("release"), &filters)
        .unwrap()
        .into_iter()
        .map(|r| r.session_id)
        .collect();
    assert_eq!(browse, matched, "browse and query disagree for {key}");
    assert_eq!(
        db.query_count(Some("release"), &filters).unwrap(),
        matched.len() as i64
    );
    let facets = db.facets(Some("release"), &filters).unwrap();
    assert_eq!(facets.session_count, matched.len() as i64);
    matched
}

fn ids(list: &[&str]) -> BTreeSet<String> {
    list.iter().map(|s| (*s).to_string()).collect()
}

/// Every filtered surface agrees on how many sessions `key` selects.
fn assert_selects(db: &IndexDb, key: &str, expected: &[&str]) {
    let n = expected.len() as u64;
    let analytics = db
        .query_analytics(None, None, Some(key), false, None)
        .unwrap();
    assert_eq!(analytics.total_sessions as u64, n, "analytics for {key}");
    let tools = db
        .query_tool_analysis(None, None, Some(key), false, None)
        .unwrap();
    assert_eq!(tools.total_calls as u64, n, "tool calls for {key}");
    let code = db
        .query_code_impact(None, None, Some(key), false, None)
        .unwrap();
    assert_eq!(code.lines_added, n, "code impact for {key}");
    let agents = db
        .query_agent_usage_summary(None, None, Some(key), None)
        .unwrap();
    let selected = agents
        .main_agent_selections
        .first()
        .map_or(0, |s| s.sessions);
    assert_eq!(selected, n, "agent selections for {key}");
    let skills = db
        .query_skill_usage_summary(None, None, Some(key), None)
        .unwrap();
    assert_eq!(skills.total_sessions, n, "skills for {key}");
    assert_eq!(searched(db, key), ids(expected), "search for {key}");
}

#[test]
fn a_repository_includes_the_folder_only_sessions_of_its_folders() {
    let (_tmp, db) = seeded();
    assert_selects(
        &db,
        "example/orchard",
        &["orchard-blank", "orchard-claude", "orchard-git"],
    );
    assert_selects(&db, "example/one", &["shared-one"]);
}

#[test]
fn a_project_key_selects_folder_only_sessions_by_folder_name() {
    let (_tmp, db) = seeded();
    assert_selects(&db, "project:harbor", &["harbor-posix", "harbor-win"]);
    // Folded sessions still match their own folder key, as on the list.
    assert_selects(&db, "project:orchard", &["orchard-blank", "orchard-claude"]);
    assert_selects(&db, "project:sub", &["orchard-sub"]);
    assert_selects(&db, "project:shared", &["shared-loose"]);
    assert_selects(&db, "project:missing", &[]);
}

#[test]
fn a_typed_search_repository_falls_back_to_a_folder_name() {
    let (_tmp, db) = seeded();
    // `repo:harbor` names no repository, so search reads it as the folder.
    assert_eq!(
        searched(&db, "harbor"),
        ids(&["harbor-posix", "harbor-win"])
    );
    // A name that is a repository never widens to a folder of that name.
    assert_eq!(
        searched(&db, "example/orchard"),
        ids(&["orchard-blank", "orchard-claude", "orchard-git"])
    );
    // Analytics only ever receives keys from its own picker: no fallback.
    let analytics = db
        .query_analytics(None, None, Some("harbor"), false, None)
        .unwrap();
    assert_eq!(analytics.total_sessions, 0);
}
