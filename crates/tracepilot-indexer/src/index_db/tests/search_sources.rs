//! U-05: the search source filter. Results, counts and facets for one source
//! must cover only that source's sessions, and no source must cover every
//! session exactly as before.

use super::common::write_session;
use crate::SearchFilters;
use crate::index_db::IndexDb;
use crate::index_db::search_writer::SearchContentRow;
use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::SessionSource;

const COPILOT: &str = "aaaa0000-0000-4000-8000-000000000001";
const CLAUDE: &str = "aaaa0000-0000-4000-8000-000000000002";

fn row(
    session_id: &str,
    content_type: &'static str,
    event_index: i64,
    tool_name: Option<&str>,
    content: &str,
) -> SearchContentRow {
    SearchContentRow {
        session_id: session_id.to_string(),
        content_type,
        turn_number: Some(0),
        event_index,
        timestamp_unix: Some(1_700_000_000 + event_index),
        tool_name: tool_name.map(str::to_string),
        content: content.to_string(),
        metadata_json: None,
    }
}

/// One Copilot and one Claude Code session in the same index, both matching
/// "deploy", each with its own repository and tool.
fn mixed_index() -> (tempfile::TempDir, IndexDb) {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    for (id, repo) in [(COPILOT, "org/copilot"), (CLAUDE, "org/claude")] {
        let dir = write_session(tmp.path(), id, "Deploy", repo, "main", "u", "a");
        db.upsert_session(&dir).unwrap();
    }
    let rows = vec![
        (
            SessionId::from_validated(COPILOT),
            vec![
                row(COPILOT, "user_message", 0, None, "deploy the copilot build"),
                row(COPILOT, "assistant_message", 1, None, "deploy started"),
                row(COPILOT, "tool_call", 2, Some("powershell"), "deploy script"),
            ],
        ),
        (
            SessionId::from_validated(CLAUDE),
            vec![
                row(CLAUDE, "user_message", 0, None, "deploy the claude build"),
                row(CLAUDE, "tool_call", 1, Some("Bash"), "deploy script"),
            ],
        ),
    ];
    db.bulk_write_search_content(&rows).unwrap();
    // Relabel after writing: the Copilot write path refuses a Claude session.
    db.conn
        .execute(
            "UPDATE sessions SET source = ?1 WHERE id = ?2",
            [SessionSource::ClaudeCode.as_str(), CLAUDE],
        )
        .unwrap();
    (tmp, db)
}

fn filters(source: Option<SessionSource>) -> SearchFilters {
    SearchFilters {
        source,
        ..Default::default()
    }
}

fn result_sessions(db: &IndexDb, query: Option<&str>, f: &SearchFilters) -> Vec<String> {
    let mut ids: Vec<String> = db
        .query_content(query, f)
        .unwrap()
        .into_iter()
        .map(|r| r.session_id)
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

#[test]
fn source_filter_limits_results_and_counts_in_fts_and_browse_modes() {
    let (_tmp, db) = mixed_index();
    for query in [Some("deploy"), None] {
        let all = filters(None);
        assert_eq!(result_sessions(&db, query, &all), [COPILOT, CLAUDE]);
        assert_eq!(db.query_count(query, &all).unwrap(), 5);

        let copilot = filters(Some(SessionSource::Copilot));
        assert_eq!(result_sessions(&db, query, &copilot), [COPILOT]);
        assert_eq!(db.query_count(query, &copilot).unwrap(), 3);

        let claude = filters(Some(SessionSource::ClaudeCode));
        assert_eq!(result_sessions(&db, query, &claude), [CLAUDE]);
        assert_eq!(db.query_count(query, &claude).unwrap(), 2);
    }
}

#[test]
fn source_filter_composes_with_other_filters() {
    let (_tmp, db) = mixed_index();
    let f = SearchFilters {
        source: Some(SessionSource::ClaudeCode),
        content_types: vec!["tool_call".to_string()],
        ..Default::default()
    };
    let results = db.query_content(Some("deploy"), &f).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].session_id, CLAUDE);
    assert_eq!(results[0].tool_name.as_deref(), Some("Bash"));

    let wrong_repo = SearchFilters {
        source: Some(SessionSource::ClaudeCode),
        repositories: vec!["org/copilot".to_string()],
        ..Default::default()
    };
    assert_eq!(db.query_count(Some("deploy"), &wrong_repo).unwrap(), 0);
}

#[test]
fn facets_respect_the_source_filter() {
    let (_tmp, db) = mixed_index();
    for query in [Some("deploy"), None] {
        let all = db.facets(query, &filters(None)).unwrap();
        assert_eq!((all.total_matches, all.session_count), (5, 2));
        assert_eq!(all.by_repository.len(), 2);
        assert_eq!(all.by_tool_name.len(), 2);

        let copilot = db
            .facets(query, &filters(Some(SessionSource::Copilot)))
            .unwrap();
        assert_eq!((copilot.total_matches, copilot.session_count), (3, 1));
        assert_eq!(copilot.by_repository, [("org/copilot".to_string(), 3)]);
        assert_eq!(copilot.by_tool_name, [("powershell".to_string(), 1)]);
        let mut types = copilot.by_content_type.clone();
        types.sort();
        assert_eq!(
            types,
            [
                ("assistant_message".to_string(), 1),
                ("tool_call".to_string(), 1),
                ("user_message".to_string(), 1),
            ]
        );

        let claude = db
            .facets(query, &filters(Some(SessionSource::ClaudeCode)))
            .unwrap();
        assert_eq!((claude.total_matches, claude.session_count), (2, 1));
        assert_eq!(claude.by_repository, [("org/claude".to_string(), 2)]);
        assert_eq!(claude.by_tool_name, [("Bash".to_string(), 1)]);
    }
}
