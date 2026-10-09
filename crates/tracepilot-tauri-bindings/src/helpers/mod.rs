//! Shared helper functions used by multiple command modules.
//!
//! Organised into focused sub-modules:
//! - [`path`]: filesystem path validation & copilot-home resolution
//! - [`db`]: index DB access wrappers
//! - [`locator`]: session id → provider and locator
//! - [`cache`]: config readers and `SessionListItem` conversions
//! - [`emit`]: Tauri event payload construction

use crate::error::BindingsError;

mod cache;
mod db;
mod definition_repos;
mod emit;
mod locator;
mod path;

#[cfg(test)]
mod locator_tests;

#[cfg(test)]
mod path_within_any_tests;

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

pub(crate) use cache::{indexed_sessions_to_list_items, load_summary_list_item, read_config};
pub(crate) use db::{open_index_db, remove_index_db_files};
pub(crate) use definition_repos::definition_repo_roots;
pub(crate) use emit::{emit_best_effort, emit_indexing_progress};
pub(crate) use locator::{
    explorer_roots, require_capability, require_copilot_layout, resolve_session,
    with_session_locator,
};
pub(crate) use path::{validate_path_within, validate_path_within_any, validate_write_path_within};
