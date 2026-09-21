//! Integration tests for the linked-work qualifiers (`pr:`, `issue:`,
//! `commit:`) that filter search through `session_work_refs`.
//!
//! The fixtures deliberately give two repositories the same pull-request
//! number: a bare number is not repository-scoped, so a search for it has to
//! return both sessions with their own repository context rather than guessing
//! which one was meant.

use super::{SearchFilters, SearchResult};
use crate::index_db::IndexDb;

/// Sessions and searchable content. `s1` and `s2` share PR 123 across
/// repositories; `s3` mentions an unrelated pull request.
const FIXTURE: &str = "
    CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        summary TEXT,
        repository TEXT,
        branch TEXT,
        updated_at TEXT
    );
    CREATE TABLE search_content (
        id INTEGER PRIMARY KEY,
        session_id TEXT,
        content_type TEXT,
        content TEXT,
        turn_number INTEGER,
        event_index INTEGER,
        timestamp_unix INTEGER,
        tool_name TEXT,
        metadata_json TEXT
    );
    INSERT INTO sessions (id, summary, repository, branch, updated_at) VALUES
        ('s1', 'alpha work', 'org/alpha', 'main', '2026-01-01T00:00:00Z'),
        ('s2', 'beta work', 'org/beta', 'main', '2026-01-02T00:00:00Z'),
        ('s3', 'other work', 'org/alpha', 'main', '2026-01-03T00:00:00Z');
    INSERT INTO search_content
        (id, session_id, content_type, content, timestamp_unix) VALUES
        (1, 's1', 'user_message', 'review the login fix', 100),
        (2, 's2', 'user_message', 'port the login fix', 200),
        (3, 's3', 'user_message', 'unrelated chore', 300);
";

/// The reference table as migration 20 creates it, carrying only the columns
/// the search path reads.
const WORK_REFS: &str = "
    CREATE TABLE session_work_refs (
        source_id TEXT NOT NULL,
        generation TEXT NOT NULL,
        ref_identity TEXT NOT NULL,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        raw_value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        resolution TEXT NOT NULL,
        PRIMARY KEY (source_id, generation, ref_identity)
    );
    INSERT INTO session_work_refs
        (source_id, generation, ref_identity, session_id, kind, raw_value,
         normalized_value, resolution) VALUES
        ('src', 'g1', 'pr|123|s1', 's1', 'pullRequest', '#123', '123', 'sessionContext'),
        ('src', 'g1', 'issue|7|s1', 's1', 'issue', '#7', '7', 'sessionContext'),
        ('src', 'g1', 'ref|sha|s1', 's1', 'gitRef', '9F1C2AB', '9f1c2ab', 'sessionContext'),
        ('src', 'g1', 'pr|123|s2', 's2', 'pullRequest', '123', '123', 'sessionContext'),
        ('src', 'g1', 'ref|br|s2', 's2', 'gitRef', 'feature/login', 'feature/login', 'unresolved'),
        ('src', 'g1', 'pr|999|s3', 's3', 'pullRequest', '999', '999', 'sessionContext');
";

fn build_db(sql: &str) -> IndexDb {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(sql).unwrap();
    IndexDb { conn }
}

fn db_with_work_refs() -> IndexDb {
    build_db(&format!("{FIXTURE}{WORK_REFS}"))
}

fn pull_requests(values: &[&str]) -> SearchFilters {
    SearchFilters {
        pull_requests: values.iter().map(|value| value.to_string()).collect(),
        ..Default::default()
    }
}

fn session_ids(results: &[SearchResult]) -> Vec<String> {
    let mut ids: Vec<String> = results.iter().map(|r| r.session_id.clone()).collect();
    ids.sort();
    ids
}

#[test]
fn qualifier_only_search_needs_no_fts_text() {
    let db = db_with_work_refs();

    let results = db.query_content(None, &pull_requests(&["123"])).unwrap();

    assert_eq!(session_ids(&results), vec!["s1", "s2"]);
}

#[test]
fn bare_pull_request_spans_repositories_and_keeps_their_context() {
    let db = db_with_work_refs();

    let results = db.query_content(None, &pull_requests(&["123"])).unwrap();

    let mut repositories: Vec<String> = results
        .iter()
        .map(|r| r.session_repository.clone().expect("repository context"))
        .collect();
    repositories.sort();
    assert_eq!(repositories, vec!["org/alpha", "org/beta"]);
}

