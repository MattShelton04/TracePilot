//! Import configuration and conflict strategy types.

use serde::{Deserialize, Serialize};

/// Configuration for an import operation.
#[derive(Debug, Clone)]
pub struct ImportOptions {
    /// How to handle sessions that already exist at the target.
    pub conflict_strategy: ConflictStrategy,
    /// Specific session IDs to import (empty = import all).
    pub session_filter: Vec<String>,
    /// Whether to run validation only (dry run).
    pub dry_run: bool,
}

impl Default for ImportOptions {
    fn default() -> Self {
        Self {
            conflict_strategy: ConflictStrategy::Skip,
            session_filter: Vec::new(),
            dry_run: false,
        }
    }
}

/// How to resolve conflicts when importing a session whose ID already exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictStrategy {
    /// Don't import — keep the existing session.
    Skip,
    /// Overwrite the existing session with imported data.
    Replace,
    /// Generate a new UUID and import as a separate session.
    Duplicate,
}
