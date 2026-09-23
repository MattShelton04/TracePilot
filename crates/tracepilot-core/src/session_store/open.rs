//! Binding to, and safely opening, the Copilot session store.
//!
//! Two rules shape this module. The store belongs to the CLI, which writes it
//! live in WAL mode, so every connection here is read-only, `query_only`, and
//! bounded by both a busy timeout and a total deadline — a long reader on a
//! WAL database delays the writer's checkpoints, which is the CLI's problem,
//! not ours. And the store is *global*: it holds every session this machine
//! has run, so a session only becomes eligible for enrichment when its origin
//! is the same Copilot home the store came from. A UUID that happens to match
//! an imported session must never pick up someone else's telemetry.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::paths::CopilotPaths;

use super::capability::{StoreCapabilities, TABLE_REFS, TABLE_USAGE};
use super::error::{Result, SessionStoreError};

/// How long a read waits on the CLI's writer before giving up. Short on
/// purpose: this is optional enrichment, and a slow retry costs nothing.
pub const DEFAULT_BUSY_TIMEOUT_MS: u64 = 250;

/// Total budget for one batch of reads, checked between statements.
pub const DEFAULT_READ_BUDGET_MS: u64 = 5_000;

/// The store file plus the Copilot home that owns it.
///
/// Sessions are eligible only when they came from `session_state_dir`. The
/// first release binds to the configured home's normal `session-state`
/// directory and nothing else; custom roots and imported records need an
/// explicit binding that does not exist yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceBinding {
    pub db_path: PathBuf,
    pub copilot_home: PathBuf,
    pub session_state_dir: PathBuf,
    /// Stable identity of this binding, used as the enrichment `source_id`.
    pub source_id: String,
}

impl SourceBinding {
    pub fn from_paths(paths: &CopilotPaths) -> Self {
        let db_path = paths.session_store_db();
        let copilot_home = paths.home().to_path_buf();
        let session_state_dir = paths.session_state_dir();
        let source_id = source_id_for(&db_path);
        Self {
            db_path,
            copilot_home,
            session_state_dir,
            source_id,
        }
    }

    /// The binding this machine would use, honouring `TRACEPILOT_DATA_ROOT`
    /// isolation and then `COPILOT_HOME`. An isolated test root therefore
    /// resolves to its own store and can never reach the real user's.
    pub fn try_default() -> Option<Self> {
        CopilotPaths::try_default().map(|paths| Self::from_paths(&paths))
    }

    /// Whether a session directory belongs to this source.
    ///
    /// Path equality of the parent only — no UUID matching, no walking up an
    /// arbitrary tree. An imported session living anywhere else is not
    /// eligible, which is the intended conservative answer.
    pub fn owns_session_dir(&self, session_dir: &Path) -> bool {
        match session_dir.parent() {
            Some(parent) => paths_equal(parent, &self.session_state_dir),
            None => false,
        }
    }

    pub fn exists(&self) -> bool {
        self.db_path.is_file()
    }
}

/// Case-insensitive comparison on Windows, exact elsewhere. Avoids
/// `canonicalize`, which would resolve away a junction the isolation rules
/// deliberately refuse to follow.
fn paths_equal(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        let normalize = |path: &Path| {
            path.to_string_lossy()
                .replace('\\', "/")
                .trim_end_matches('/')
                .to_lowercase()
        };
        normalize(left) == normalize(right)
    } else {
        left == right
    }
}

fn source_id_for(db_path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"session-store-source-v1");
    hasher.update(db_path.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())[..32].to_string()
}

/// An open, read-only handle with its probed capabilities and a deadline.
#[derive(Debug)]
pub struct SourceReader {
    conn: Connection,
    capabilities: StoreCapabilities,
    binding: SourceBinding,
    deadline: Instant,
    budget_ms: u64,
}

impl SourceReader {
    /// Open the bound store read-only.
    ///
    /// Deliberately not [`crate::utils::sqlite::open_readonly`]: that helper
    /// sets no busy timeout, and its sibling `configure_connection` would try
    /// to switch the CLI's database to WAL and enable foreign keys on a file
    /// this process has no business configuring.
    pub fn open(binding: &SourceBinding) -> Result<Self> {
        Self::open_with_budget(binding, DEFAULT_READ_BUDGET_MS)
    }

