//! Persistent Copilot SDK session registry.
//!
//! The registry is intentionally metadata-only: it records session identity,
//! connection shape, and recovery state, but never prompt bodies, tokens, or
//! other secrets.

use crate::{OrchestratorError, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS sdk_session_registry (
    session_id TEXT PRIMARY KEY NOT NULL,
    origin TEXT NOT NULL,
    connection_mode TEXT,
    cli_url TEXT,
    working_directory TEXT,
    model TEXT,
    reasoning_effort TEXT,
    agent TEXT,
    desired_state TEXT NOT NULL,
    runtime_state TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_event_id TEXT,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sdk_session_registry_desired
    ON sdk_session_registry(desired_state, runtime_state);
"#;
const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionOrigin {
    ManualLink,
    LauncherSdk,
    TracepilotSdk,
}

impl SessionOrigin {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ManualLink => "manual-link",
            Self::LauncherSdk => "launcher-sdk",
            Self::TracepilotSdk => "tracepilot-sdk",
        }
    }

    pub const fn may_auto_resume(self) -> bool {
        matches!(self, Self::LauncherSdk)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DesiredSessionState {
    Tracked,
    Unlinked,
    Destroyed,
    DoNotRehydrate,
}

impl DesiredSessionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tracked => "tracked",
            Self::Unlinked => "unlinked",
            Self::Destroyed => "destroyed",
            Self::DoNotRehydrate => "do-not-rehydrate",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeSessionState {
    Running,
    Shutdown,
    Unknown,
    Error,
}

impl RuntimeSessionState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Shutdown => "shutdown",
            Self::Unknown => "unknown",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryRecord {
    pub session_id: String,
    pub origin: SessionOrigin,
    pub connection_mode: Option<String>,
    pub cli_url: Option<String>,
    pub working_directory: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub agent: Option<String>,
    pub desired_state: DesiredSessionState,
    pub runtime_state: RuntimeSessionState,
    pub linked_at: String,
    pub last_seen_at: String,
    pub last_event_id: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDecision {
    pub session_id: String,
    pub should_auto_resume: bool,
    pub reason: String,
    pub record: RegistryRecord,
}

#[derive(Debug, Clone)]
pub struct RegistryUpsert {
    pub session_id: String,
    pub origin: SessionOrigin,
    pub connection_mode: Option<String>,
    pub cli_url: Option<String>,
    pub working_directory: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub agent: Option<String>,
    pub desired_state: DesiredSessionState,
    pub runtime_state: RuntimeSessionState,
    pub last_error: Option<String>,
}

pub struct SessionRegistry {
    conn: Connection,
}

impl SessionRegistry {
    pub fn open_or_create(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path).map_err(|e| {
            OrchestratorError::task_ctx(
                format!("Failed to open SDK session registry at {}", path.display()),
                e,
            )
        })?;
        Self::from_connection(conn)
    }

    pub fn default_path() -> Result<PathBuf> {
        Ok(crate::launcher::copilot_home()?
            .join("tracepilot")
            .join("sdk-sessions.db"))
    }

    pub fn from_connection(conn: Connection) -> Result<Self> {
        tracepilot_core::utils::sqlite::configure_connection(&conn)
            .map_err(|e| OrchestratorError::task_ctx("Failed to set registry DB pragmas", e))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| OrchestratorError::task_ctx("Failed to migrate SDK registry", e))?;
        migrate_user_version(&conn)?;
        Ok(Self { conn })
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        Self::from_connection(
            Connection::open_in_memory().map_err(|e| {
                OrchestratorError::task_ctx("Failed to open in-memory SDK registry", e)
            })?,
        )
    }

    pub fn upsert(&self, record: RegistryUpsert) -> Result<()> {
        let now = now();
        let existing_linked_at = self.linked_at(&record.session_id)?;
        let linked_at = existing_linked_at.as_deref().unwrap_or(&now);
        self.conn
            .execute(
                "INSERT INTO sdk_session_registry (
                    session_id, origin, connection_mode, cli_url, working_directory,
                    model, reasoning_effort, agent, desired_state, runtime_state,
                    linked_at, last_seen_at, last_event_id, last_error
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13)
                ON CONFLICT(session_id) DO UPDATE SET
                    origin = excluded.origin,
                    connection_mode = excluded.connection_mode,
                    cli_url = excluded.cli_url,
                    working_directory = COALESCE(excluded.working_directory, working_directory),
                    model = COALESCE(excluded.model, model),
                    reasoning_effort = COALESCE(excluded.reasoning_effort, reasoning_effort),
                    agent = COALESCE(excluded.agent, agent),
                    desired_state = excluded.desired_state,
                    runtime_state = excluded.runtime_state,
                    last_seen_at = excluded.last_seen_at,
                    last_error = excluded.last_error",
                params![
                    record.session_id,
                    record.origin.as_str(),
                    record.connection_mode,
                    record.cli_url,
                    record.working_directory,
                    record.model,
                    record.reasoning_effort,
                    record.agent,
                    record.desired_state.as_str(),
                    record.runtime_state.as_str(),
                    linked_at,
                    now,
                    record.last_error,
                ],
            )
            .map_err(|e| OrchestratorError::task_ctx("Failed to upsert SDK registry record", e))?;
        Ok(())
    }

    pub fn mark_runtime(
        &self,
        session_id: &str,
        runtime_state: RuntimeSessionState,
        last_error: Option<&str>,
    ) -> Result<()> {
        self.conn
            .execute(
                "UPDATE sdk_session_registry
                 SET runtime_state = ?1, last_seen_at = ?2, last_error = ?3
                 WHERE session_id = ?4",
                params![runtime_state.as_str(), now(), last_error, session_id],
            )
            .map_err(|e| OrchestratorError::task_ctx("Failed to update SDK runtime state", e))?;
        Ok(())
    }

    pub fn mark_desired(
        &self,
        session_id: &str,
        desired_state: DesiredSessionState,
        runtime_state: RuntimeSessionState,
    ) -> Result<()> {
        self.conn
            .execute(
                "UPDATE sdk_session_registry
                 SET desired_state = ?1, runtime_state = ?2, last_seen_at = ?3
                 WHERE session_id = ?4",
                params![
                    desired_state.as_str(),
                    runtime_state.as_str(),
                    now(),
                    session_id
                ],
            )
            .map_err(|e| OrchestratorError::task_ctx("Failed to update SDK desired state", e))?;
        Ok(())
    }

    pub fn mark_unknown_except(&self, active_session_ids: &HashSet<String>) -> Result<()> {
        for record in self.list()? {
            if record.desired_state == DesiredSessionState::Tracked
                && record.runtime_state == RuntimeSessionState::Running
                && !active_session_ids.contains(&record.session_id)
            {
                self.mark_runtime(&record.session_id, RuntimeSessionState::Unknown, None)?;
            }
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<RegistryRecord>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT session_id, origin, connection_mode, cli_url, working_directory,
                        model, reasoning_effort, agent, desired_state, runtime_state,
                        linked_at, last_seen_at, last_event_id, last_error
                 FROM sdk_session_registry
                 ORDER BY last_seen_at DESC, linked_at DESC",
            )
            .map_err(|e| OrchestratorError::task_ctx("Failed to query SDK registry", e))?;
        let rows = stmt
            .query_map([], row_to_record)
            .map_err(|e| OrchestratorError::task_ctx("Failed to read SDK registry", e))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| OrchestratorError::task_ctx("Failed to decode SDK registry", e))
    }

    pub fn recovery_decisions(&self) -> Result<Vec<RecoveryDecision>> {
        Ok(self
            .list()?
            .into_iter()
            .filter(|r| r.desired_state == DesiredSessionState::Tracked)
            .map(|record| {
                let (should_auto_resume, reason) = if !record.origin.may_auto_resume() {
                    (false, "origin requires explicit user action".to_string())
                } else if record.runtime_state == RuntimeSessionState::Running {
                    (
                        false,
                        "session is already active in this process".to_string(),
                    )
                } else {
                    (true, "safe origin is eligible for auto-resume".to_string())
                };
                RecoveryDecision {
                    session_id: record.session_id.clone(),
                    should_auto_resume,
                    reason,
                    record,
                }
            })
            .collect())
    }

    pub fn forget(&self, session_id: &str) -> Result<bool> {
        let changed = self
            .conn
            .execute(
                "DELETE FROM sdk_session_registry WHERE session_id = ?1",
                [session_id],
            )
            .map_err(|e| OrchestratorError::task_ctx("Failed to forget SDK registry record", e))?;
        Ok(changed > 0)
    }

    pub fn prune_terminal_older_than_days(&self, days: i64) -> Result<usize> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        self.conn
            .execute(
                "DELETE FROM sdk_session_registry
                 WHERE (
                       desired_state IN ('destroyed', 'unlinked', 'do-not-rehydrate')
                       OR runtime_state IN ('unknown', 'error')
                   )
                   AND last_seen_at < ?1",
                [cutoff],
            )
            .map_err(|e| OrchestratorError::task_ctx("Failed to prune SDK registry", e))
    }

    fn linked_at(&self, session_id: &str) -> Result<Option<String>> {
        self.conn
            .query_row(
                "SELECT linked_at FROM sdk_session_registry WHERE session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| OrchestratorError::task_ctx("Failed to read SDK registry timestamp", e))
    }
}

