//! Source-neutral types shared by every session provider.
//!
//! Types that will cross IPC derive `specta::Type` behind the `specta`
//! feature. [`SessionLocator`] and [`SourceFingerprint`] stay backend-only:
//! the index stores them, and IPC sees only ids and an opaque version.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[cfg(feature = "specta")]
use specta::Type;

use crate::ids::SessionId;
use crate::models::conversation::ConversationTurn;
use crate::models::event_types::{CodeChanges, ModelMetricDetail};
use crate::models::session_summary::{SessionSummary, ShutdownMetrics};
use crate::parsing::checkpoints::CheckpointIndex;
use crate::parsing::diagnostics::ParseDiagnostics;
use crate::parsing::events::TypedEvent;
use crate::parsing::rewind_snapshots::RewindIndex;
use crate::parsing::session_db::{TodoDep, TodoItem};
use crate::parsing::snapshot::FileFingerprint;

/// Which tool wrote a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub enum SessionSource {
    Copilot,
    ClaudeCode,
}

impl SessionSource {
    /// Every source, in a stable order.
    pub const ALL: [Self; 2] = [Self::Copilot, Self::ClaudeCode];

    /// The stored name, matching the serde wire name (`sessions.source`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Copilot => "copilot",
            Self::ClaudeCode => "claudeCode",
        }
    }

    /// Parse a stored name written by [`Self::as_str`].
    pub fn from_stored(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|source| source.as_str() == name)
    }
}

/// A session's place in its family. Drives default visibility.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub enum SessionRole {
    /// A session the user started. Copilot sessions are always primary.
    #[default]
    Primary,
    /// A child thread listed separately from its parent.
    Subagent,
    /// An automatic reviewer thread, hidden by default.
    Guardian,
}

impl SessionRole {
    /// The stored name, matching the serde wire name (`sessions.role`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Subagent => "subagent",
            Self::Guardian => "guardian",
        }
    }

    /// Parse a stored name written by [`Self::as_str`].
    pub fn from_stored(name: &str) -> Option<Self> {
        [Self::Primary, Self::Subagent, Self::Guardian]
            .into_iter()
            .find(|role| role.as_str() == name)
    }

    /// Whether lists hide sessions with this role by default.
    pub fn hidden_by_default(self) -> bool {
        matches!(self, Self::Guardian)
    }
}

/// What a source supports. Static per source; a provider may narrow it per
/// session. Gates tabs, IPC commands and KPIs.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub struct SourceCapabilities {
    pub can_resume: bool,
    pub can_launch: bool,
    pub can_steer: bool,
    pub has_aic: bool,
    pub has_premium_requests: bool,
    pub has_context_breakdown: bool,
    pub has_todos: bool,
    pub has_checkpoints: bool,
    pub has_plan: bool,
    pub has_explorer: bool,
    pub has_hidden_roles: bool,
}

/// What a running session's process is doing, when the source records it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Busy,
    Waiting,
}

/// Whether a live process owns a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Liveness {
    /// A live process owns the session. Fields are `None` when the source
    /// does not record them.
    Running {
        pid: Option<u32>,
        status: Option<RunStatus>,
    },
    /// No live process owns the session.
    Idle,
    /// The source cannot tell.
    Unknown,
}

/// What the index stores and IPC resolves a session id to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLocator {
    pub source: SessionSource,
    /// Native id; every supported source uses UUIDs.
    pub id: SessionId,
    /// The session directory (Copilot) or main transcript file. Stored in
    /// `sessions.path`.
    pub primary_path: PathBuf,
    /// The parent session when a family is listed rather than folded.
    pub parent_id: Option<SessionId>,
    pub role: SessionRole,
    /// Approximate bytes a full load reads, for batch sizing. 0 when the
    /// source has nothing to parse yet.
    pub source_bytes_hint: u64,
}

/// Identity of every file a snapshot reads, captured before reading.
///
/// `files` is sorted by path; `None` marks an optional file that is absent.
/// `version_token` carries provider-opaque state, such as a metadata row
/// version, that file metadata alone would miss.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFingerprint {
    pub files: Vec<(PathBuf, Option<FileFingerprint>)>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_token: Option<String>,
}

impl SourceFingerprint {
    /// Build a fingerprint, sorting `files` by path.
    pub fn new(
        mut files: Vec<(PathBuf, Option<FileFingerprint>)>,
        version_token: Option<String>,
    ) -> Self {
        files.sort_by(|a, b| a.0.cmp(&b.0));
        Self {
            files,
            version_token,
        }
    }

    /// An opaque token that changes whenever the fingerprint does. Caches
    /// and the frontend compare it only for equality.
    pub fn source_version(&self) -> String {
        let mut hasher = Sha256::new();
        for (path, file) in &self.files {
            let path = path.as_os_str().as_encoded_bytes();
            hasher.update((path.len() as u64).to_le_bytes());
            hasher.update(path);
            match file {
                None => hasher.update([0]),
                Some(file) => {
                    hasher.update([1]);
                    hasher.update(file.size.to_le_bytes());
                    // Times before the epoch hash with a different tag, so
                    // they never collide with the same offset after it.
                    let (tag, offset) = match file.modified.duration_since(UNIX_EPOCH) {
                        Ok(after) => (1u8, after),
                        Err(before) => (2u8, before.duration()),
                    };
                    hasher.update([tag]);
                    hasher.update(offset.as_secs().to_le_bytes());
                    hasher.update(offset.subsec_nanos().to_le_bytes());
                }
            }
        }
        match &self.version_token {
            None => hasher.update([0]),
            Some(token) => {
                hasher.update([1]);
                hasher.update(token.as_bytes());
            }
        }
        let digest = hasher.finalize();
        digest[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }
}

/// Who produced a cost figure, and whether it is a bill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub enum CostBasis {
    /// The provider reports it as charged usage.
    Billed,
    /// The provider's own estimate, not a bill.
    ProviderEstimate,
    /// TracePilot priced recorded usage from its pricing registry.
    TracepilotEstimate,
}

