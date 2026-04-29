//! Tests for the `helpers` submodules. Tests reach across seams via the
//! parent module's `pub(crate)` re-exports.

use super::*;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use std::fs;
use std::sync::{Arc, Mutex, RwLock};
use tempfile::tempdir;
use tracing_subscriber::fmt::MakeWriter;

#[derive(Clone, Default)]
struct LogCapture {
    buffer: Arc<Mutex<Vec<u8>>>,
}

impl LogCapture {
    fn install(&self) -> tracing::subscriber::DefaultGuard {
        let subscriber = tracing_subscriber::fmt()
            .with_writer(self.clone())
            .with_ansi(false)
            .finish();
        tracing::subscriber::set_default(subscriber)
    }

    fn output(&self) -> String {
        let data = self.buffer.lock().unwrap();
        String::from_utf8_lossy(&data[..]).into_owned()
    }
}

impl<'a> MakeWriter<'a> for LogCapture {
    type Writer = LogWriter;

    fn make_writer(&'a self) -> Self::Writer {
        LogWriter {
            buffer: self.buffer.clone(),
        }
    }
}

struct LogWriter {
    buffer: Arc<Mutex<Vec<u8>>>,
}

impl std::io::Write for LogWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut guard = self.buffer.lock().unwrap();
        guard.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn make_shared_config(session_state_dir: &str) -> SharedConfig {
    Arc::new(RwLock::new(Some(crate::config::TracePilotConfig {
        paths: crate::config::PathsConfig {
            copilot_home: String::new(),
            tracepilot_home: String::new(),
            session_state_dir: session_state_dir.to_string(),
            index_db_path: String::new(),
        },
        ..Default::default()
    })))
}

#[test]
fn open_index_db_returns_none_for_missing_file() {
    let dir = tempdir().unwrap();
    let index_path = dir.path().join("index.db");

    let logs = LogCapture::default();
    let _guard = logs.install();

    let result = open_index_db(&index_path);
    assert!(result.is_none());
    assert!(logs.output().is_empty());
}

#[test]
fn open_index_db_logs_when_index_is_corrupt() {
    let dir = tempdir().unwrap();
    let index_path = dir.path().join("index.db");
    fs::write(&index_path, b"not a sqlite db").unwrap();

    let logs = LogCapture::default();
    let _guard = logs.install();

    let result = open_index_db(&index_path);
    assert!(result.is_none());

    let output = logs.output();
    // Corrupt files may fail at open or at first query — either log message is valid
    assert!(
        output.contains("Failed to open index database")
            || output.contains("Failed to read session count from index database"),
        "Expected a warning about corrupt index DB, got: {output}"
    );
    assert!(output.contains(index_path.to_string_lossy().as_ref()));
}

#[test]
fn open_index_db_logs_when_schema_is_missing() {
    let dir = tempdir().unwrap();
    let index_path = dir.path().join("index.db");

    // Create an empty SQLite file without the expected schema
    let _conn = rusqlite::Connection::open(&index_path).unwrap();

    let logs = LogCapture::default();
    let _guard = logs.install();

    let result = open_index_db(&index_path);
    assert!(result.is_none());

    let output = logs.output();
    assert!(output.contains("Failed to read session count"));
    assert!(output.contains(index_path.to_string_lossy().as_ref()));
}

#[test]
fn remove_index_files_deletes_existing_artifacts() {
    let dir = tempdir().unwrap();
    let index_path = dir.path().join("index.db");
    let wal = index_path.with_extension("db-wal");
    let shm = index_path.with_extension("db-shm");

    fs::write(&index_path, b"db").unwrap();
    fs::write(&wal, b"wal").unwrap();
    fs::write(&shm, b"shm").unwrap();

    remove_index_db_files(&index_path).unwrap();

    assert!(!index_path.exists());
    assert!(!wal.exists());
    assert!(!shm.exists());
}

#[test]
fn remove_index_files_propagates_io_errors() {
    let dir = tempdir().unwrap();
    let index_path = dir.path().join("index.db");

    // Directory in place of the DB file triggers an I/O error on removal.
    fs::create_dir(&index_path).unwrap();

    let err = remove_index_db_files(&index_path).unwrap_err();
    assert!(matches!(err, BindingsError::Io(_)));
    assert!(index_path.exists());
}

