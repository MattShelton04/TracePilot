//! What a typed query matches against a real FTS index: lowercase operator
//! words are plain terms, normal words that start with "near" survive, a
//! leading NOT never searches for the term it negates, and a query with no
//! searchable terms matches nothing instead of browsing the whole index.

use super::SearchFilters;
use crate::index_db::IndexDb;
use crate::index_db::search_writer::SearchContentRow;
use tracepilot_core::SessionId;

const SESSION: &str = "00000000-0000-4000-8000-0000000000a1";

const ROWS: [&str; 5] = [
    "The cache tier was not recorded",
    "command not found",
    "the file was found",
    "jwt token expired",
    "the nearby replica answered",
];

fn fixture() -> (tempfile::TempDir, IndexDb) {
    let temp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.conn
        .execute(
            "INSERT INTO sessions(id, path, repository) VALUES (?1, 'synthetic', 'repo')",
            [SESSION],
        )
        .unwrap();
    let rows = ROWS
        .iter()
        .enumerate()
        .map(|(index, content)| SearchContentRow {
            session_id: SESSION.to_string(),
            content_type: "assistant_message",
            turn_number: Some(0),
            event_index: index as i64,
            timestamp_unix: Some(100 + index as i64),
            tool_name: None,
            content: (*content).to_string(),
            metadata_json: None,
        })
        .collect();
    db.bulk_write_search_content(&[(SessionId::from_validated(SESSION), rows)])
        .unwrap();
    (temp, db)
}

/// The fixture rows a query matches, by their position in `ROWS`.
fn matches(db: &IndexDb, query: &str) -> Vec<i64> {
    let mut hits: Vec<i64> = db
        .query_content(Some(query), &SearchFilters::default())
        .unwrap()
        .into_iter()
        .filter_map(|r| r.event_index)
        .collect();
    hits.sort_unstable();
    assert_eq!(
        db.query_count(Some(query), &SearchFilters::default())
            .unwrap(),
        hits.len() as i64,
        "count for {query:?} disagrees with its rows"
    );
    hits
}

#[test]
fn lowercase_operator_words_are_plain_terms() {
    let (_tmp, db) = fixture();
    assert_eq!(matches(&db, "cache tier not recorded"), vec![0]);
    // "not" is a word to find, not an exclusion of "found".
    assert_eq!(matches(&db, "command not found"), vec![1]);
    assert_eq!(matches(&db, "was not found"), Vec::<i64>::new());
    assert_eq!(matches(&db, "found and expired"), Vec::<i64>::new());
}

#[test]
fn uppercase_operators_still_apply() {
    let (_tmp, db) = fixture();
    assert_eq!(matches(&db, "was NOT recorded"), vec![2]);
    assert_eq!(matches(&db, "jwt OR nearby"), vec![3, 4]);
    assert_eq!(matches(&db, "was AND NOT recorded"), vec![2]);
}

#[test]
fn words_starting_with_near_are_searchable() {
    let (_tmp, db) = fixture();
    assert_eq!(matches(&db, "nearby"), vec![4]);
    assert_eq!(matches(&db, "nearby replica"), vec![4]);
}

#[test]
fn leading_not_never_searches_for_the_negated_term() {
    let (_tmp, db) = fixture();
    assert_eq!(matches(&db, "NOT jwt"), Vec::<i64>::new());
    assert_eq!(matches(&db, "NOT jwt was"), vec![0, 2]);
}

#[test]
fn query_without_searchable_terms_matches_nothing() {
    let (_tmp, db) = fixture();
    let all = SearchFilters::default();
    for query in ["*", "((", "NOT", "!!!", "AND OR", "\"\""] {
        assert_eq!(matches(&db, query), Vec::<i64>::new(), "{query:?}");
        let facets = db.facets(Some(query), &all).unwrap();
        assert_eq!(facets.total_matches, 0, "{query:?}");
        assert!(facets.by_content_type.is_empty(), "{query:?}");
    }
    // An absent query is still browse mode over everything.
    assert_eq!(db.query_count(None, &all).unwrap(), ROWS.len() as i64);
    assert_eq!(
        db.facets(None, &all).unwrap().total_matches,
        ROWS.len() as i64
    );
}
