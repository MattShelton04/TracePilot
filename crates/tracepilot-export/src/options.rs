//! Export configuration and presets.
//!
//! [`ExportOptions`] controls what format, which sections, and what privacy
//! settings to apply during export. Presets provide common configurations.

use std::collections::HashSet;

use crate::document::SectionId;

/// Available export formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    /// Full-fidelity JSON interchange (`.tpx.json`). Lossless round-trip.
    Json,
    /// Human-readable Markdown document. Lossy but shareable.
    Markdown,
    /// Tabular CSV for analysis. Multi-file output. Lossy.
    Csv,
}

impl ExportFormat {
    /// Primary file extension for this format.
    pub fn extension(&self) -> &'static str {
        match self {
            ExportFormat::Json => "tpx.json",
            ExportFormat::Markdown => "md",
            ExportFormat::Csv => "csv",
        }
    }

    /// MIME type for the primary output file.
    pub fn mime_type(&self) -> &'static str {
        match self {
            ExportFormat::Json => "application/json",
            ExportFormat::Markdown => "text/markdown",
            ExportFormat::Csv => "text/csv",
        }
    }

    /// Human-readable display name.
    pub fn display_name(&self) -> &'static str {
        match self {
            ExportFormat::Json => "TracePilot JSON (.tpx.json)",
            ExportFormat::Markdown => "Markdown (.md)",
            ExportFormat::Csv => "CSV (.csv)",
        }
    }
}

/// Where to write the export output.
#[derive(Debug, Clone)]
pub enum OutputTarget {
    /// Write to a file at the specified path.
    File(std::path::PathBuf),
    /// Return content as a string (for preview or clipboard).
    String,
}

/// Complete export configuration provided by the user.
#[derive(Debug, Clone)]
pub struct ExportOptions {
    /// Output format.
    pub format: ExportFormat,
    /// Which sections to include. Empty set = metadata only.
    pub sections: HashSet<SectionId>,
    /// Where to write the output.
    pub output: OutputTarget,
}

impl ExportOptions {
    /// Create options with all sections included.
    pub fn all(format: ExportFormat) -> Self {
        Self {
            format,
            sections: SectionId::ALL.iter().copied().collect(),
            output: OutputTarget::String,
        }
    }

    /// Create options with no optional sections (metadata only).
    pub fn minimal(format: ExportFormat) -> Self {
        Self {
            format,
            sections: HashSet::new(),
            output: OutputTarget::String,
        }
    }

    /// Preset for sharing: conversation + plan + todos + metrics.
    pub fn sharing(format: ExportFormat) -> Self {
        let sections = [
            SectionId::Conversation,
            SectionId::Plan,
            SectionId::Todos,
            SectionId::Metrics,
        ]
        .into_iter()
        .collect();

        Self {
            format,
            sections,
            output: OutputTarget::String,
        }
    }

    /// Check if a section is included in this export.
    pub fn includes(&self, section: SectionId) -> bool {
        self.sections.contains(&section)
    }
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self::all(ExportFormat::Json)
    }
}
