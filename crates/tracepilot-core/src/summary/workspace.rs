use std::path::Path;

use crate::error::{Result, TracePilotError};
use crate::models::session_summary::SessionSummary;
use crate::parsing::workspace::{WorkspaceMetadata, parse_workspace_yaml};

/// Parse `workspace.yaml` when present, otherwise fall back to the directory ID.
pub(super) fn load_workspace_summary(session_dir: &Path) -> Result<SessionSummary> {
    let workspace_path = session_dir.join("workspace.yaml");
    if workspace_path.exists() {
        match parse_workspace_yaml(&workspace_path) {
            Ok(ws) => Ok(summary_from_workspace(ws)),
            Err(e) => {
                tracing::warn!(
                    path = %workspace_path.display(),
                    error = %e,
                    "Failed to parse workspace.yaml; falling back to events-only summary"
                );
                minimal_summary_from_dir(session_dir)
            }
        }
    } else {
        minimal_summary_from_dir(session_dir)
    }
}

fn summary_from_workspace(ws: WorkspaceMetadata) -> SessionSummary {
    SessionSummary {
        id: ws.id,
        summary: ws.summary,
        repository: ws.repository,
        branch: ws.branch,
        cwd: ws.cwd,
        host_type: ws.host_type,
        created_at: ws.created_at,
        updated_at: ws.updated_at,
        event_count: None,
        has_events: false,
        has_session_db: false,
        has_plan: false,
        has_checkpoints: false,
        checkpoint_count: None,
        turn_count: None,
        shutdown_metrics: None,
    }
}

/// Build a minimal [`SessionSummary`] from a session directory that lacks a
/// parseable `workspace.yaml`.
///
/// Uses the directory name (UUID) as the session ID and leaves all metadata
/// fields empty. The caller enriches the summary from `events.jsonl` afterward.
fn minimal_summary_from_dir(session_dir: &Path) -> Result<SessionSummary> {
    let id = session_dir
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            TracePilotError::SessionNotFound(format!(
                "Cannot derive session ID from directory: {}",
                session_dir.display()
            ))
        })?;

    Ok(SessionSummary {
        id,
        summary: None,
        repository: None,
        branch: None,
        cwd: None,
        host_type: None,
        created_at: None,
        updated_at: None,
        event_count: None,
        has_events: false,
        has_session_db: false,
        has_plan: false,
        has_checkpoints: false,
        checkpoint_count: None,
        turn_count: None,
        shutdown_metrics: None,
    })
}
