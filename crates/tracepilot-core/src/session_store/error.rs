//! Failure modes of an optional source.
//!
//! These are deliberately not folded into [`crate::error::TracePilotError`].
//! Callers have to branch on *which* failure happened — a missing file keeps
//! cached rows and stays silent, a busy writer retries, a corrupt file warns
//! once — and a single opaque error would flatten those into one behaviour.

use std::path::PathBuf;

use thiserror::Error;

use super::status::SourceAvailability;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SessionStoreError {
    #[error("Session-store enrichment is disabled")]
    Disabled,

    #[error("No Copilot session store at {0}")]
    Missing(PathBuf),

    #[error("Copilot session store is busy: {0}")]
    Busy(String),

    #[error("Copilot session store could not be read: {0}")]
    Unreadable(String),

    #[error("Copilot session store has none of the tables this build reads")]
    Incompatible,

    #[error("Copilot session store read exceeded its {0} ms budget")]
    DeadlineExceeded(u64),
}

impl SessionStoreError {
    pub fn availability(&self) -> SourceAvailability {
        match self {
            Self::Disabled => SourceAvailability::Disabled,
            Self::Missing(_) => SourceAvailability::Missing,
            Self::Busy(_) | Self::DeadlineExceeded(_) => SourceAvailability::Busy,
            Self::Unreadable(_) => SourceAvailability::Unreadable,
            Self::Incompatible => SourceAvailability::Incompatible,
        }
    }

    /// Classify a rusqlite failure. Lock contention is transient and must not
    /// be reported as corruption, which would suppress later retries.
    pub fn from_sqlite(error: &rusqlite::Error) -> Self {
        if let rusqlite::Error::SqliteFailure(code, message) = error {
            return match code.code {
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked => {
                    Self::Busy(message.clone().unwrap_or_else(|| code.to_string()))
                }
                rusqlite::ErrorCode::CannotOpen => {
                    Self::Unreadable(message.clone().unwrap_or_else(|| code.to_string()))
                }
                _ => Self::Unreadable(message.clone().unwrap_or_else(|| error.to_string())),
            };
        }
        Self::Unreadable(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, SessionStoreError>;