fn migrate_user_version(conn: &Connection) -> Result<()> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| OrchestratorError::task_ctx("Failed to read SDK registry version", e))?;
    if version == 0 {
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| OrchestratorError::task_ctx("Failed to set SDK registry version", e))?;
    }
    Ok(())
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<RegistryRecord> {
    Ok(RegistryRecord {
        session_id: row.get(0)?,
        origin: parse_origin(row.get::<_, String>(1)?.as_str()),
        connection_mode: row.get(2)?,
        cli_url: row.get(3)?,
        working_directory: row.get(4)?,
        model: row.get(5)?,
        reasoning_effort: row.get(6)?,
        agent: row.get(7)?,
        desired_state: parse_desired(row.get::<_, String>(8)?.as_str()),
        runtime_state: parse_runtime(row.get::<_, String>(9)?.as_str()),
        linked_at: row.get(10)?,
        last_seen_at: row.get(11)?,
        last_event_id: row.get(12)?,
        last_error: row.get(13)?,
    })
}

fn parse_origin(value: &str) -> SessionOrigin {
    match value {
        "launcher-sdk" => SessionOrigin::LauncherSdk,
        "tracepilot-sdk" => SessionOrigin::TracepilotSdk,
        _ => SessionOrigin::ManualLink,
    }
}

fn parse_desired(value: &str) -> DesiredSessionState {
    match value {
        "unlinked" => DesiredSessionState::Unlinked,
        "destroyed" => DesiredSessionState::Destroyed,
        "do-not-rehydrate" => DesiredSessionState::DoNotRehydrate,
        _ => DesiredSessionState::Tracked,
    }
}

fn parse_runtime(value: &str) -> RuntimeSessionState {
    match value {
        "running" => RuntimeSessionState::Running,
        "shutdown" => RuntimeSessionState::Shutdown,
        "error" => RuntimeSessionState::Error,
        _ => RuntimeSessionState::Unknown,
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests;