    pub fn open_with_budget(binding: &SourceBinding, budget_ms: u64) -> Result<Self> {
        if !binding.db_path.is_file() {
            return Err(SessionStoreError::Missing(binding.db_path.clone()));
        }
        let conn = Connection::open_with_flags(
            &binding.db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| SessionStoreError::from_sqlite(&error))?;

        conn.busy_timeout(Duration::from_millis(DEFAULT_BUSY_TIMEOUT_MS))
            .map_err(|error| SessionStoreError::from_sqlite(&error))?;
        // `query_only` is belt-and-braces over the read-only flag: it also
        // refuses a write attempted through an ATTACHed database.
        conn.pragma_update(None, "query_only", true)
            .map_err(|error| SessionStoreError::from_sqlite(&error))?;

        let deadline = Instant::now() + Duration::from_millis(budget_ms);
        conn.progress_handler(1_000, Some(move || Instant::now() > deadline));
        let capabilities = StoreCapabilities::probe(&conn)
            .map_err(|error| SessionStoreError::from_sqlite(&error))?;
        if capabilities.is_unusable() {
            return Err(SessionStoreError::Incompatible);
        }

        Ok(Self {
            conn,
            capabilities,
            binding: binding.clone(),
            deadline,
            budget_ms,
        })
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub fn capabilities(&self) -> &StoreCapabilities {
        &self.capabilities
    }

    pub fn binding(&self) -> &SourceBinding {
        &self.binding
    }

    /// Check between rows as well as statements; the progress handler also
    /// interrupts expensive scans and sorts inside SQLite.
    pub fn check_budget(&self) -> Result<()> {
        if Instant::now() > self.deadline {
            return Err(SessionStoreError::DeadlineExceeded(self.budget_ms));
        }
        Ok(())
    }

    /// Extend the deadline for a fresh batch, so one reader can serve several
    /// sessions without one long-lived budget covering all of them.
    pub fn renew_budget(&mut self) {
        self.deadline = Instant::now() + Duration::from_millis(self.budget_ms);
        let deadline = self.deadline;
        self.conn
            .progress_handler(1_000, Some(move || Instant::now() > deadline));
    }

    /// Detect commits made by another connection during a sweep. This value
    /// is only comparable across reads on this same connection.
    pub fn data_version(&self) -> Result<i64> {
        self.conn
            .pragma_query_value(None, "data_version", |row| row.get(0))
            .map_err(|error| SessionStoreError::from_sqlite(&error))
    }

    /// A cheap fingerprint of the source's current contents.
    ///
    /// The store has no update feed: no tombstones, no per-row version, and
    /// `sessions.updated_at` is not proven to move on every usage write. This
    /// mixes row counts with the minimum and maximum row IDs. This is only a
    /// coarse change hint: same-size rewrites are detected by rereading rows
    /// and advancing the index revision, never by trusting this hash alone.
    pub fn generation_fingerprint(&self) -> Result<String> {
        let mut hasher = Sha256::new();
        hasher.update(b"session-store-generation-v1");
        hasher.update(self.capabilities.fingerprint.as_bytes());
        for table in [TABLE_USAGE, TABLE_REFS] {
            let sentinel = self.table_sentinel(table)?;
            hasher.update(table.as_bytes());
            hasher.update(sentinel.0.to_le_bytes());
            hasher.update(sentinel.1.to_le_bytes());
            hasher.update(sentinel.2.to_le_bytes());
        }
        Ok(format!("{:x}", hasher.finalize()))
    }

    fn table_sentinel(&self, table: &str) -> Result<(i64, i64, i64)> {
        if !self.capabilities.has_table(table) {
            return Ok((0, 0, 0));
        }
        self.check_budget()?;
        let has_id = self.capabilities.has_column(table, "id");
        let sql = if has_id {
            format!(
                "SELECT COUNT(*), COALESCE(MIN(\"id\"), 0), COALESCE(MAX(\"id\"), 0) FROM \"{table}\""
            )
        } else {
            format!("SELECT COUNT(*), 0, 0 FROM \"{table}\"")
        };
        self.conn
            .query_row(&sql, [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(|error| SessionStoreError::from_sqlite(&error))
    }
}
