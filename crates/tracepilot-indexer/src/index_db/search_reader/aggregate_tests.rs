//! Aggregate parity against complete result rows, including self-excluding
//! facets and the foreign-key invariant that permits omitting session joins.

use std::collections::BTreeMap;

use super::query_builder::SearchQueryBuilder;
use super::{SearchFilters, SearchResult};
use crate::index_db::IndexDb;
use crate::index_db::search_writer::SearchContentRow;
use tracepilot_core::SessionId;
use tracepilot_core::provider::SessionSource;

fn fixture() -> (tempfile::TempDir, IndexDb) {
    let temp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    for session in 0..4 {
        let id = format!("00000000-0000-4000-8000-{session:012x}");
        db.conn
            .execute(
                "INSERT INTO sessions(id, path, repository) VALUES (?1, 'synthetic', ?2)",
                rusqlite::params![id, (session != 3).then(|| format!("repo{}", session % 2))],
            )
            .unwrap();
        let rows = (0..24)
            .map(|index| SearchContentRow {
                session_id: id.clone(),
                content_type: [
                    "user_message",
                    "assistant_message",
                    "tool_call",
                    "tool_result",
                ][index % 4],
                turn_number: Some((index / 4) as i64),
                event_index: index as i64,
                timestamp_unix: (index != 0).then_some(100 + index as i64),
                tool_name: (index % 4 >= 2)
                    .then(|| ["read_file", "edit_file"][session % 2].to_string()),
                content: format!(
                    "benchmark {}",
                    if index % 5 == 0 { "needle" } else { "ordinary" }
                ),
                metadata_json: None,
            })
            .collect();
        db.bulk_write_search_content(&[(SessionId::from_validated(id.clone()), rows)])
            .unwrap();
        if session % 2 == 1 {
            db.conn
                .execute(
                    "UPDATE sessions SET source = 'claudeCode' WHERE id = ?1",
                    [id],
                )
                .unwrap();
        }
    }
    (temp, db)
}

fn counts(
    results: &[SearchResult],
    field: impl Fn(&SearchResult) -> Option<&str>,
) -> Vec<(String, i64)> {
    let mut counts = BTreeMap::new();
    for value in results.iter().filter_map(field) {
        *counts.entry(value.to_owned()).or_insert(0) += 1;
    }
    counts.into_iter().collect()
}

fn sorted(mut values: Vec<(String, i64)>) -> Vec<(String, i64)> {
    values.sort();
    values
}

fn assert_parity(db: &IndexDb, query: Option<&str>, filters: &SearchFilters) {
    // This path must retain the session join to populate its result metadata.
    let results = db.query_content(query, filters).unwrap();
    assert_eq!(
        db.query_count(query, filters).unwrap(),
        results.len() as i64
    );
    let facets = db.facets(query, filters).unwrap();
    assert_eq!(facets.total_matches, results.len() as i64);
    assert_eq!(
        facets.session_count,
        counts(&results, |r| Some(&r.session_id)).len() as i64
    );

    let mut excluding = filters.clone();
    excluding.content_types.clear();
    let rows = db.query_content(query, &excluding).unwrap();
    assert_eq!(
        sorted(facets.by_content_type),
        counts(&rows, |r| Some(&r.content_type))
    );

    let mut excluding = filters.clone();
    excluding.repositories.clear();
    let rows = db.query_content(query, &excluding).unwrap();
    assert_eq!(
        sorted(facets.by_repository),
        counts(&rows, |r| r.session_repository.as_deref())
    );

    let mut excluding = filters.clone();
    excluding.tool_names.clear();
    let rows = db.query_content(query, &excluding).unwrap();
    assert_eq!(
        sorted(facets.by_tool_name),
        counts(&rows, |r| r.tool_name.as_deref())
    );
}

#[test]
fn aggregates_match_result_rows_for_every_filter_combination() {
    let (_temp, db) = fixture();
    // Every combination exercises joins needed by either/both session filters,
    // and content-only queries with includes, exclusions, session and dates.
    for mask in 0..256 {
        let filters = SearchFilters {
            source: (mask & 1 != 0).then_some(SessionSource::ClaudeCode),
            repositories: if mask & 2 != 0 {
                vec!["repo1".into()]
            } else {
                vec![]
            },
            content_types: if mask & 4 != 0 {
                vec!["tool_call".into(), "tool_result".into()]
            } else {
                vec![]
            },
            exclude_content_types: if mask & 8 != 0 {
                vec!["tool_result".into()]
            } else {
                vec![]
            },
            tool_names: if mask & 16 != 0 {
                vec!["edit_file".into()]
            } else {
                vec![]
            },
            session_id: (mask & 32 != 0).then(|| "00000000-0000-4000-8000-000000000001".into()),
            date_from_unix: (mask & 64 != 0).then_some(105),
            date_to_unix: (mask & 128 != 0).then_some(118),
            limit: Some(200),
            ..Default::default()
        };
        for query in [
            None,
            Some("benchmark"),
            Some("needle"),
            Some("absent"),
            Some(" OR "),
        ] {
            assert_parity(&db, query, &filters);
        }
    }
}

