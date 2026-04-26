//! Typed event deserialization — turns [`RawEvent`] envelopes into [`TypedEvent`]s.

use super::raw::{RawEvent, parse_events_jsonl};
use crate::error::Result;
use crate::models::event_types::{
    AbortData, AssistantMessageData, AssistantReasoningData, CompactionCompleteData,
    CompactionStartData, HookEndData, HookStartData, ModelChangeData, PlanChangedData,
    SessionContext, SessionErrorData, SessionEventType, SessionHandoffData,
    SessionImportLegacyData, SessionInfoData, SessionModeChangedData,
    SessionRemoteSteerableChangedData, SessionResumeData, SessionStartData,
    SessionTaskCompleteData, SessionTruncationData, SessionWarningData, ShutdownData,
    SkillInvokedData, SubagentCompletedData, SubagentDeselectedData, SubagentFailedData,
    SubagentSelectedData, SubagentStartedData, SystemMessageData, SystemNotificationData,
    ToolExecCompleteData, ToolExecStartData, ToolUserRequestedData, TurnEndData, TurnStartData,
    UserMessageData, WorkspaceFileChangedData,
};
use crate::parsing::diagnostics::{EventParseWarning, ParseDiagnostics};
use serde_json::Value;
use std::path::Path;

/// A fully typed event with parsed data.
#[derive(Debug, Clone)]
pub struct TypedEvent {
    pub raw: RawEvent,
    pub event_type: SessionEventType,
    pub typed_data: TypedEventData,
}

/// Typed variants for known event data, with `Other` as a catch-all.
///
/// Each variant corresponds to a [`SessionEventType`] and wraps a strongly-typed
/// data struct. When deserialization of the typed struct fails (e.g. due to schema
/// evolution), the raw JSON `Value` is preserved as `Other`.
#[derive(Debug, Clone)]
pub enum TypedEventData {
    SessionStart(SessionStartData),
    SessionShutdown(ShutdownData),
    UserMessage(UserMessageData),
    AssistantMessage(AssistantMessageData),
    TurnStart(TurnStartData),
    TurnEnd(TurnEndData),
    ToolExecutionStart(ToolExecStartData),
    ToolExecutionComplete(ToolExecCompleteData),
    SubagentStarted(SubagentStartedData),
    SubagentCompleted(SubagentCompletedData),
    SubagentFailed(SubagentFailedData),
    CompactionComplete(CompactionCompleteData),
    CompactionStart(CompactionStartData),
    ModelChange(ModelChangeData),
    SessionError(SessionErrorData),
    SessionResume(SessionResumeData),
    SystemNotification(SystemNotificationData),
    SkillInvoked(SkillInvokedData),
    Abort(AbortData),
    PlanChanged(PlanChangedData),
    SessionInfo(SessionInfoData),
    ContextChanged(SessionContext),
    WorkspaceFileChanged(WorkspaceFileChangedData),
    ToolUserRequested(ToolUserRequestedData),
    // New typed variants
    SessionTruncation(SessionTruncationData),
    AssistantReasoning(AssistantReasoningData),
    SystemMessage(SystemMessageData),
    SessionWarning(SessionWarningData),
    SessionModeChanged(SessionModeChangedData),
    SessionTaskComplete(SessionTaskCompleteData),
    SubagentSelected(SubagentSelectedData),
    SubagentDeselected(SubagentDeselectedData),
    HookStart(HookStartData),
    HookEnd(HookEndData),
    SessionHandoff(SessionHandoffData),
    SessionImportLegacy(SessionImportLegacyData),
    SessionRemoteSteerableChanged(SessionRemoteSteerableChangedData),
    Other(Value),
}

/// Result of parsing an `events.jsonl` file.
///
/// Contains both the typed events and parsing diagnostics (unknown event types,
/// deserialization failures, malformed line counts). Callers that only need events
/// can access `.events` directly.
pub struct ParsedEvents {
    /// The parsed and typed events.
    pub events: Vec<TypedEvent>,
    /// Diagnostics about parsing issues encountered.
    pub diagnostics: ParseDiagnostics,
}

