use std::path::Path;

use crate::models::session_summary::SessionSummary;
use crate::parsing::checkpoints::parse_checkpoints;

/// Set artifact presence/count fields from files in the session directory.
pub(super) fn apply_artifact_flags(summary: &mut SessionSummary, session_dir: &Path) {
    summary.has_session_db = session_dir.join("session.db").exists();
    summary.has_plan = session_dir.join("plan.md").exists();
    if let Ok(Some(cp_index)) = parse_checkpoints(session_dir) {
        summary.has_checkpoints = true;
        summary.checkpoint_count = Some(cp_index.checkpoints.len());
    }
}
