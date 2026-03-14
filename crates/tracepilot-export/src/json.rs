//! JSON export for sessions.

use anyhow::Result;

/// Export a session summary as formatted JSON.
pub fn render_json(summary: &tracepilot_core::models::SessionSummary) -> Result<String> {
    Ok(serde_json::to_string_pretty(summary)?)
}
