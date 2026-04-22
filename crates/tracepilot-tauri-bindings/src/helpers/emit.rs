//! Tauri event payload construction.

use crate::types::IndexingProgressPayload;
use serde::Serialize;
use tauri::Emitter;

/// Emit a Tauri event as best-effort: failures are logged at `debug` level.
///
/// Emit can fail if no webview is listening (e.g. window closed mid-operation).
/// Such failures are expected and non-fatal, hence debug-level logging rather than warn.
pub(crate) fn emit_best_effort<P: Serialize + Clone>(
    app: &tauri::AppHandle,
    event: &'static str,
    payload: P,
) {
    if let Err(e) = app.emit(event, payload) {
        tracing::debug!(error = %e, event, "Tauri event emit failed (no listener)");
    }
}

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
    emit_best_effort(app, crate::events::INDEXING_PROGRESS, payload);
}
