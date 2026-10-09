//! Per-source format diagnostics (implementation plan Q3): the record and
//! attachment types a source's parser has no mapping for, and the producer
//! versions seen, as indexing recorded them. Nothing is reparsed here.

use serde::Serialize;
use tracepilot_core::provider::SessionSource;
use tracepilot_indexer::index_db::{FormatDiagnostics, FormatNameCount, IndexDb};

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;

/// One observed name across the source's indexed sessions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormatNameCountDto {
    /// A type name or a version; never a path, an id or content.
    pub name: String,
    pub sessions: u32,
    pub records: u32,
}

/// A source's format drift across its indexed sessions.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceFormatDiagnostics {
    /// Indexed sessions of the source.
    pub sessions: u32,
    pub unmapped_record_types: Vec<FormatNameCountDto>,
    pub unmapped_attachment_types: Vec<FormatNameCountDto>,
    /// Oldest version first.
    pub versions: Vec<FormatNameCountDto>,
}

impl From<FormatDiagnostics> for SourceFormatDiagnostics {
    fn from(value: FormatDiagnostics) -> Self {
        let list = |rows: Vec<FormatNameCount>| {
            rows.into_iter()
                .map(|row| FormatNameCountDto {
                    name: row.name,
                    sessions: saturate(row.sessions),
                    records: saturate(row.records),
                })
                .collect()
        };
        Self {
            sessions: saturate(value.sessions),
            unmapped_record_types: list(value.unmapped_record_types),
            unmapped_attachment_types: list(value.unmapped_attachment_types),
            versions: list(value.versions),
        }
    }
}

fn saturate(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// The format drift indexing recorded for `source`; empty before the first
/// index and for sources that report none (Copilot).
#[tauri::command]
#[tracing::instrument(skip_all, fields(source = source.as_str()))]
#[specta::specta]
pub async fn get_source_format_diagnostics(
    state: tauri::State<'_, SharedConfig>,
    source: SessionSource,
) -> CmdResult<SourceFormatDiagnostics> {
    let index_path = read_config(&state).index_db_path();
    blocking_cmd!({
        if !index_path.exists() {
            return Ok(SourceFormatDiagnostics::default());
        }
        let db = IndexDb::open_readonly(&index_path)?;
        Ok::<_, BindingsError>(db.format_diagnostics(source)?.into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_convert_with_saturating_counts() {
        let dto: SourceFormatDiagnostics = FormatDiagnostics {
            sessions: 2,
            unmapped_record_types: vec![FormatNameCount {
                name: "brand-new-record".into(),
                sessions: 1,
                records: u64::MAX,
            }],
            unmapped_attachment_types: Vec::new(),
            versions: Vec::new(),
        }
        .into();
        assert_eq!(dto.sessions, 2);
        assert_eq!(dto.unmapped_record_types[0].records, u32::MAX);
        let json = serde_json::to_value(&dto).unwrap();
        assert!(json.get("unmappedRecordTypes").is_some());
    }
}
