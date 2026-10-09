//! Claude Code transcripts → canonical TracePilot events.
//!
//! A session is `projects/<cwd-slug>/<uuid>.jsonl` plus the subagent files in
//! `<uuid>/subagents/`. [`parse_claude_session`] reads them in file order and
//! emits the Copilot-shaped [`TypedEvent`]s the turn reconstructor already
//! understands, so a serialized stream reparses to identical turns.
//! [`ClaudeCodeProvider`] serves them through the `SessionProvider` seam.
//!
//! The record → event mapping and its rules are documented in
//! `docs/research/claude-code-integration/mapping.md` §1; the parser rules the
//! data forces are in `data-comparison.md` §2.
//!
//! Referenced files (`tool-results/`, task output, file history) are never
//! opened, and image base64 never leaves the reader.

mod branch;
mod census;
mod drift;
mod liveness;
mod notify;
pub(crate) mod pricing;
mod privacy;
mod prompts;
mod provider;
mod reader;
mod records;
mod segments;
mod subagents;
mod summary;
mod tool_results;
mod tools;
mod translate;
mod translate_abandoned;
mod translate_assistant;
mod translate_user;
mod usage;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::path::Path;

use crate::error::Result;
use crate::parsing::diagnostics::ParseDiagnostics;
use crate::parsing::events::TypedEvent;

pub use census::{FormatCensus, format_census};
pub use drift::{safe_type_name, safe_version, version_order};
pub use liveness::{ProcessStart, StalePidFiles};
pub(crate) use privacy::redact_record;
pub use provider::ClaudeCodeProvider;
pub use usage::{ClaudeCallUsage, CostModelUsage, CostSnapshot, TokenTotals, sum_calls_by_model};

/// Everything parsed from one Claude Code session.
#[derive(Debug, Clone)]
pub struct ClaudeParse {
    /// Canonical TracePilot events in emission order. `raw.data` always holds the
    /// Copilot-shaped payload for `raw.event_type`, never the native record.
    pub events: Vec<TypedEvent>,
    /// Where each event's native record (`raw.native`) sits, aligned with
    /// `events`. `None` for synthesized events.
    pub positions: Vec<Option<NativePosition>>,
    /// One entry per `message.id` (last record wins), in first-seen order.
    pub calls: Vec<ClaudeCallUsage>,
    /// Every distinct `cost-state` snapshot in the main file, in file order.
    /// Snapshots are cumulative across resumes; the last one plus the tail
    /// ([`ClaudeParse::tail_calls`]) is the current total.
    pub cost_snapshots: Vec<CostSnapshot>,
    pub diagnostics: ClaudeDiagnostics,
}

impl ClaudeParse {
    /// Calls the last snapshot does not cover: those anchored after it in the
    /// main file. All calls when there is no snapshot. Calls of orphan
    /// subagents have no anchor and are excluded; see `orphan_subagents`.
    pub fn tail_calls(&self) -> impl Iterator<Item = &ClaudeCallUsage> {
        let covered = self.cost_snapshots.last().map(|s| s.line);
        self.calls
            .iter()
            .filter(move |call| match (covered, call.snapshot_anchor) {
                (Some(line), Some(anchor)) => anchor > line,
                (None, Some(_)) => true,
                (_, None) => false,
            })
    }
}

/// Where an event's native record came from. The record itself is in
/// `RawEvent.native`; this annotation has no field there yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativePosition {
    /// 1-based line in its file.
    pub line: usize,
    /// `None` for the main transcript, else the subagent file's agent id.
    /// This can differ from `raw.agent_id`: a hand-back in the main file is
    /// attributed to the subagent that sent it.
    pub file_agent_id: Option<String>,
    /// The record is on a rewound (abandoned) branch: shown on the Events tab,
    /// left out of Conversation.
    pub abandoned: bool,
}

/// Shared parse diagnostics plus Claude-specific counters.
#[derive(Debug, Clone, Default)]
pub struct ClaudeDiagnostics {
    /// Typed-event counters for the emitted stream, as `parse_typed_events`
    /// reports them for a Copilot file.
    pub events: ParseDiagnostics,
    /// Lines that are not a JSON object, in any file of the session.
    pub malformed_lines: usize,
    /// Files whose last line was cut off mid-write (tolerated, not an error).
    pub partial_tails: usize,
    /// Lines longer than the reader's bound, skipped without being buffered.
    pub oversized_lines: usize,
    /// Thinking blocks with no visible text (signature only).
    pub redacted_thinking: usize,
    /// Subagent files with no launching `Agent` call to attach to.
    pub orphan_subagents: usize,
    /// Notification carriers after the first for the same completion.
    pub duplicate_notifications: usize,
    /// `tool_use` blocks whose call ended without a `tool_result`.
    pub missing_tool_results: usize,
    /// Records on rewound branches.
    pub abandoned_records: usize,
    /// `parentUuid`/`logicalParentUuid` walks stopped by the cycle guard.
    pub parent_cycles: usize,
    /// Image payloads replaced by a size marker.
    pub sanitized_images: usize,
    /// Tool results whose full output lives in a `tool-results/` file.
    pub persisted_outputs: usize,
    /// `cost-state` records read, including repeats of the same totals.
    pub cost_state_records: usize,
    /// Record types with no mapping, by safe name (`drift::safe_type_name`).
    pub unknown_record_types: BTreeMap<String, usize>,
    /// Attachment types not seen before, by safe name.
    pub unknown_attachment_types: BTreeMap<String, usize>,
    /// Records per Claude Code `version`, by safe version (`drift::safe_version`).
    pub versions: BTreeMap<String, usize>,
}

/// Parse one Claude Code session: the main transcript at `main` and any
/// subagent files in `<main without .jsonl>/subagents/`.
///
/// `is_cancelled` is checked per line, like `parse_typed_events_cancellable`.
pub fn parse_claude_session(main: &Path, is_cancelled: &impl Fn() -> bool) -> Result<ClaudeParse> {
    let mut diagnostics = ClaudeDiagnostics::default();
    let main_lines = reader::read_jsonl(main, is_cancelled, &mut diagnostics)?;
    let children = subagents::load(main, is_cancelled, &mut diagnostics)?;
    translate::translate(main_lines, children, is_cancelled, diagnostics)
}