/// Deserialize the `data` field of a [`RawEvent`] into the appropriate typed variant.
///
/// Returns `(typed_data, optional_warning)`. On success, the warning is `None`.
/// On failure (unknown type or deserialization error), the raw JSON `Value` is
/// preserved as [`TypedEventData::Other`] and a warning is returned.
///
/// The `ContextChanged` variant wraps `SessionContext` — the same struct used
/// by `session.start` and `session.resume`.
pub(crate) fn typed_data_from_raw(
    event_type: &SessionEventType,
    data: &Value,
) -> (TypedEventData, Option<EventParseWarning>) {
    /// Helper: attempt deserialization, return warning on failure.
    ///
    /// Uses `&Value` as a `Deserializer` directly — no clone on the success path.
    /// The clone is deferred to the error fallback, which is rare in practice.
    macro_rules! try_deser {
        ($variant:ident, $data_type:ty, $wire:expr, $data:expr) => {{
            match <$data_type as serde::de::Deserialize>::deserialize($data) {
                Ok(typed) => (TypedEventData::$variant(typed), None),
                Err(e) => (
                    TypedEventData::Other($data.clone()),
                    Some(EventParseWarning::DeserializationFailed {
                        event_type: $wire.to_string(),
                        error: e.to_string(),
                    }),
                ),
            }
        }};
    }

    match event_type {
        SessionEventType::SessionStart => {
            try_deser!(SessionStart, SessionStartData, "session.start", data)
        }
        SessionEventType::SessionShutdown => {
            try_deser!(SessionShutdown, ShutdownData, "session.shutdown", data)
        }
        SessionEventType::UserMessage => {
            try_deser!(UserMessage, UserMessageData, "user.message", data)
        }
        SessionEventType::AssistantMessage => {
            try_deser!(
                AssistantMessage,
                AssistantMessageData,
                "assistant.message",
                data
            )
        }
        SessionEventType::AssistantTurnStart => {
            try_deser!(TurnStart, TurnStartData, "assistant.turn_start", data)
        }
        SessionEventType::AssistantTurnEnd => {
            try_deser!(TurnEnd, TurnEndData, "assistant.turn_end", data)
        }
        SessionEventType::ToolExecutionStart => {
            try_deser!(
                ToolExecutionStart,
                ToolExecStartData,
                "tool.execution_start",
                data
            )
        }
        SessionEventType::ToolExecutionComplete => {
            try_deser!(
                ToolExecutionComplete,
                ToolExecCompleteData,
                "tool.execution_complete",
                data
            )
        }
        SessionEventType::SubagentStarted => {
            try_deser!(
                SubagentStarted,
                SubagentStartedData,
                "subagent.started",
                data
            )
        }
        SessionEventType::SubagentCompleted => {
            try_deser!(
                SubagentCompleted,
                SubagentCompletedData,
                "subagent.completed",
                data
            )
        }
        SessionEventType::SubagentFailed => {
            try_deser!(SubagentFailed, SubagentFailedData, "subagent.failed", data)
        }
        SessionEventType::SessionCompactionComplete => {
            try_deser!(
                CompactionComplete,
                CompactionCompleteData,
                "session.compaction_complete",
                data
            )
        }
        SessionEventType::SessionCompactionStart => {
            try_deser!(
                CompactionStart,
                CompactionStartData,
                "session.compaction_start",
                data
            )
        }
        SessionEventType::SessionModelChange => {
            try_deser!(ModelChange, ModelChangeData, "session.model_change", data)
        }
        SessionEventType::SessionError => {
            try_deser!(SessionError, SessionErrorData, "session.error", data)
        }
        SessionEventType::SessionResume => {
            try_deser!(SessionResume, SessionResumeData, "session.resume", data)
        }
        SessionEventType::SystemNotification => {
            try_deser!(
                SystemNotification,
                SystemNotificationData,
                "system.notification",
                data
            )
        }
        SessionEventType::SkillInvoked => {
            try_deser!(SkillInvoked, SkillInvokedData, "skill.invoked", data)
        }
        SessionEventType::Abort => {
            try_deser!(Abort, AbortData, "abort", data)
        }
        SessionEventType::SessionPlanChanged => {
            try_deser!(PlanChanged, PlanChangedData, "session.plan_changed", data)
        }
        SessionEventType::SessionInfo => {
            try_deser!(SessionInfo, SessionInfoData, "session.info", data)
        }
        SessionEventType::SessionContextChanged => {
            try_deser!(
                ContextChanged,
                SessionContext,
                "session.context_changed",
                data
            )
        }
        SessionEventType::SessionWorkspaceFileChanged => {
            try_deser!(
                WorkspaceFileChanged,
                WorkspaceFileChangedData,
                "session.workspace_file_changed",
                data
            )
        }
        SessionEventType::ToolUserRequested => {
            try_deser!(
                ToolUserRequested,
                ToolUserRequestedData,
                "tool.user_requested",
                data
            )
        }
        // New event types
        SessionEventType::SessionTruncation => {
            try_deser!(
                SessionTruncation,
                SessionTruncationData,
                "session.truncation",
                data
            )
        }
        SessionEventType::AssistantReasoning => {
            try_deser!(
                AssistantReasoning,
                AssistantReasoningData,
                "assistant.reasoning",
                data
            )
        }
        SessionEventType::SystemMessage => {
            try_deser!(SystemMessage, SystemMessageData, "system.message", data)
        }
        SessionEventType::SessionWarning => {
            try_deser!(SessionWarning, SessionWarningData, "session.warning", data)
        }
        SessionEventType::SessionModeChanged => {
            try_deser!(
                SessionModeChanged,
                SessionModeChangedData,
                "session.mode_changed",
                data
            )
        }
        SessionEventType::SessionTaskComplete => {
            try_deser!(
                SessionTaskComplete,
                SessionTaskCompleteData,
                "session.task_complete",
                data
            )
        }
        SessionEventType::SubagentSelected => {
            try_deser!(
                SubagentSelected,
                SubagentSelectedData,
                "subagent.selected",
                data
            )
        }
        SessionEventType::SubagentDeselected => {
            try_deser!(
                SubagentDeselected,
                SubagentDeselectedData,
                "subagent.deselected",
                data
            )
        }
        SessionEventType::HookStart => {
            try_deser!(HookStart, HookStartData, "hook.start", data)
        }
        SessionEventType::HookEnd => {
            try_deser!(HookEnd, HookEndData, "hook.end", data)
        }
        SessionEventType::SessionHandoff => {
            try_deser!(SessionHandoff, SessionHandoffData, "session.handoff", data)
        }
        SessionEventType::SessionImportLegacy => {
            try_deser!(
                SessionImportLegacy,
                SessionImportLegacyData,
                "session.import_legacy",
                data
            )
        }
        SessionEventType::SessionRemoteSteerableChanged => {
            try_deser!(
                SessionRemoteSteerableChanged,
                SessionRemoteSteerableChangedData,
                "session.remote_steerable_changed",
                data
            )
        }
        SessionEventType::Unknown(name) => (
            TypedEventData::Other(data.clone()),
            Some(EventParseWarning::UnknownEventType {
                event_type: name.clone(),
            }),
        ),
    }
}

