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

/// Controls how much detail is included for conversation content.
///
/// These toggles let users reduce export verbosity without removing entire
/// sections.  For example, a "team report" might collapse subagent internals
/// while still showing the conversation flow.
#[derive(Debug, Clone)]
pub struct ContentDetailOptions {
    /// When `true`, subagent tool calls include their full internal tool calls,
    /// reasoning, and assistant messages.  When `false`, only the subagent's
    /// top-level entry (name + final result) is kept.
    pub include_subagent_internals: bool,

    /// When `true`, tool calls include their full `arguments` and
    /// `result_content`.  When `false`, only tool name, status, duration,
    /// and summary are preserved.
    pub include_tool_details: bool,

    /// When `true`, tool call `result_content` includes the full result from
    /// the event stream instead of the default 1 KB truncated preview.
    /// Can produce significantly larger exports.
    pub include_full_tool_results: bool,
}

impl Default for ContentDetailOptions {
    fn default() -> Self {
        Self {
            include_subagent_internals: true,
            include_tool_details: true,
            include_full_tool_results: false,
        }
    }
}

/// Controls which categories of sensitive data are redacted before export.
///
/// Each flag enables a set of regex-based patterns that replace matches with
/// placeholder text (e.g., `<REDACTED_PATH>`). All flags default to `false`
/// (no redaction), making exports fully transparent by default.
#[derive(Debug, Clone)]
pub struct RedactionOptions {
    /// Replace filesystem paths (Windows, Unix home, system dirs) with `<REDACTED_PATH>`.
    pub anonymize_paths: bool,
    /// Replace API keys, tokens, passwords, and env-var secrets with `<REDACTED_*>`.
    pub strip_secrets: bool,
    /// Replace email addresses and IPv4 addresses with `<REDACTED_*>`.
    pub strip_pii: bool,
}

impl RedactionOptions {
    /// Returns `true` if any redaction category is enabled.
    pub fn has_any(&self) -> bool {
        self.anonymize_paths || self.strip_secrets || self.strip_pii
    }
}

impl Default for RedactionOptions {
    fn default() -> Self {
        Self {
            anonymize_paths: false,
            strip_secrets: false,
            strip_pii: false,
        }
    }
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
    /// Controls verbosity of conversation content.
    pub content_detail: ContentDetailOptions,
    /// Controls which categories of sensitive data are scrubbed.
    pub redaction: RedactionOptions,
}

impl ExportOptions {
    /// Create options with all sections included and full detail.
    pub fn all(format: ExportFormat) -> Self {
        Self {
            format,
            sections: SectionId::ALL.iter().copied().collect(),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions::default(),
        }
    }

    /// Create options with no optional sections (metadata only).
    pub fn minimal(format: ExportFormat) -> Self {
        Self {
            format,
            sections: HashSet::new(),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions::default(),
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
            content_detail: ContentDetailOptions::default(),
            redaction: RedactionOptions::default(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_detail_defaults_include_everything() {
        let opts = ContentDetailOptions::default();
        assert!(opts.include_subagent_internals);
        assert!(opts.include_tool_details);
        assert!(!opts.include_full_tool_results);
    }

    #[test]
    fn export_options_all_has_default_detail() {
        let opts = ExportOptions::all(ExportFormat::Json);
        assert!(opts.content_detail.include_subagent_internals);
        assert!(opts.content_detail.include_tool_details);
        assert!(!opts.content_detail.include_full_tool_results);
    }
}