/// The unit of a cost figure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub enum CostUnit {
    Aic,
    Usd,
}

/// A cost amount with its unit and basis. Absent costs are `None`, never 0.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostFigure {
    pub amount: f64,
    pub unit: CostUnit,
    pub basis: CostBasis,
}

/// Session totals reported by a provider that has no `session.shutdown`.
#[derive(Debug, Clone, Default)]
pub struct SessionMetrics {
    pub total_api_duration_ms: Option<u64>,
    pub total_api_duration_without_retries_ms: Option<u64>,
    pub total_tool_duration_ms: Option<u64>,
    pub total_duration_ms: Option<u64>,
    /// Epoch milliseconds.
    pub session_start_time: Option<u64>,
    pub current_model: Option<String>,
    pub model_metrics: HashMap<String, ModelMetricDetail>,
    pub code_changes: Option<CodeChanges>,
    pub cost: Option<CostFigure>,
    pub coverage: Option<MetricsCoverage>,
    /// Cost per model in `cost`'s unit. A model is absent when it cannot be
    /// priced.
    pub model_costs: HashMap<String, f64>,
    /// Usage per run, in file order, for per-day analytics. Their tokens add
    /// up to `model_metrics` while the source's counters only grow. Empty
    /// when the source records no run boundaries.
    pub segments: Vec<MetricsSegment>,
}

/// The usage of one run of a session: between two provider snapshots, or
/// after the last one (`partial`). Durable index rows only; never IPC.
#[derive(Debug, Clone)]
pub struct MetricsSegment {
    pub start: chrono::DateTime<chrono::Utc>,
    pub end: chrono::DateTime<chrono::Utc>,
    /// Recorded calls; side models have none.
    pub requests: u64,
    pub api_duration_ms: Option<u64>,
    pub model_metrics: HashMap<String, ModelMetricDetail>,
    pub cost: Option<CostFigure>,
    /// Recorded calls after the last snapshot, which cannot prove completeness.
    pub partial: bool,
}

/// Coverage of provider totals. Recorded calls cannot prove that all usage
/// was persisted or that a session ended. Request counts cover recorded calls
/// only; durations and line counts cover the snapshot when one is available.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsCoverage {
    pub partial: bool,
    pub snapshot_line: Option<usize>,
    pub recorded_calls: usize,
    pub tail_calls: usize,
    /// Cost of the covered snapshot, retained separately when the current
    /// total cannot be priced (C11). Never treated as the cost of the tail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_cost: Option<CostFigure>,
}

impl From<SessionMetrics> for ShutdownMetrics {
    /// AIC and premium requests stay `None`: only Copilot reports them.
    fn from(metrics: SessionMetrics) -> Self {
        Self {
            total_api_duration_ms: metrics.total_api_duration_ms,
            total_api_duration_without_retries_ms: metrics.total_api_duration_without_retries_ms,
            total_tool_duration_ms: metrics.total_tool_duration_ms,
            total_duration_ms: metrics.total_duration_ms,
            session_start_time: metrics.session_start_time,
            current_model: metrics.current_model,
            model_metrics: metrics.model_metrics,
            code_changes: metrics.code_changes,
            cost_amount: metrics.cost.map(|cost| cost.amount),
            cost_unit: metrics.cost.map(|cost| cost.unit),
            cost_basis: metrics.cost.map(|cost| cost.basis),
            coverage: metrics.coverage,
            ..Self::default()
        }
    }
}

/// The source record behind a normalized event, sanitized: no image data
/// and no file contents. `RawEvent.data` stays canonical.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRecord {
    pub source: SessionSource,
    pub record_type: String,
    pub data: Value,
}

/// Everything one load of a session produces.
pub struct ProviderSnapshot {
    pub summary: SessionSummary,
    /// Normalized events; `None` when the source has no event log yet.
    pub events: Option<Vec<TypedEvent>>,
    /// Turns reconstructed while building the summary, kept for reuse.
    pub turns: Option<Vec<ConversationTurn>>,
    /// Provider-reported totals; `None` for Copilot, whose totals come from
    /// `session.shutdown`.
    pub metrics: Option<SessionMetrics>,
    pub diagnostics: Option<ParseDiagnostics>,
    /// Read before parsing. A strict load certifies the files did not change.
    pub fingerprint: SourceFingerprint,
}

/// A session's events without its summary.
pub struct ProviderEvents {
    /// Normalized events; `None` when the source has no event log yet.
    pub events: Option<Vec<TypedEvent>>,
    /// Read before parsing; a successful load certifies the files did not
    /// change.
    pub fingerprint: SourceFingerprint,
}

/// A source's todo list.
#[derive(Debug, Clone)]
pub struct TodoList {
    pub items: Vec<TodoItem>,
    /// `None` when the source has no dependency data.
    pub deps: Option<Vec<TodoDep>>,
}

/// Side files a session may have. Absent artifacts are `None` or empty.
#[derive(Debug, Clone, Default)]
pub struct SessionArtifacts {
    pub todos: Option<TodoList>,
    pub plan: Option<PathBuf>,
    pub checkpoints: Option<CheckpointIndex>,
    pub rewind: Option<RewindIndex>,
    /// Directories the file browser and image preview may read.
    pub file_roots: Vec<PathBuf>,
}