/// Parse `events.jsonl` into fully typed events with diagnostics.
///
/// Reads the file line-by-line, parses each [`RawEvent`], converts the string
/// event type into [`SessionEventType`], and deserializes data into the matching
/// typed struct — falling back to [`TypedEventData::Other`] on failure.
///
/// Returns [`ParsedEvents`] containing both the events and parsing diagnostics
/// (unknown event types, deserialization failures, malformed line counts).
#[tracing::instrument(skip_all, fields(path = %path.display()))]
pub fn parse_typed_events(path: &Path) -> Result<ParsedEvents> {
    let (raw_events, malformed) = parse_events_jsonl(path)?;
    let mut diagnostics = ParseDiagnostics {
        malformed_lines: malformed,
        ..Default::default()
    };
    let mut events = Vec::with_capacity(raw_events.len());

    for raw in raw_events {
        let event_type = SessionEventType::parse_wire(raw.event_type.as_str());
        let (typed_data, warning) = typed_data_from_raw(&event_type, &raw.data);

        diagnostics.total_events += 1;
        if matches!(typed_data, TypedEventData::Other(_)) {
            diagnostics.fallback_events += 1;
        } else {
            diagnostics.typed_events += 1;
        }
        if let Some(ref w) = warning {
            diagnostics.record_warning(w);
        }

        events.push(TypedEvent {
            raw,
            event_type,
            typed_data,
        });
    }

    diagnostics.log_summary();
    Ok(ParsedEvents {
        events,
        diagnostics,
    })
}

/// Parse `events.jsonl` if it exists, returning `Ok(None)` if it does not.
///
/// Many session directories exist on disk (with `workspace.yaml`, `checkpoints/`,
/// `files/`, …) without an `events.jsonl` — e.g. freshly-created sessions, or
/// sessions whose event log was cleaned up. Callers in best-effort contexts
/// (prefetch, shutdown metrics, attribution scans) should treat that as "no
/// events" rather than a hard error. Other I/O errors (permission denied,
/// not-a-file, …) are still surfaced.
#[tracing::instrument(skip_all, fields(path = %path.display()))]
pub fn parse_typed_events_if_exists(path: &Path) -> Result<Option<ParsedEvents>> {
    match std::fs::metadata(path) {
        Ok(_) => parse_typed_events(path).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(crate::error::TracePilotError::io_context(
            "Failed to stat",
            path.display(),
            e,
        )),
    }
}
