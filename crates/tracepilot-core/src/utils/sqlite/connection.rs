use crate::error::{Result, TracePilotError};
use rusqlite::Connection;
use std::path::Path;

/// Configure a SQLite connection with standard performance and correctness PRAGMAs.
///
/// Sets:
/// - `journal_mode=WAL` for concurrent reads
/// - `synchronous=NORMAL` for balanced durability/performance
/// - `foreign_keys=ON` for referential integrity
/// - `busy_timeout=5000` to avoid SQLITE_BUSY on contention
///
/// Both the indexer and orchestrator databases share this configuration.
/// Each caller wraps the returned `rusqlite::Error` in its own error type.
#[inline]
pub fn configure_connection(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;",
    )
}

/// Open a SQLite database in read-only mode without creating file locks.
///
/// This is the preferred method for all read operations to avoid:
/// - Creating WAL/SHM files on read-only file systems
/// - Holding unnecessary locks
/// - Blocking other readers
///
/// Uses `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` flags for maximum concurrency.
///
/// # Arguments
/// * `path` - Path to the SQLite database file
///
/// # Returns
/// - `Ok(Connection)` if the database exists and can be opened
/// - `Err(TracePilotError)` if the file doesn't exist or cannot be opened
///
/// # Example
/// ```no_run
/// use tracepilot_core::utils::sqlite::open_readonly;
/// use std::path::Path;
///
/// let conn = open_readonly(Path::new("/path/to/db.sqlite"))?;
/// # Ok::<(), tracepilot_core::error::TracePilotError>(())
/// ```
#[inline]
pub fn open_readonly(db_path: &Path) -> Result<Connection> {
    tracing::debug!("Opening SQLite database read-only: {}", db_path.display());

    Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| {
        tracing::warn!("Failed to open database {}: {}", db_path.display(), e);
        TracePilotError::ParseError {
            context: format!("Failed to open database: {}", db_path.display()),
            source: Some(Box::new(e)),
        }
    })
}

/// Open a SQLite database read-only, returning `None` if the file doesn't exist.
///
/// This is a common pattern for optional databases. Returns an error only if
/// the file exists but cannot be opened.
///
/// # Example
/// ```no_run
/// use tracepilot_core::utils::sqlite::open_readonly_if_exists;
/// use std::path::Path;
///
/// if let Some(conn) = open_readonly_if_exists(Path::new("/path/to/db.sqlite"))? {
///     // Database exists, use it
/// }
/// # Ok::<(), tracepilot_core::error::TracePilotError>(())
/// ```
#[inline]
pub fn open_readonly_if_exists(db_path: &Path) -> Result<Option<Connection>> {
    if !db_path.exists() {
        return Ok(None);
    }
    open_readonly(db_path).map(Some)
}
