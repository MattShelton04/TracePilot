use super::*;
use rusqlite::Connection;

/// Helper: create a temporary SQLite database and return its path.
fn create_test_db(dir: &tempfile::TempDir) -> std::path::PathBuf {
    let db_path = dir.path().join("session.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE todos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT,
            updated_at TEXT
        );
        INSERT INTO todos (id, title, description, status) VALUES ('t1', 'Fix bug', 'Fix the login bug', 'done');
        INSERT INTO todos (id, title, status) VALUES ('t2', 'Add tests', 'pending');

        CREATE TABLE todo_deps (todo_id TEXT, depends_on TEXT, PRIMARY KEY (todo_id, depends_on));
        INSERT INTO todo_deps VALUES ('t2', 't1');
        ",
    )
    .unwrap();
    db_path
}

#[test]
fn test_read_todos_from_db() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let todos = read_todos(&db_path).unwrap();
    assert_eq!(todos.len(), 2);
    assert_eq!(todos[0].id, "t1");
    assert_eq!(todos[0].title, "Fix bug");
    assert_eq!(todos[0].status, "done");
    assert_eq!(todos[0].description.as_deref(), Some("Fix the login bug"));
    assert_eq!(todos[1].id, "t2");
    assert_eq!(todos[1].status, "pending");
}

#[test]
fn test_list_tables() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let tables = list_tables(&db_path).unwrap();
    assert!(tables.contains(&"todos".to_string()));
    assert!(tables.contains(&"todo_deps".to_string()));
}

#[test]
fn test_read_custom_table() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("custom.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE metrics (
            name TEXT,
            value REAL,
            count INTEGER
        );
        INSERT INTO metrics VALUES ('latency', 42.5, 100);
        INSERT INTO metrics VALUES ('throughput', 1000.0, 50);
        INSERT INTO metrics VALUES ('nullcheck', NULL, NULL);
        ",
    )
    .unwrap();
    drop(conn);

    let info = read_custom_table(&db_path, "metrics").unwrap();
    assert_eq!(info.name, "metrics");
    assert_eq!(info.columns, vec!["name", "value", "count"]);
    assert_eq!(info.rows.len(), 3);

    // Rows are ordered vecs aligned to columns: [name, value, count]
    assert_eq!(
        info.rows[0][0],
        serde_json::Value::String("latency".to_string())
    );
    assert_eq!(info.rows[0][2], serde_json::json!(100));

    // Check real value
    let val = info.rows[0][1].as_f64().unwrap();
    assert!((val - 42.5).abs() < f64::EPSILON);

    // Null row
    assert_eq!(info.rows[2][1], serde_json::Value::Null);
    assert_eq!(info.rows[2][2], serde_json::Value::Null);
}

#[test]
fn bounded_custom_table_limits_rows_columns_and_text_before_returning() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("bounded.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE large_table (a TEXT, b TEXT, c TEXT);
         INSERT INTO large_table VALUES ('abcdefghij', 'klmnopqrst', 'uvwxyz');
         INSERT INTO large_table VALUES ('second', 'row', 'ignored');",
    )
    .unwrap();
    drop(conn);

    let info = read_custom_table_bounded(&db_path, "large_table", 1, 2, 6, 8).unwrap();
    assert_eq!(info.columns, vec!["a", "b"]);
    assert_eq!(info.rows.len(), 1);
    assert_eq!(info.rows[0][0], serde_json::json!("abcdef"));
    assert_eq!(info.rows[0][1], serde_json::json!("kl"));
}

#[test]
fn test_missing_table() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("empty.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("CREATE TABLE other (x TEXT);").unwrap();
    drop(conn);

    // read_todos: no todos table → empty vec
    let todos = read_todos(&db_path).unwrap();
    assert!(todos.is_empty());

    // read_custom_table: nonexistent table → empty CustomTableInfo
    let info = read_custom_table(&db_path, "nonexistent").unwrap();
    assert!(info.columns.is_empty());
    assert!(info.rows.is_empty());
}

#[test]
fn test_read_custom_table_includes_schema_and_indexes() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("schema.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE items (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            qty REAL DEFAULT 1.0
        );
        CREATE UNIQUE INDEX idx_items_name ON items(name);
        CREATE INDEX idx_items_qty ON items(qty);
        ",
    )
    .unwrap();
    drop(conn);

    let info = read_custom_table(&db_path, "items").unwrap();
    assert_eq!(info.column_info.len(), 3);
    let id_col = info.column_info.iter().find(|c| c.name == "id").unwrap();
    assert_eq!(id_col.pk, 1);
    assert_eq!(id_col.type_name, "INTEGER");
    let name_col = info.column_info.iter().find(|c| c.name == "name").unwrap();
    assert!(name_col.notnull);
    assert_eq!(name_col.pk, 0);
    let qty_col = info.column_info.iter().find(|c| c.name == "qty").unwrap();
    assert_eq!(qty_col.default_value.as_deref(), Some("1.0"));
    assert!(!qty_col.notnull);

    let unique_idx = info
        .indexes
        .iter()
        .find(|i| i.name == "idx_items_name")
        .unwrap();
    assert!(unique_idx.unique);
    assert_eq!(unique_idx.columns, vec!["name".to_string()]);
    let non_unique = info
        .indexes
        .iter()
        .find(|i| i.name == "idx_items_qty")
        .unwrap();
    assert!(!non_unique.unique);
}

#[test]
fn test_missing_db_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("nonexistent.db");

    // All functions should return empty results for a missing DB file
    let todos = read_todos(&db_path).unwrap();
    assert!(todos.is_empty());

    let deps = read_todo_deps(&db_path).unwrap();
    assert!(deps.is_empty());

    let tables = list_tables(&db_path).unwrap();
    assert!(tables.is_empty());

    let info = read_custom_table(&db_path, "test").unwrap();
    assert_eq!(info.name, "test");
    assert!(info.columns.is_empty());
    assert!(info.rows.is_empty());
}
