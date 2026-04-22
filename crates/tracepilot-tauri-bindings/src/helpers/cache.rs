//! Config readers and `SessionListItem` constructors.

use crate::config::{SharedConfig, TracePilotConfig};
use crate::error::CmdResult;
use crate::types::SessionListItem;
use std::path::Path;

/// Read config from shared state, falling back to defaults.
pub(crate) fn read_config(state: &SharedConfig) -> TracePilotConfig {
    match state.read() {
        Ok(guard) => guard.clone().unwrap_or_default(),
        Err(poisoned) => {
            tracing::error!("Config RwLock poisoned — recovering inner value");
            poisoned.into_inner().clone().unwrap_or_default()
        }
    }
}

pub(crate) fn summary_to_list_item(
    summary: tracepilot_core::SessionSummary,
    session_path: &Path,
) -> SessionListItem {
    let is_running = tracepilot_core::session::discovery::has_lock_file(session_path);
    SessionListItem {
        id: summary.id,
        summary: summary.summary,
        repository: summary.repository,
        branch: summary.branch,
        cwd: summary.cwd,
        host_type: summary.host_type,
        created_at: summary.created_at.map(|d| d.to_rfc3339()),
        updated_at: summary.updated_at.map(|d| d.to_rfc3339()),
        event_count: summary.event_count,
        turn_count: summary.turn_count,
        current_model: summary
            .shutdown_metrics
            .as_ref()
            .and_then(|metrics| metrics.current_model.clone()),
        is_running,
        error_count: None,
        rate_limit_count: None,
        compaction_count: None,
        truncation_count: None,
    }
}

pub(crate) fn load_summary_list_item(session_path: &Path) -> CmdResult<SessionListItem> {
    let summary = tracepilot_core::summary::load_session_summary(session_path)?;
    Ok(summary_to_list_item(summary, session_path))
}

fn maybe_i64_to_usize(value: Option<i64>) -> Option<usize> {
    value.and_then(|v| usize::try_from(v).ok())
}

pub(crate) fn indexed_session_to_list_item(
    session: tracepilot_indexer::index_db::IndexedSession,
) -> SessionListItem {
    let is_running = tracepilot_core::session::discovery::has_lock_file(Path::new(&session.path));
    SessionListItem {
        id: session.id,
        summary: session.summary,
        repository: session.repository,
        branch: session.branch,
        cwd: session.cwd,
        host_type: session.host_type,
        created_at: session.created_at,
        updated_at: session.updated_at,
        event_count: maybe_i64_to_usize(session.event_count),
        turn_count: maybe_i64_to_usize(session.turn_count),
        current_model: session.current_model,
        is_running,
        error_count: maybe_i64_to_usize(session.error_count),
        rate_limit_count: maybe_i64_to_usize(session.rate_limit_count),
        compaction_count: maybe_i64_to_usize(session.compaction_count),
        truncation_count: maybe_i64_to_usize(session.truncation_count),
    }
}
