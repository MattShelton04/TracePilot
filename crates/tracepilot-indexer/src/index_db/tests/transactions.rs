//! `IndexDb::with_transaction` commit, rollback and panic guarantees.

use std::panic::{AssertUnwindSafe, catch_unwind};

use crate::error::IndexerError;
use crate::index_db::IndexDb;

fn open_with_scratch_table(dir: &tempfile::TempDir) -> IndexDb {
    let db = IndexDb::open_or_create(&dir.path().join("index.db")).unwrap();
    db.conn
        .execute_batch("CREATE TABLE tx_probe (value TEXT NOT NULL)")
        .unwrap();
    db
}

fn insert(db: &IndexDb, value: &str) -> crate::Result<()> {
    db.conn
        .execute("INSERT INTO tx_probe (value) VALUES (?1)", [value])?;
    Ok(())
}

fn values(db: &IndexDb) -> Vec<String> {
    let mut stmt = db
        .conn
        .prepare("SELECT value FROM tx_probe ORDER BY rowid")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

#[test]
fn ok_commits_the_closure_writes() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_with_scratch_table(&dir);

    let result = db.with_transaction(|db| {
        insert(db, "committed")?;
        Ok(7)
    });

    assert_eq!(result.unwrap(), 7);
    assert!(db.conn.is_autocommit());
    assert_eq!(values(&db), ["committed"]);
}

#[test]
fn err_rolls_back_and_returns_the_closure_error() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_with_scratch_table(&dir);

    let result: crate::Result<()> = db.with_transaction(|db| {
        insert(db, "discarded")?;
        Err(IndexerError::StaleSource {
            name: "synthetic".into(),
        })
    });

    assert!(matches!(result, Err(IndexerError::StaleSource { .. })));
    assert!(db.conn.is_autocommit());
    assert!(values(&db).is_empty());
}

#[test]
fn panic_in_closure_rolls_back_and_leaves_connection_usable() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_with_scratch_table(&dir);

    let outcome = catch_unwind(AssertUnwindSafe(|| {
        db.with_transaction(|db| -> crate::Result<()> {
            insert(db, "from-panicking-closure")?;
            panic!("synthetic panic inside with_transaction");
        })
    }));
    assert!(outcome.is_err(), "the closure's panic should propagate");

    assert!(
        db.conn.is_autocommit(),
        "a panic must not leave the connection inside a transaction"
    );
    db.with_transaction(|db| insert(db, "after-panic"))
        .expect("the next transaction starts cleanly");
    assert_eq!(values(&db), ["after-panic"]);
}

#[test]
fn failed_commit_returns_its_error_and_rolls_back() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_with_scratch_table(&dir);
    // A deferred foreign key is checked at COMMIT, so the commit itself fails.
    db.conn
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE tx_parent (id INTEGER PRIMARY KEY);
             CREATE TABLE tx_child (
                 parent_id INTEGER REFERENCES tx_parent (id)
                     DEFERRABLE INITIALLY DEFERRED
             );",
        )
        .unwrap();

    let result = db.with_transaction(|db| {
        insert(db, "discarded")?;
        db.conn
            .execute("INSERT INTO tx_child (parent_id) VALUES (42)", [])?;
        Ok(())
    });

    assert!(matches!(result, Err(IndexerError::Database(_))));
    assert!(db.conn.is_autocommit(), "a failed COMMIT is rolled back");
    assert!(values(&db).is_empty());
}

#[test]
fn nesting_inside_an_open_transaction_fails_without_ending_it() {
    let dir = tempfile::tempdir().unwrap();
    let db = open_with_scratch_table(&dir);

    db.conn.execute_batch("BEGIN").unwrap();
    insert(&db, "outer").unwrap();

    let mut ran = false;
    let result = db.with_transaction(|_| {
        ran = true;
        Ok(())
    });

    assert!(matches!(result, Err(IndexerError::Database(_))));
    assert!(!ran, "the closure must not run when BEGIN fails");
    assert!(!db.conn.is_autocommit(), "the outer transaction stays open");
    db.conn.execute_batch("COMMIT").unwrap();
    assert_eq!(values(&db), ["outer"]);
}
