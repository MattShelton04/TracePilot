//! Canonical intermediate representation for export/import.
//!
//! [`SessionArchive`] is the single data structure that all renderers consume
//! and all importers produce. It is format-agnostic — the builder populates it
//! from session directories, and renderers translate it to JSON, Markdown, etc.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::schema::SchemaVersion;

// ── Re-export core types that already have Serialize + Deserialize ───────────

pub use tracepilot_core::models::conversation::{
    AttributedMessage, ConversationTurn, SessionEventSeverity, TurnSessionEvent, TurnToolCall,
};
pub use tracepilot_core::models::session_summary::ShutdownMetrics;
pub use tracepilot_core::parsing::diagnostics::{DeserFailureInfo, EventParseWarning};
pub use tracepilot_core::parsing::events::RawEvent;
pub use tracepilot_core::parsing::rewind_snapshots::{RewindIndex, RewindSnapshot};

// ── Top-level archive ───────────────────────────────────────────────────────

/// The canonical intermediate representation for export/import.
///
/// All format renderers consume this; the builder creates it from session data;
/// the importer parses it back. The neutral name reflects its dual role.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionArchive {
    pub header: ArchiveHeader,
    pub sessions: Vec<PortableSession>,
    pub export_options: ArchiveOptionsRecord,
}

/// Metadata about the archive itself (when/how it was created).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveHeader {
    /// Schema version of this archive.
    pub schema_version: SchemaVersion,
    /// When the export was created.
    pub exported_at: DateTime<Utc>,
    /// Identifier of the exporting application (e.g., "TracePilot v0.5.1").
    pub exported_by: String,
    /// Information about the source system.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_system: Option<SourceSystem>,
    /// SHA-256 hash of the serialized sessions array for integrity verification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    /// Minimum reader version required to import this file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minimum_reader_version: Option<SchemaVersion>,
}

/// Information about the system that produced the export.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSystem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone_offset: Option<String>,
}

/// Record of the options used when this archive was created.
/// Stored in the archive so importers know what was included/excluded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveOptionsRecord {
    pub format: String,
    pub included_sections: Vec<SectionId>,
    pub redaction_applied: bool,
}

// ── Session data ────────────────────────────────────────────────────────────

/// A single session within the archive, with optional sections.
///
/// Metadata is always present. Other sections are included based on the user's
/// export configuration. The `available_sections` manifest lists what's present,
/// so importers can distinguish "not included" from "empty".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableSession {
    /// Core identity and context — always included.
    pub metadata: PortableSessionMetadata,

    /// Which sections are present in this export (capability manifest).
    pub available_sections: Vec<SectionId>,

    // ── Optional sections ──────────────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation: Option<Vec<ConversationTurn>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<RawEvent>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub todos: Option<TodoExport>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoints: Option<Vec<CheckpointExport>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewind_snapshots: Option<RewindIndex>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub shutdown_metrics: Option<ShutdownMetrics>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub incidents: Option<Vec<IncidentExport>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_tables: Option<Vec<CustomTableExport>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_diagnostics: Option<ParseDiagnosticsExport>,

    /// Extension point for future data without a schema bump.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<serde_json::Value>,
}

// ── Portable metadata ───────────────────────────────────────────────────────

/// Dedicated metadata for export — decoupled from `SessionSummary` to allow
/// independent evolution of the interchange schema vs the UI model.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableSessionMetadata {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_count: Option<u32>,
    /// Import provenance chain — tracks export/import lineage.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lineage: Option<Vec<LineageEntry>>,
}

/// Tracks the export/import history of a session for provenance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineageEntry {
    pub action: LineageAction,
    pub timestamp: DateTime<Utc>,
    pub schema_version: SchemaVersion,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_info: Option<String>,
}

/// Whether a lineage entry records an export or import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineageAction {
    Export,
    Import,
}

// ── Section identifier ──────────────────────────────────────────────────────

/// Identifies an exportable section of session data.
///
/// Used in `ExportOptions` to select which sections to include, and in
/// `PortableSession::available_sections` to declare what's present.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SectionId {
    Conversation,
    Events,
    Todos,
    Plan,
    Checkpoints,
    RewindSnapshots,
    Metrics,
    Incidents,
    CustomTables,
    ParseDiagnostics,
}

impl SectionId {
    /// All section variants, useful for "include everything" presets.
    pub const ALL: &'static [SectionId] = &[
        SectionId::Conversation,
        SectionId::Events,
        SectionId::Todos,
        SectionId::Plan,
        SectionId::Checkpoints,
        SectionId::RewindSnapshots,
        SectionId::Metrics,
        SectionId::Incidents,
        SectionId::CustomTables,
        SectionId::ParseDiagnostics,
    ];

    /// Human-readable display name for UI.
    pub fn display_name(&self) -> &'static str {
        match self {
            SectionId::Conversation => "Conversation",
            SectionId::Events => "Raw Events",
            SectionId::Todos => "Todos",
            SectionId::Plan => "Plan",
            SectionId::Checkpoints => "Checkpoints",
            SectionId::RewindSnapshots => "Rewind Snapshots",
            SectionId::Metrics => "Shutdown Metrics",
            SectionId::Incidents => "Incidents",
            SectionId::CustomTables => "Custom Tables",
            SectionId::ParseDiagnostics => "Parse Diagnostics",
        }
    }
}

// ── Export-specific section types ───────────────────────────────────────────
// These wrap core types that lack Deserialize, giving us both Serialize +
// Deserialize for round-trip through the JSON interchange format.

/// Todos and their dependency graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoExport {
    pub items: Vec<TodoItemExport>,
    pub deps: Vec<TodoDepExport>,
}

/// A single todo item (mirrors core `TodoItem` with both Serialize + Deserialize).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItemExport {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// A todo dependency edge (mirrors core `TodoDep`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoDepExport {
    pub todo_id: String,
    pub depends_on: String,
}

/// A checkpoint entry (mirrors core `CheckpointEntry` with Deserialize).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointExport {
    pub number: u32,
    pub title: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

/// A session incident extracted from events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentExport {
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<DateTime<Utc>>,
    pub severity: String,
    pub summary: String,
}

/// An arbitrary table from session.db (mirrors core `CustomTableInfo`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTableExport {
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<std::collections::HashMap<String, serde_json::Value>>,
}

/// Parse quality diagnostics for the session's events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseDiagnosticsExport {
    pub total_events: usize,
    pub malformed_lines: usize,
    pub unknown_event_types: usize,
    pub deserialization_failures: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<EventParseWarning>>,
}
