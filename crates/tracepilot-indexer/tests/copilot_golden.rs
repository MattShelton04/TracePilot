// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Copilot regression gate for the provider seam: every index row and the
//! analytics, session-list and search DTOs after a full reindex of the
//! synthetic corpus in `tracepilot_test_support::copilot_corpus`.
//!
//! FTS5 tables (virtual and shadow) are skipped; `sessions` and
//! `search_content` hold the indexed text itself.
//!
//! Normalized volatile values (nothing else is touched):
//! - The temporary session-root prefix in any string becomes `<sessions>`, and
//!   path separators after it become `/`.
//! - `sessions.indexed_at`, `sessions.search_indexed_at`,
//!   `schema_version.applied_at`, `maintenance_state.value`: wall-clock times.
//! - `sessions.workspace_mtime`, `sessions.events_mtime`: file mtimes of the
//!   temporary fixture files.
//! - `modified` inside `sessions.source_fingerprint` and
//!   `sessions.search_source_fingerprint`: the same file mtimes.
//! - `search_content.id`: an autoincrement surrogate whose order follows the
//!   parallel write order. Rows are compared by content instead.
//! - JSON text columns (`*_json`, fingerprints) are parsed and their keys
//!   sorted, because some are serialized from a `HashMap`.
//!
//! Schema added after the snapshot was captured (migration 22's session
//! source columns and its `schema_version` row) is left out of the dump and
//! asserted directly instead, so the snapshot still proves every pre-existing
//! value is unchanged.
//!
//! Regenerate after an intentional change with `TRACEPILOT_UPDATE_GOLDEN=1`.

use std::path::{Path, PathBuf};

use rusqlite::types::ValueRef;
use serde_json::{Map, Value, json};
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_indexer::{SearchFilters, reindex_all, reindex_search_content};
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;
use tracepilot_test_support::golden::assert_golden;

const WALL_CLOCK_COLUMNS: &[(&str, &str)] = &[
    ("sessions", "indexed_at"),
    ("sessions", "search_indexed_at"),
    ("sessions", "workspace_mtime"),
    ("sessions", "events_mtime"),
    ("schema_version", "applied_at"),
    ("maintenance_state", "value"),
    ("search_content", "id"),
];
const FINGERPRINT_COLUMNS: &[&str] = &["source_fingerprint", "search_source_fingerprint"];
/// The last schema version the snapshot covers.
const GOLDEN_SCHEMA_VERSION: i64 = 21;
/// `sessions` columns added after [`GOLDEN_SCHEMA_VERSION`], with the value
/// every Copilot row must hold.
fn post_golden_session_columns() -> [(&'static str, Value); 5] {
    [
        ("source", json!("copilot")),
        ("parent_session_id", Value::Null),
        ("role", json!("primary")),
        ("hidden", json!(0)),
        ("source_format_version", Value::Null),
    ]
}

fn golden_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/copilot-index.json")
}

fn strip_root(text: &str, root: &Path) -> String {
    let root = root.to_string_lossy();
    let stripped = text
        .replace(root.as_ref(), "<sessions>")
        .replace(&root.replace('\\', "/"), "<sessions>");
    if stripped.starts_with("<sessions>") {
        stripped.replace('\\', "/")
    } else {
        stripped
    }
}

fn normalize_mtimes(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if key == "modified" {
                    *child = json!("<mtime>");
                } else {
                    normalize_mtimes(child);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(normalize_mtimes),
        _ => {}
    }
}

fn cell(table: &str, column: &str, value: ValueRef<'_>, root: &Path) -> Value {
    let value = match value {
        ValueRef::Null => return Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Blob(b) => json!(format!("<blob {} bytes>", b.len())),
        ValueRef::Text(t) => json!(strip_root(&String::from_utf8_lossy(t), root)),
    };
    if WALL_CLOCK_COLUMNS.contains(&(table, column)) {
        return json!("<wall-clock>");
    }
    if (FINGERPRINT_COLUMNS.contains(&column) || column.ends_with("_json"))
        && let Some(text) = value.as_str()
    {
        let mut parsed: Value = serde_json::from_str(text).unwrap();
        normalize_mtimes(&mut parsed);
        return json!({ "json": parsed });
    }
    value
}

