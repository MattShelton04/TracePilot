//! Shared helper functions used by multiple command modules.
//!
//! Organised into focused sub-modules:
//! - [`path`]: filesystem path validation & copilot-home resolution
//! - [`db`]: session/index/task DB access wrappers
//! - [`cache`]: config readers and `SessionListItem` conversions
//! - [`emit`]: Tauri event payload construction

use crate::error::BindingsError;

mod cache;
mod db;
mod emit;
mod path;

#[cfg(test)]
mod tests;

pub(crate) const MAX_CHECKPOINT_CONTENT_BYTES: usize = 50 * 1024;

/// Returns a [`BindingsError`] for a poisoned mutex guard.
///
/// A poisoned mutex indicates a thread panicked while holding the lock —
/// an infrastructure failure, not a user input error. Serialises as
/// `{"code": "INTERNAL", "message": "mutex poisoned"}`.
pub(crate) fn mutex_poisoned() -> BindingsError {
    BindingsError::Internal("mutex poisoned".into())
}

/// Successfully opened index database with a precomputed session count.
pub(crate) struct OpenIndexDb {
    pub db: tracepilot_indexer::index_db::IndexDb,
    pub session_count: usize,
}

pub(crate) use cache::{
    indexed_session_to_list_item, load_summary_list_item, read_config,
};
pub(crate) use db::{
    get_or_init_task_db, open_index_db, remove_index_db_files, with_session_path, with_task_db,
};
pub(crate) use emit::emit_indexing_progress;
pub(crate) use path::{copilot_home, validate_path_within, validate_write_path_within};
