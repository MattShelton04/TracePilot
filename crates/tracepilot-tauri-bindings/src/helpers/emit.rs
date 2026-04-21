//! Tauri event payload construction.

use crate::types::IndexingProgressPayload;
use tauri::Emitter;

/// Convert an `IndexingProgress` from the indexer into our Tauri event payload and emit it.
pub(crate) fn emit_indexing_progress(
    app: &tauri::AppHandle,
    progress: &tracepilot_indexer::IndexingProgress,
) {
    let session = progress.session_info.as_ref();
    let payload = IndexingProgressPayload {
        current: progress.current,
        total: progress.total,
        session_repo: session.and_then(|s| s.repository.clone()),
        session_branch: session.and_then(|s| s.branch.clone()),
        session_model: session.and_then(|s| s.current_model.clone()),
        session_tokens: session.map(|s| s.total_tokens).unwrap_or(0),
        session_events: session.map(|s| s.event_count).unwrap_or(0),
        session_turns: session.map(|s| s.turn_count).unwrap_or(0),
        total_tokens: progress.running_tokens,
        total_events: progress.running_events,
        total_repos: progress.running_repos,
    };
    let _ = app.emit(crate::events::INDEXING_PROGRESS, payload);
}
