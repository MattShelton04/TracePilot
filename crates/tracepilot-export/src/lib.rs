//! tracepilot-export: Export sessions to various formats with optional redaction.

use anyhow::Result;
use std::path::Path;

pub mod json;
pub mod markdown;

/// Export format options.
pub enum ExportFormat {
    Markdown,
    Json,
    Csv,
}

/// Export a session to a file in the given format.
pub fn export_session(
    _session_dir: &Path,
    _output_path: &Path,
    _format: ExportFormat,
    _redact_secrets: bool,
) -> Result<()> {
    anyhow::bail!("Export is not yet implemented — coming in Phase 2")
}