#[test]
fn repository_and_pull_request_qualifiers_intersect() {
    let db = db_with_work_refs();
    let filters = SearchFilters {
        repositories: vec!["org/alpha".to_string()],
        ..pull_requests(&["123"])
    };

    let results = db.query_content(None, &filters).unwrap();

    assert_eq!(session_ids(&results), vec!["s1"]);
}

#[test]
fn hash_prefixed_value_matches_the_stored_number() {
    let db = db_with_work_refs();

    let results = db.query_content(None, &pull_requests(&["#123"])).unwrap();

    assert_eq!(session_ids(&results), vec!["s1", "s2"]);
}

#[test]
fn non_numeric_pull_request_value_returns_no_results() {
    let db = db_with_work_refs();
    let filters = pull_requests(&["not-a-number"]);

    let results = db
        .query_content(None, &filters)
        .expect("a rejected value is empty, not an error");

    assert!(results.is_empty());
    assert_eq!(db.query_count(None, &filters).unwrap(), 0);
}

#[test]
fn repeated_values_of_one_kind_union() {
    let db = db_with_work_refs();

    let results = db
        .query_content(None, &pull_requests(&["123", "999"]))
        .unwrap();

    assert_eq!(session_ids(&results), vec!["s1", "s2", "s3"]);
}

#[test]
fn different_kinds_intersect() {
    let db = db_with_work_refs();
    let filters = SearchFilters {
        issues: vec!["7".to_string()],
        ..pull_requests(&["123"])
    };

    let results = db.query_content(None, &filters).unwrap();

    assert_eq!(session_ids(&results), vec!["s1"]);
}

#[test]
fn commit_qualifier_matches_shas_and_other_git_refs() {
    let db = db_with_work_refs();

    // Uppercase input against the lowercased stored value.
    let sha = SearchFilters {
        git_refs: vec!["9F1C2AB".to_string()],
        ..Default::default()
    };
    assert_eq!(
        session_ids(&db.query_content(None, &sha).unwrap()),
        vec!["s1"]
    );

    // A branch name is a Git ref too, so it stays searchable.
    let branch = SearchFilters {
        git_refs: vec!["feature/login".to_string()],
        ..Default::default()
    };
    assert_eq!(
        session_ids(&db.query_content(None, &branch).unwrap()),
        vec!["s2"]
    );
}

#[test]
fn counts_and_facets_apply_the_same_filters() {
    let db = db_with_work_refs();
    let filters = pull_requests(&["123"]);

    assert_eq!(db.query_count(None, &filters).unwrap(), 2);

    let facets = db.facets(None, &filters).unwrap();
    assert_eq!(facets.total_matches, 2);
    assert_eq!(facets.session_count, 2);
    let mut repositories: Vec<String> = facets
        .by_repository
        .iter()
        .map(|(name, _)| name.clone())
        .collect();
    repositories.sort();
    assert_eq!(repositories, vec!["org/alpha", "org/beta"]);
}

#[test]
fn facets_drop_their_own_dimension_but_keep_the_work_ref_filter() {
    let db = db_with_work_refs();
    let filters = SearchFilters {
        repositories: vec!["org/alpha".to_string()],
        ..pull_requests(&["123"])
    };

    let facets = db.facets(None, &filters).unwrap();

    // The repository dimension re-widens to every repository that mentions PR
    // 123, while `s3`, which mentions no such PR, stays out of it.
    assert_eq!(facets.by_repository.len(), 2);
    assert_eq!(facets.total_matches, 1);
}

#[test]
fn missing_work_refs_table_returns_no_results_instead_of_an_error() {
    // `open_readonly` skips migrations, so a handle opened before migration 20
    // has no reference table at all. That is an unavailable source, which the
    // caller reports separately — here it must simply not raise.
    let db = build_db(FIXTURE);
    let filters = pull_requests(&["123"]);

    assert!(db.query_content(None, &filters).unwrap().is_empty());
    assert_eq!(db.query_count(None, &filters).unwrap(), 0);
    assert_eq!(db.facets(None, &filters).unwrap().total_matches, 0);
}

#[test]
fn missing_work_refs_table_leaves_unqualified_search_untouched() {
    let db = build_db(FIXTURE);

    let results = db.query_content(None, &SearchFilters::default()).unwrap();

    assert_eq!(session_ids(&results), vec!["s1", "s2", "s3"]);
}