#[test]
fn remove_index_files_succeeds_when_no_files_exist() {
    let dir = tempdir().unwrap();
    let index_path = dir.path().join("index.db");

    // None of the files exist — should succeed without error.
    remove_index_db_files(&index_path).unwrap();
}

#[tokio::test]
async fn with_session_path_propagates_missing_session_error() {
    let dir = tempfile::tempdir().unwrap();
    let state = make_shared_config(dir.path().to_str().unwrap());

    // Valid UUID that doesn't exist on disk
    let result = with_session_path(
        &state,
        tracepilot_core::ids::SessionId::from_validated("00000000-0000-0000-0000-000000000000"),
        |_path| Ok("should not reach here".to_string()),
    )
    .await;

    assert!(result.is_err(), "missing session should produce an error");
    let err_msg = result.unwrap_err().to_string();
    assert!(
        err_msg.contains("00000000-0000-0000-0000-000000000000"),
        "error should reference the session id: {err_msg}"
    );
}

#[tokio::test]
async fn with_session_path_runs_closure_on_resolved_path() {
    // Session directories must be valid UUIDs (discover_sessions filters by uuid::Uuid::parse_str)
    let dir = tempfile::tempdir().unwrap();
    let session_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    let session_dir = dir.path().join(session_id);
    std::fs::create_dir_all(&session_dir).unwrap();

    let state = make_shared_config(dir.path().to_str().unwrap());

    let result = with_session_path(
        &state,
        tracepilot_core::ids::SessionId::from_validated(session_id),
        |path| Ok(path.to_string_lossy().to_string()),
    )
    .await;

    assert!(
        result.is_ok(),
        "valid session should succeed: {:?}",
        result.err()
    );
    let resolved = result.unwrap();
    assert!(
        resolved.contains(session_id),
        "resolved path should contain session id: {resolved}"
    );
}

#[tokio::test]
async fn with_session_path_propagates_closure_error() {
    let dir = tempfile::tempdir().unwrap();
    let session_id = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
    let session_dir = dir.path().join(session_id);
    std::fs::create_dir_all(&session_dir).unwrap();

    let state = make_shared_config(dir.path().to_str().unwrap());

    let result: CmdResult<()> = with_session_path(
        &state,
        tracepilot_core::ids::SessionId::from_validated(session_id),
        |_path| Err(BindingsError::Validation("deliberate test error".into())),
    )
    .await;

    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert_eq!(err_msg, "deliberate test error");
}

// ── validate_path_within tests ──────────────────────────────────────

#[test]
fn validate_path_within_accepts_file_inside_dir() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("test.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_path_within(file.to_str().unwrap(), dir.path());
    assert!(result.is_ok());
    // Returned path should be canonical and end with the filename.
    let canonical = result.unwrap();
    assert!(canonical.ends_with("test.txt"));
}

#[test]
fn validate_path_within_accepts_file_in_subdirectory() {
    let dir = tempdir().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    let file = sub.join("nested.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_path_within(file.to_str().unwrap(), dir.path());
    assert!(result.is_ok());
}

#[test]
fn validate_path_within_rejects_empty_path() {
    let dir = tempdir().unwrap();
    let result = validate_path_within("", dir.path());
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("must not be empty")
    );
}

#[test]
fn validate_path_within_rejects_nonexistent_path() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("nope.txt");

    let result = validate_path_within(missing.to_str().unwrap(), dir.path());
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("does not exist"));
}

#[test]
fn validate_path_within_rejects_path_outside_dir() {
    let allowed = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let file = outside.path().join("escape.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_path_within(file.to_str().unwrap(), allowed.path());
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("outside"));
}

#[test]
fn validate_path_within_rejects_traversal_via_dotdot() {
    let dir = tempdir().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    // File is actually in the parent (dir), referred to via sub/../file.txt
    let file = dir.path().join("file.txt");
    fs::write(&file, b"data").unwrap();
    let traversal = sub.join("..").join("file.txt");

    // validate_path_within should canonicalize and see the file is NOT inside sub
    let result = validate_path_within(traversal.to_str().unwrap(), &sub);
    assert!(result.is_err());
}