/// Every row of every ordinary table, ordered by content.
fn dump_tables(db_path: &Path, root: &Path) -> Value {
    let conn = rusqlite::Connection::open(db_path).unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table'
             AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name",
        )
        .unwrap();
    let tables: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let mut dump = Map::new();
    for table in tables {
        let mut stmt = conn.prepare(&format!("SELECT * FROM \"{table}\"")).unwrap();
        let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
        let post_golden = post_golden_session_columns();
        let mut rows: Vec<Value> = stmt
            .query_map([], |row| {
                let mut object = Map::new();
                for (i, column) in columns.iter().enumerate() {
                    let value = cell(&table, column, row.get_ref(i)?, root);
                    if table == "sessions"
                        && let Some((_, expected)) =
                            post_golden.iter().find(|(name, _)| name == column)
                    {
                        assert_eq!(&value, expected, "sessions.{column}");
                        continue;
                    }
                    object.insert(column.clone(), value);
                }
                Ok(Value::Object(object))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        if table == "sessions" {
            for (name, _) in &post_golden {
                assert!(columns.iter().any(|c| c == name), "missing sessions.{name}");
            }
        }
        if table == "schema_version" {
            let newest = rows.iter().filter_map(|r| r["version"].as_i64()).max();
            assert_eq!(newest, Some(22));
            rows.retain(|r| r["version"].as_i64() <= Some(GOLDEN_SCHEMA_VERSION));
        }
        rows.sort_by_key(|row| row.to_string());
        dump.insert(table, Value::Array(rows));
    }
    Value::Object(dump)
}

/// Search hits without the surrogate row id (see the module docs).
fn search_hits(results: Vec<tracepilot_indexer::SearchResult>) -> Value {
    results
        .into_iter()
        .map(|r| {
            json!({
                "sessionId": r.session_id,
                "contentType": r.content_type,
                "turnNumber": r.turn_number,
                "eventIndex": r.event_index,
                "timestampUnix": r.timestamp_unix,
                "toolName": r.tool_name,
                "snippet": r.snippet,
                "metadataJson": r.metadata_json,
                "sessionSummary": r.session_summary,
                "sessionRepository": r.session_repository,
                "sessionBranch": r.session_branch,
                "sessionUpdatedAt": r.session_updated_at,
            })
        })
        .collect()
}

#[test]
fn copilot_corpus_index_matches_golden_snapshot() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("session-state");
    let db_path = temp.path().join("index").join("index.db");
    write_copilot_corpus(&root);

    let indexed = reindex_all(&root, &db_path).unwrap();
    let (searched, _) = reindex_search_content(&root, &db_path, |_| {}, || false).unwrap();

    let db = IndexDb::open_readonly(&db_path).unwrap();
    let filters = SearchFilters::default();
    let dtos = json!({
        "analytics": db.query_analytics(None, None, None, false).unwrap(),
        "toolAnalysis": db.query_tool_analysis(None, None, None, false).unwrap(),
        "codeImpact": db.query_code_impact(None, None, None, false).unwrap(),
        "agentUsage": db.query_agent_usage_summary(None, None, None).unwrap(),
        "skillUsage": db.query_skill_usage_summary(None, None, None).unwrap(),
        "observedCacheTtls": db.query_observed_cache_ttls().unwrap(),
        "sessionListOrder": db
            .list_sessions(None, None, None, false)
            .unwrap()
            .into_iter()
            .map(|s| s.id)
            .collect::<Vec<_>>(),
        "searchStats": format!("{:?}", db.search_stats().unwrap()),
        "searchFacets": format!("{:?}", db.facets(None, &filters).unwrap()),
        "searchHello": search_hits(db.query_content(Some("hello"), &filters).unwrap()),
    });

    assert_golden(
        &golden_path(),
        json!({
            "indexedSessions": indexed,
            "searchIndexedSessions": searched,
            "tables": dump_tables(&db_path, &root),
            "dtos": dtos,
        }),
    );
}
