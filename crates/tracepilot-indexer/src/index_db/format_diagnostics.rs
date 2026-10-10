//! Format drift per source, read from `session_format_observations`, which
//! indexing fills from each session's parse (implementation plan Q3).

use tracepilot_core::provider::SessionSource;
use tracepilot_core::provider::claude_code::version_order;

use super::IndexDb;
use crate::Result;

pub(super) const KIND_RECORD: &str = "record";
pub(super) const KIND_ATTACHMENT: &str = "attachment";
pub(super) const KIND_VERSION: &str = "version";

/// One observed name: how many indexed sessions it appeared in, and in how
/// many of their records.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatNameCount {
    pub name: String,
    pub sessions: u64,
    pub records: u64,
}

/// A source's format drift across its indexed sessions.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FormatDiagnostics {
    /// Indexed sessions of the source.
    pub sessions: u64,
    /// By name.
    pub unmapped_record_types: Vec<FormatNameCount>,
    /// By name.
    pub unmapped_attachment_types: Vec<FormatNameCount>,
    /// Oldest version first.
    pub versions: Vec<FormatNameCount>,
}

impl IndexDb {
    /// The format drift indexing recorded for `source`.
    pub fn format_diagnostics(&self, source: SessionSource) -> Result<FormatDiagnostics> {
        let mut out = FormatDiagnostics {
            sessions: self.conn.query_row(
                "SELECT COUNT(*) FROM sessions WHERE source = ?1",
                [source.as_str()],
                |row| row.get::<_, i64>(0),
            )? as u64,
            ..FormatDiagnostics::default()
        };
        let mut stmt = self.conn.prepare(
            "SELECT o.kind, o.name, COUNT(DISTINCT o.session_id), SUM(o.record_count)
             FROM session_format_observations o
             JOIN sessions s ON s.id = o.session_id
             WHERE s.source = ?1
             GROUP BY o.kind, o.name
             ORDER BY o.kind, o.name",
        )?;
        let rows = stmt.query_map([source.as_str()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                FormatNameCount {
                    name: row.get(1)?,
                    sessions: row.get::<_, i64>(2)?.max(0) as u64,
                    records: row.get::<_, i64>(3)?.max(0) as u64,
                },
            ))
        })?;
        for row in rows {
            let (kind, count) = row?;
            match kind.as_str() {
                KIND_RECORD => out.unmapped_record_types.push(count),
                KIND_ATTACHMENT => out.unmapped_attachment_types.push(count),
                KIND_VERSION => out.versions.push(count),
                _ => {}
            }
        }
        out.versions.sort_by(|a, b| version_order(&a.name, &b.name));
        Ok(out)
    }
}
