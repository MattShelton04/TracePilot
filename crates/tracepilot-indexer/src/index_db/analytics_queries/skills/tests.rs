//! Skill usage files a folder-only session (mostly Claude Code) under the
//! repository the session list puts it in.

use crate::index_db::IndexDb;

/// `(id, repository, cwd, used ship)`.
const SESSIONS: &[(&str, Option<&str>, &str, bool)] = &[
    ("app-git", Some("acme/app"), r"C:\work\app", false),
    // Claude Code records only the folder; spelled differently, same folder.
    ("app-claude", None, "c:/work/app/", true),
    ("lib-git", Some("acme/lib"), "/home/dev/lib", true),
    // Two repositories ran here, so the loose session stays unattributed.
    ("shared-one", Some("acme/one"), r"C:\shared", false),
    ("shared-two", Some("acme/two"), r"C:\shared", false),
    ("shared-loose", None, r"C:\shared", true),
    ("lone", None, "/home/dev/lone", true),
];

fn seeded() -> (tempfile::TempDir, IndexDb) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for (i, (id, repo, cwd, used)) in SESSIONS.iter().enumerate() {
        db.conn
            .execute(
                "INSERT INTO sessions (id, path, repository, cwd, source, created_at, updated_at,
                                       turn_count, indexed_at)
                 VALUES (?1, ?1, ?2, ?3, 'claude', ?4, ?4, 1, datetime('now'))",
                rusqlite::params![id, repo, cwd, format!("2026-10-01T10:0{i}:00Z")],
            )
            .unwrap();
        if *used {
            db.conn
                .execute(
                    "INSERT INTO session_skill_invocations
                         (session_id, event_index, turn_index, skill_name, normalized_name, origin)
                     VALUES (?1, 0, 0, 'ship', 'ship', 'event')",
                    [id],
                )
                .unwrap();
        }
    }
    (tmp, db)
}

fn labels(counts: &[tracepilot_core::analytics::SkillLabelCount]) -> Vec<(&str, u64)> {
    let mut labels: Vec<_> = counts.iter().map(|c| (c.label.as_str(), c.uses)).collect();
    labels.sort();
    labels
}

#[test]
fn a_folder_only_use_counts_under_its_folders_repository() {
    let (_tmp, db) = seeded();
    let summary = db
        .query_skill_usage_summary(None, None, None, None)
        .unwrap();
    let ship = &summary.skills[0];
    assert_eq!(ship.uses, 4);
    // acme/app through its folder; the shared folder and `lone` stay
    // unattributed.
    assert_eq!(ship.repositories, 2);
    assert_eq!(
        labels(&ship.top_repositories),
        [("acme/app", 1), ("acme/lib", 1)]
    );

    let detail = db
        .query_skill_usage_detail("ship", None, None, None, None)
        .unwrap();
    assert_eq!(
        labels(&detail.repositories),
        [("acme/app", 1), ("acme/lib", 1)]
    );
    let repository_of = |id: &str| {
        detail
            .recent_invocations
            .iter()
            .find(|r| r.session_id == id)
            .and_then(|r| r.repository.clone())
    };
    assert_eq!(repository_of("app-claude").as_deref(), Some("acme/app"));
    assert_eq!(repository_of("lib-git").as_deref(), Some("acme/lib"));
    assert_eq!(repository_of("shared-loose"), None);
    assert_eq!(repository_of("lone"), None);
}

#[test]
fn the_repository_filter_and_the_figures_agree() {
    let (_tmp, db) = seeded();
    let summary = db
        .query_skill_usage_summary(None, None, Some("acme/app"), None)
        .unwrap();
    assert_eq!(summary.total_sessions, 1);
    assert_eq!(summary.skills[0].repositories, 1);
    assert_eq!(
        labels(&summary.skills[0].top_repositories),
        [("acme/app", 1)]
    );
}
