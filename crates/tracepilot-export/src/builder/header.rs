use chrono::Utc;

use crate::document::{ArchiveHeader, ArchiveOptionsRecord, SourceSystem};
use crate::options::{ExportFormat, ExportOptions};
use crate::schema;

pub(super) fn build_header(_options: &ExportOptions) -> ArchiveHeader {
    ArchiveHeader {
        schema_version: schema::CURRENT_VERSION,
        exported_at: Utc::now(),
        exported_by: format!("TracePilot v{}", env!("CARGO_PKG_VERSION")),
        source_system: Some(build_source_system()),
        content_hash: None, // Set by the renderer after serialization
        minimum_reader_version: Some(schema::MINIMUM_READER_VERSION),
    }
}

fn build_source_system() -> SourceSystem {
    SourceSystem {
        os: Some(std::env::consts::OS.to_string()),
        hostname_hash: None, // Phase C: redaction will populate this
        timezone_offset: None,
    }
}

pub(super) fn build_options_record(options: &ExportOptions) -> ArchiveOptionsRecord {
    ArchiveOptionsRecord {
        format: match options.format {
            ExportFormat::Json => "json".to_string(),
            ExportFormat::Markdown => "markdown".to_string(),
            ExportFormat::Csv => "csv".to_string(),
        },
        included_sections: options.sections.iter().copied().collect(),
        redaction_applied: false, // Phase C: redaction
    }
}
