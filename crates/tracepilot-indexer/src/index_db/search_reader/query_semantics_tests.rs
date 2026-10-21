//! What a typed query matches against a real FTS index: lowercase operator
//! words are plain terms, normal words that start with "near" survive, a
//! leading NOT never searches for the term it negates, and a query with no
//! searchable terms matches nothing instead of browsing the whole index.
//! Words joined by punctuation (`index.ts`, `build-std`) stay adjacent, and
//! an operator word with a prefix star (`OR*`) is a prefix search.

use super::SearchFilters;
use crate::index_db::IndexDb;
use crate::index_db::search_writer::SearchContentRow;
use tracepilot_core::SessionId;

const SESSION: &str = "00000000-0000-4000-8000-0000000000a1";

const ROWS: [&str; 10] = [
    "The cache tier was not recorded",
    "command not found",
    "the file was found",
    "jwt token expired",
    "the nearby replica answered",
    "Edited src/index.ts to export the store",
    "The ts compiler rebuilt the search index",
    "Run cargo build-std with the nightly toolchain",
    "build the std library docs",
    "Order the android notebook",
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

#[test]
fn punctuation_joined_words_stay_adjacent() {
    let (_tmp, db) = fixture();
    let all = SearchFilters::default();
    for (query, expected) in [
        ("index.ts", vec![5]),
        ("src/index.ts", vec![5]),
        ("build-std", vec![7]),
        ("cargo build-std", vec![7]),
        // A trailing * still makes the last word a prefix.
        ("index.t*", vec![5]),
        ("build-st*", vec![7]),
    ] {
        assert_eq!(matches(&db, query), expected, "{query:?}");
        let facets = db.facets(Some(query), &all).unwrap();
        assert_eq!(facets.total_matches, 1, "facets for {query:?}");
    }
    // Words separated by spaces still match anywhere in the row.
    assert_eq!(matches(&db, "index ts"), vec![5, 6]);
    assert_eq!(matches(&db, "build std"), vec![7, 8]);
}

#[test]
fn operators_wrapped_in_punctuation_still_apply() {
    let (_tmp, db) = fixture();
    let all = SearchFilters::default();
    for (query, expected) in [
        ("cache AND (NOT found)", vec![0]),
        ("(cache OR found) AND (NOT jwt)", vec![0, 1, 2]),
        ("error OR (NOT timeout)", vec![]),
        ("(OR jwt)", vec![3]),
        ("(AND) cache", vec![0]),
        ("[OR] cache", vec![0]),
        ("-NOT cache", vec![]),
        (".NOT cache", vec![]),
    ] {
        // `matches` fails on an FTS5 syntax error from the search or count.
        assert_eq!(matches(&db, query), expected, "{query:?}");
        let facets = db.facets(Some(query), &all).unwrap();
        assert_eq!(facets.total_matches, expected.len() as i64, "{query:?}");
    }
}

#[test]
fn operator_words_with_a_prefix_star_search_as_prefixes() {
    let (_tmp, db) = fixture();
    let all = SearchFilters::default();
    for (query, expected) in [
        ("OR*", vec![9]),
        ("AND*", vec![9]),
        ("NOT*", vec![0, 1, 9]),
        ("NOT* found", vec![1]),
        ("cache tier AND*", vec![]),
        ("jwt OR OR*", vec![3, 9]),
        ("NEAR*", vec![4]),
    ] {
        // `matches` fails on an FTS5 syntax error from the search or count.
        assert_eq!(matches(&db, query), expected, "{query:?}");
        let facets = db.facets(Some(query), &all).unwrap();
        assert_eq!(facets.total_matches, expected.len() as i64, "{query:?}");
    }
}
