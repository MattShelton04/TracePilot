//! Keeps `docs/database/schema.md` in step with the migrated schema.

use std::collections::{BTreeMap, BTreeSet};

use crate::index_db::IndexDb;

const SCHEMA_DOC: &str = include_str!("../../../../../docs/database/schema.md");

type Columns = BTreeMap<String, BTreeSet<String>>;

/// Tables and their columns from a freshly migrated database. FTS5 shadow
/// tables belong to SQLite and are left out.
fn migrated_columns() -> Columns {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let tables: Vec<(String, String)> = db
        .conn
        .prepare(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    let virtual_tables: Vec<&str> = tables
        .iter()
        .filter(|(_, sql)| sql.starts_with("CREATE VIRTUAL TABLE"))
        .map(|(name, _)| name.as_str())
        .collect();
    tables
        .iter()
        .map(|(name, _)| name)
        .filter(|name| {
            !virtual_tables
                .iter()
                .any(|vt| name.starts_with(&format!("{vt}_")))
        })
        .map(|name| {
            let columns = db
                .conn
                .prepare(&format!("SELECT name FROM pragma_table_info('{name}')"))
                .unwrap()
                .query_map([], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap();
            (name.clone(), columns)
        })
        .collect()
}

/// `### \`table\`` headings and the `| \`column\` |` rows beneath each.
fn documented_columns() -> Columns {
    let mut tables = Columns::new();
    let mut current = None;
    for line in SCHEMA_DOC.lines() {
        if let Some(rest) = line.strip_prefix("### `") {
            let name = rest.split('`').next().unwrap().to_string();
            tables.entry(name.clone()).or_default();
            current = Some(name);
        } else if line.starts_with("## ") {
            current = None;
        } else if let (Some(table), Some(rest)) = (&current, line.strip_prefix("| `")) {
            let column = rest.split('`').next().unwrap().to_string();
            tables.get_mut(table).unwrap().insert(column);
        }
    }
    tables
}

#[test]
fn schema_doc_matches_migrations() {
    let migrated = migrated_columns();
    let documented = documented_columns();
    let mut problems = Vec::new();
    for (table, columns) in &migrated {
        let Some(doc) = documented.get(table) else {
            problems.push(format!("table `{table}` is not documented"));
            continue;
        };
        for column in columns.difference(doc) {
            problems.push(format!("`{table}.{column}` is not documented"));
        }
        for column in doc.difference(columns) {
            problems.push(format!(
                "`{table}.{column}` is documented but does not exist"
            ));
        }
    }
    for table in documented.keys().filter(|t| !migrated.contains_key(*t)) {
        problems.push(format!("table `{table}` is documented but does not exist"));
    }
    assert!(
        problems.is_empty(),
        "docs/database/schema.md is out of date:\n{}",
        problems.join("\n")
    );
}
