//! tracepilot-export: Export sessions to various formats with optional redaction.
//!
//! # Architecture
//!
//! ```text
//!   Session dir(s) ──▶ Builder ──▶ SessionArchive ──▶ Renderer ──▶ ExportFile(s)
//! ```
//!
//! The [`SessionArchive`] is the canonical intermediate representation consumed
//! by all renderers. The builder assembles it from session files using
//! `tracepilot-core` parsers. Each renderer implements [`render::ExportRenderer`]
//! to produce format-specific output.

pub mod builder;
pub mod document;
pub mod error;
pub mod options;
pub mod render;
pub mod schema;

// Legacy modules — kept for backward compatibility until Phase A2.
pub mod json;
pub mod markdown;

#[cfg(test)]
pub(crate) mod test_helpers;

// Re-export key types for ergonomic API usage.
pub use document::{SessionArchive, PortableSession, SectionId};
pub use error::{ExportError, Result};
pub use options::{ExportFormat, ExportOptions, OutputTarget};
pub use render::{ExportFile, ExportRenderer};

use std::path::Path;

/// Export a single session to the specified format.
///
/// Returns one or more output files (most formats produce one; CSV produces multiple).
pub fn export_session(
    session_dir: &Path,
    options: &ExportOptions,
) -> Result<Vec<ExportFile>> {
    let archive = builder::build_session_archive(session_dir, options)?;
    let renderer = render::create_renderer(options.format);
    renderer.render(&archive)
}

/// Export multiple sessions in a single archive.
pub fn export_sessions_batch(
    session_dirs: &[&Path],
    options: &ExportOptions,
) -> Result<Vec<ExportFile>> {
    let archive = builder::build_session_archive_batch(session_dirs, options)?;
    let renderer = render::create_renderer(options.format);
    renderer.render(&archive)
}

/// Generate a preview of the export output without writing to disk.
///
/// Returns the rendered content as a string, truncated to `max_bytes` if specified.
pub fn preview_export(
    session_dir: &Path,
    options: &ExportOptions,
    max_bytes: Option<usize>,
) -> Result<String> {
    let archive = builder::build_session_archive(session_dir, options)?;
    let renderer = render::create_renderer(options.format);
    let files = renderer.render(&archive)?;

    let content = files
        .first()
        .and_then(|f| f.as_text())
        .unwrap_or("")
        .to_string();

    match max_bytes {
        Some(max) if content.len() > max => Ok(content[..max].to_string()),
        _ => Ok(content),
    }
}

