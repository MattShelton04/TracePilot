//! Task-database error sub-enum.
//!
//! FU-12 (error taxonomy consolidation): splits what used to be three
//! flat variants on [`crate::error::OrchestratorError`] (`TaskDb`,
//! `TaskDbMigration`, `TaskDbBackup`) into a single domain-scoped enum
//! so each failure mode carries its own typed `#[source]` and is not
//! misattributed as generic "task database error" (w83 FI, master-plan
//! Phase §w83).
//!
//! The outer [`OrchestratorError::TaskDb`] wraps this via `#[from]` so
//! the wire-facing `ErrorCode::ORCHESTRATOR` mapping is unchanged.

use thiserror::Error;

/// Errors originating from task-database operations.
///
/// Consumers should bubble these up through
/// [`crate::error::OrchestratorError::TaskDb`] using `?`; a bare
/// `rusqlite::Error` at the call site converts to [`Self::Query`].
#[derive(Debug, Error)]
pub enum TaskDbError {
    /// Everyday CRUD / query failure against the task DB.
    #[error("Task DB query failed: {0}")]
    Query(#[source] rusqlite::Error),

    /// Reading or writing the `schema_version` tracking table. Kept
    /// distinct from [`Self::Query`] so schema-framework faults are not
    /// mis-reported as application bugs.
    #[error("Task DB schema-version access failed: {0}")]
    Schema(#[source] rusqlite::Error),

    /// A schema migration step (DDL/DML) failed. Preserves the step
    /// name so operator triage is actionable.
    #[error("Task DB migration '{name}' failed: {source}")]
    Migration {
        name: String,
        #[source]
        source: rusqlite::Error,
    },

    /// SQLite backup performed before a task-DB migration failed.
    /// Distinct from [`Self::Query`] because the failure is in the
    /// backup pipeline, not application-level CRUD.
    #[error("Task DB pre-migration backup failed: {0}")]
    Backup(#[source] rusqlite::Error),
}

impl From<rusqlite::Error> for TaskDbError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Query(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error;

    #[test]
    fn query_variant_preserves_source() {
        let err = TaskDbError::Query(rusqlite::Error::InvalidQuery);
        assert!(err.source().is_some());
        assert!(err.to_string().contains("query failed"));
    }

    #[test]
    fn migration_variant_preserves_step_name() {
        let err = TaskDbError::Migration {
            name: "add_col".into(),
            source: rusqlite::Error::InvalidQuery,
        };
        assert!(err.to_string().contains("'add_col'"));
        assert!(err.source().is_some());
    }

    #[test]
    fn backup_variant_is_distinct_phrasing() {
        let err = TaskDbError::Backup(rusqlite::Error::InvalidQuery);
        assert!(err.to_string().contains("pre-migration backup"));
    }

    #[test]
    fn schema_variant_is_distinct_phrasing() {
        let err = TaskDbError::Schema(rusqlite::Error::InvalidQuery);
        assert!(err.to_string().contains("schema-version"));
    }

    #[test]
    fn rusqlite_auto_converts_to_query() {
        let e: TaskDbError = rusqlite::Error::InvalidQuery.into();
        assert!(matches!(e, TaskDbError::Query(_)));
    }
}
