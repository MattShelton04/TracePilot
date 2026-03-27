//! Format-specific renderers.
//!
//! Each renderer implements [`ExportRenderer`] to convert a [`SessionArchive`]
//! into one or more output files. Adding a new format means implementing this
//! trait — no changes to the builder, options, or UI layer.

use crate::document::SessionArchive;
use crate::error::Result;
use crate::options::ExportFormat;

pub mod csv;
pub mod json;
pub mod markdown;

/// A single output file produced by a renderer.
#[derive(Debug, Clone)]
pub struct ExportFile {
    /// Suggested filename (e.g., "session-abc123.tpx.json").
    pub filename: String,
    /// File content as bytes.
    pub content: Vec<u8>,
    /// MIME type for this file.
    pub mime_type: String,
}

impl ExportFile {
    /// Content as a UTF-8 string (convenience for text formats).
    pub fn as_text(&self) -> Option<&str> {
        std::str::from_utf8(&self.content).ok()
    }
}

/// Trait implemented by each export format renderer.
///
/// The rendering pipeline: `SessionArchive` → `render()` → `Vec<ExportFile>`.
/// Most formats produce a single file; CSV produces multiple.
pub trait ExportRenderer {
    /// The format this renderer produces.
    fn format(&self) -> ExportFormat;

    /// Render the archive to one or more output files.
    fn render(&self, archive: &SessionArchive) -> Result<Vec<ExportFile>>;

    /// Human-readable format name for UI display.
    fn display_name(&self) -> &'static str;

    /// Primary file extension (without leading dot).
    fn extension(&self) -> &'static str;

    /// MIME type for the primary output.
    fn mime_type(&self) -> &'static str;
}

/// Create a renderer for the specified format.
pub fn create_renderer(format: ExportFormat) -> Box<dyn ExportRenderer> {
    match format {
        ExportFormat::Json => Box::new(json::JsonRenderer),
        ExportFormat::Markdown => Box::new(markdown::MarkdownRenderer),
        ExportFormat::Csv => Box::new(csv::CsvRenderer),
    }
}