#[test]
fn aggregates_stay_consistent_after_source_purge_and_reject_orphans() {
    let (_temp, db) = fixture();
    assert!(db.conn.execute(
        "INSERT INTO search_content(session_id, content_type, content) VALUES ('missing', 'user_message', 'benchmark')", []
    ).is_err());
    assert_eq!(
        db.purge_source(SessionSource::ClaudeCode, &|| true)
            .unwrap(),
        2
    );
    let filters = SearchFilters {
        limit: Some(200),
        ..Default::default()
    };
    for query in [None, Some("benchmark"), Some("needle")] {
        assert_parity(&db, query, &filters);
    }
    assert_eq!(db.query_count(None, &filters).unwrap(), 48);
    assert_eq!(db.fts_integrity_check().unwrap(), "ok");
}

#[test]
fn tied_tool_facets_keep_the_legacy_top_twenty() {
    let (_temp, db) = fixture();
    for session in 0..4 {
        for tool in 0..32 {
            db.conn
                .execute(
                    "INSERT INTO search_content(session_id, content_type, tool_name, content)
                 VALUES (?1, 'tool_call', ?2, 'benchmark ties')",
                    rusqlite::params![
                        format!("00000000-0000-4000-8000-{session:012x}"),
                        format!("tool-{tool:02}")
                    ],
                )
                .unwrap();
        }
    }
    for filters in [
        SearchFilters::default(),
        SearchFilters {
            source: Some(SessionSource::Copilot),
            ..Default::default()
        },
        SearchFilters {
            repositories: vec!["repo1".into()],
            ..Default::default()
        },
    ] {
        for query in [None, Some("benchmark"), Some("ties")] {
            // Keep the pre-optimization joined GROUP BY/LIMIT as an oracle:
            // compare order as well as membership where the last place ties.
            let (sql, params) =
                SearchQueryBuilder::new("SELECT sc.tool_name, COUNT(*)", query.is_some())
                    .with_optional_fts_match(query)
                    .with_extra_where("sc.tool_name IS NOT NULL")
                    .with_filters(&filters)
                    .with_group_by("sc.tool_name", Some("ORDER BY COUNT(*) DESC"))
                    .with_limit(20)
                    .build();
            let legacy = db
                .conn
                .prepare(&sql)
                .unwrap()
                .query_map(
                    rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            assert_eq!(legacy.len(), 20);
            assert_eq!(db.facets(query, &filters).unwrap().by_tool_name, legacy);
        }
    }
}

#[test]
fn content_aggregates_use_covering_indexes_without_session_lookups() {
    let (_temp, db) = fixture();
    for is_fts in [false, true] {
        let (sql, params) =
            SearchQueryBuilder::content_aggregate("SELECT sc.content_type, COUNT(*)", is_fts)
                .with_optional_fts_match(is_fts.then_some("benchmark"))
                .with_filters(&SearchFilters::default())
                .with_group_by("sc.content_type", None)
                .build();
        let mut stmt = db
            .conn
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap();
        let plan = stmt
            .query_map(
                rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
                |row| row.get::<_, String>(3),
            )
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
            .join("\n");
        assert!(!sql.contains("JOIN sessions"), "{sql}");
        assert!(!plan.contains("SEARCH s "), "{plan}");
        if !is_fts {
            assert!(
                plan.contains("COVERING INDEX idx_search_content_type_ts"),
                "{plan}"
            );
        }
    }
    for filters in [
        SearchFilters {
            source: Some(SessionSource::Copilot),
            ..Default::default()
        },
        SearchFilters {
            repositories: vec!["repo1".into()],
            ..Default::default()
        },
    ] {
        let (sql, _) = SearchQueryBuilder::content_aggregate("SELECT COUNT(*)", false)
            .with_filters(&filters)
            .build();
        assert!(sql.contains("JOIN sessions s"), "{sql}");
    }
}