#[test]
fn validate_path_within_errors_when_allowed_dir_missing() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("test.txt");
    fs::write(&file, b"data").unwrap();

    let missing_dir = dir.path().join("does_not_exist");
    let result = validate_path_within(file.to_str().unwrap(), &missing_dir);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Cannot resolve"));
}

// ── validate_write_path_within tests ────────────────────────────────

#[test]
fn validate_write_path_within_accepts_new_file_in_dir() {
    let dir = tempdir().unwrap();
    let new_file = dir.path().join("new.txt");
    // File does NOT exist yet — only the parent directory matters.

    let result = validate_write_path_within(new_file.to_str().unwrap(), dir.path());
    assert!(result.is_ok());
    let resolved = result.unwrap();
    assert!(resolved.ends_with("new.txt"));
}

#[test]
fn validate_write_path_within_accepts_new_file_in_subdirectory() {
    let dir = tempdir().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    let new_file = sub.join("new.txt");

    let result = validate_write_path_within(new_file.to_str().unwrap(), dir.path());
    assert!(result.is_ok());
}

#[test]
fn validate_write_path_within_rejects_empty_path() {
    let dir = tempdir().unwrap();
    let result = validate_write_path_within("", dir.path());
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("must not be empty")
    );
}

#[test]
fn validate_write_path_within_rejects_path_outside_dir() {
    let allowed = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let new_file = outside.path().join("escape.txt");

    let result = validate_write_path_within(new_file.to_str().unwrap(), allowed.path());
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("outside"));
}

#[test]
fn validate_write_path_within_rejects_missing_parent() {
    let dir = tempdir().unwrap();
    let deep = dir.path().join("no_such_dir").join("file.txt");

    let result = validate_write_path_within(deep.to_str().unwrap(), dir.path());
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("Parent directory does not exist"),
    );
}

#[test]
fn validate_write_path_within_rejects_bare_filename() {
    let dir = tempdir().unwrap();
    let result = validate_write_path_within("just_a_name.txt", dir.path());
    assert!(result.is_err());
}

#[test]
fn validate_write_path_within_rejects_traversal_via_dotdot() {
    let dir = tempdir().unwrap();
    let sub = dir.path().join("sub");
    fs::create_dir(&sub).unwrap();
    // Try to escape sub via ../new.txt — parent would resolve to dir, outside sub
    let traversal = sub.join("..").join("new.txt");

    let result = validate_write_path_within(traversal.to_str().unwrap(), &sub);
    assert!(result.is_err());
}

#[test]
fn validate_write_path_within_errors_when_allowed_dir_missing() {
    let dir = tempdir().unwrap();
    let new_file = dir.path().join("test.txt");

    let missing_dir = dir.path().join("does_not_exist");
    let result = validate_write_path_within(new_file.to_str().unwrap(), &missing_dir);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Cannot resolve"));
}

#[cfg(unix)]
#[test]
fn validate_path_within_rejects_symlink_escaping_dir() {
    let allowed = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let target = outside.path().join("secret.txt");
    fs::write(&target, b"secret").unwrap();
    let link = allowed.path().join("link.txt");
    std::os::unix::fs::symlink(&target, &link).unwrap();

    let result = validate_path_within(link.to_str().unwrap(), allowed.path());
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("outside"));
}

#[cfg(unix)]
#[test]
fn validate_write_path_within_rejects_existing_symlink_escaping_dir() {
    let allowed = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let target = outside.path().join("escape.txt");
    fs::write(&target, b"data").unwrap();
    // Create a symlink inside allowed that points outside
    let link = allowed.path().join("link.txt");
    std::os::unix::fs::symlink(&target, &link).unwrap();

    let result = validate_write_path_within(link.to_str().unwrap(), allowed.path());
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("outside"));
}

#[test]
fn validate_write_path_within_rejects_parent_is_file() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("not_a_dir");
    fs::write(&file, b"data").unwrap();
    // Try to use a file as the parent directory
    let bad_path = file.join("child.txt");

    let result = validate_write_path_within(bad_path.to_str().unwrap(), dir.path());
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("Parent directory does not exist")
    );
}

#[test]
fn validate_write_path_within_accepts_overwrite_within_dir() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("existing.txt");
    fs::write(&file, b"data").unwrap();

    let result = validate_write_path_within(file.to_str().unwrap(), dir.path());
    assert!(result.is_ok());
}
