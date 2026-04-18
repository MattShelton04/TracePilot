//! Integration tests for the migration framework.

use super::backup::write_backup;
use super::*;
use rusqlite::Connection;
use tempfile::TempDir;

static SIMPLE_PLAN: MigrationPlan = MigrationPlan {
    migrations: &[
        Migration {
            version: 1,
            name: "base",
            sql: "CREATE TABLE foo (id INTEGER PRIMARY KEY, v TEXT);",
            pre_hook: None,
        },
        Migration {
            version: 2,
            name: "add_col",
            sql: "ALTER TABLE foo ADD COLUMN extra TEXT;",
            pre_hook: None,
        },
        Migration {
            version: 3,
            name: "index",
            sql: "CREATE INDEX idx_foo_v ON foo(v);",
            pre_hook: None,
        },
    ],
};

#[test]
fn applies_all_on_empty_db() {
    let mut conn = Connection::open_in_memory().unwrap();
    let report = run_migrations(
        &mut conn,
        None,
        &SIMPLE_PLAN,
        &MigratorOptions {
            backup: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(report.from_version, 0);
    assert_eq!(report.to_version, 3);
    assert_eq!(report.applied, vec![1, 2, 3]);

    let v: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(v, 3);
}

#[test]
fn applies_only_pending_on_partial_db() {
    let mut conn = Connection::open_in_memory().unwrap();
    // Pre-seed schema_version to 1 AND manually run migration 1 so ALTER on v2 works.
    ensure_schema_version_table(&conn).unwrap();
    conn.execute_batch("CREATE TABLE foo (id INTEGER PRIMARY KEY, v TEXT);")
        .unwrap();
    conn.execute("INSERT INTO schema_version (version) VALUES (1)", [])
        .unwrap();

    let report = run_migrations(
        &mut conn,
        None,
        &SIMPLE_PLAN,
        &MigratorOptions {
            backup: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(report.from_version, 1);
    assert_eq!(report.applied, vec![2, 3]);
}

#[test]
fn writes_backup_per_applied_version() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("test.db");
    let mut conn = Connection::open(&db_path).unwrap();
    crate::utils::sqlite::configure_connection(&conn).unwrap();

    let report = run_migrations(
        &mut conn,
        Some(&db_path),
        &SIMPLE_PLAN,
        &MigratorOptions::default(),
    )
    .unwrap();
    assert_eq!(report.applied, vec![1, 2, 3]);

    for v in 1..=3 {
        let expected = db_path.with_file_name(format!("test.db.pre-v{}.bak", v));
        assert!(expected.exists(), "expected backup {}", expected.display());
    }
}

#[test]
fn backup_retention_keeps_last_five() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("ret.db");

    // Build a 7-migration plan to force pruning.
    static PLAN7: MigrationPlan = MigrationPlan {
        migrations: &[
            Migration {
                version: 1,
                name: "m1",
                sql: "CREATE TABLE t (x INTEGER);",
                pre_hook: None,
            },
            Migration {
                version: 2,
                name: "m2",
                sql: "CREATE TABLE t2 (x INTEGER);",
                pre_hook: None,
            },
            Migration {
                version: 3,
                name: "m3",
                sql: "CREATE TABLE t3 (x INTEGER);",
                pre_hook: None,
            },
            Migration {
                version: 4,
                name: "m4",
                sql: "CREATE TABLE t4 (x INTEGER);",
                pre_hook: None,
            },
            Migration {
                version: 5,
                name: "m5",
                sql: "CREATE TABLE t5 (x INTEGER);",
                pre_hook: None,
            },
            Migration {
                version: 6,
                name: "m6",
                sql: "CREATE TABLE t6 (x INTEGER);",
                pre_hook: None,
            },
            Migration {
                version: 7,
                name: "m7",
                sql: "CREATE TABLE t7 (x INTEGER);",
                pre_hook: None,
            },
        ],
    };

    let mut conn = Connection::open(&db_path).unwrap();
    crate::utils::sqlite::configure_connection(&conn).unwrap();
    run_migrations(
        &mut conn,
        Some(&db_path),
        &PLAN7,
        &MigratorOptions::default(),
    )
    .unwrap();

    // Only the last 5 backups should remain (pre-v3..pre-v7).
    let backups: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| n.starts_with("ret.db.pre-v") && n.ends_with(".bak"))
        .collect();
    assert_eq!(backups.len(), 5, "got {:?}", backups);
    for v in 3..=7 {
        assert!(
            backups.iter().any(|b| b.contains(&format!("pre-v{}", v))),
            "missing backup for v{} in {:?}",
            v,
            backups
        );
    }
}

#[test]
fn rollback_on_migration_failure() {
    let mut conn = Connection::open_in_memory().unwrap();

    static BAD_PLAN: MigrationPlan = MigrationPlan {
        migrations: &[
            Migration {
                version: 1,
                name: "ok",
                sql: "CREATE TABLE good (id INTEGER);",
                pre_hook: None,
            },
            Migration {
                version: 2,
                name: "bad",
                // Valid first statement, then a syntax error: the whole tx should roll back.
                sql: "CREATE TABLE partial (id INTEGER); THIS IS NOT VALID SQL;",
                pre_hook: None,
            },
        ],
    };

    let err = run_migrations(
        &mut conn,
        None,
        &BAD_PLAN,
        &MigratorOptions {
            backup: false,
            ..Default::default()
        },
    )
    .unwrap_err();
    match err {
        MigrationError::Migration { version, .. } => assert_eq!(version, 2),
        other => panic!("expected Migration error, got {:?}", other),
    }

    // v1 should have committed; v2 should not have.
    let v: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(v, 1);

    let partial_exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='partial'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(partial_exists, 0, "failed tx should have rolled back");
}

#[test]
fn backup_captures_wal_mode_data() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("wal.db");
    let conn = Connection::open(&db_path).unwrap();
    crate::utils::sqlite::configure_connection(&conn).unwrap();
    conn.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('hello-wal');")
        .unwrap();
    drop(conn);

    // Write backup while a live connection holds it open in WAL mode.
    let conn = Connection::open(&db_path).unwrap();
    crate::utils::sqlite::configure_connection(&conn).unwrap();
    let backup = dir.path().join("wal.bak");
    write_backup(&conn, &backup).unwrap();
    drop(conn);

    // Reopen the backup independently and verify it contains the row.
    let restored = Connection::open(&backup).unwrap();
    let v: String = restored
        .query_row("SELECT v FROM t LIMIT 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v, "hello-wal");
}

#[test]
fn pre_hook_runs_before_sql() {
    fn hook(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch("CREATE TABLE IF NOT EXISTS hooked (x INTEGER);")
    }
    static HOOK_PLAN: MigrationPlan = MigrationPlan {
        migrations: &[Migration {
            version: 1,
            name: "with_hook",
            sql: "INSERT INTO hooked (x) VALUES (42);",
            pre_hook: Some(hook),
        }],
    };
    let mut conn = Connection::open_in_memory().unwrap();
    run_migrations(
        &mut conn,
        None,
        &HOOK_PLAN,
        &MigratorOptions {
            backup: false,
            ..Default::default()
        },
    )
    .unwrap();
    let x: i64 = conn
        .query_row("SELECT x FROM hooked", [], |r| r.get(0))
        .unwrap();
    assert_eq!(x, 42);
}
