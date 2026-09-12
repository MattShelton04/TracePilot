//! Typed event payloads and parser results.

use super::raw::RawEvent;
use crate::models::event_types::{
    AbortData, AssistantMessageData, AssistantReasoningData, CompactionCompleteData,
    CompactionStartData, ExternalToolRequestedData, HookEndData, HookStartData, ModelChangeData,
    PermissionCompletedData, PermissionRequestedData, PlanChangedData, SessionContext,
    SessionErrorData, SessionEventType, SessionHandoffData, SessionImportLegacyData,
    SessionInfoData, SessionLimitsChangedData, SessionModeChangedData,
    SessionRemoteSteerableChangedData, SessionResumeData, SessionStartData,
    SessionTaskCompleteData, SessionTruncationData, SessionWarningData, ShutdownData,
    SkillInvokedData, SubagentCompletedData, SubagentDeselectedData, SubagentFailedData,
    SubagentSelectedData, SubagentStartedData, SystemMessageData, SystemNotificationData,
    ToolExecCompleteData, ToolExecStartData, ToolUserRequestedData, TurnEndData, TurnStartData,
    UsageCheckpointData, UserMessageData, WorkspaceFileChangedData,
};
use crate::models::event_types::{
    AssistantFusionPhaseCompletedData, AssistantFusionPhaseFailedData, SessionAutoModeResolvedData,
    SessionAutopilotObjectiveChangedData, SessionBinaryAssetData, SessionCanvasRecordedData,
    SessionCanvasRemovedData, SessionCompletionReceiptData, SessionContextClearedData,
    SessionFusionCommitStartedData, SessionFusionCompletedData, SessionFusionHandoffData,
    SessionFusionResolvedData, SessionFusionRouteFailedData, SessionModeNoticeDeliveredData,
    SessionPermissionsChangedData, SessionScheduleCancelledData, SessionScheduleCreatedData,
    SessionScheduleRearmedData, SubagentConfiguredData, ToolSearchActivatedData,
};
use crate::parsing::diagnostics::ParseDiagnostics;
use serde_json::Value;

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
    SessionUsageCheckpoint(UsageCheckpointData),
    SessionLimitsChanged(SessionLimitsChangedData),
    SystemNotification(SystemNotificationData),
    SkillInvoked(SkillInvokedData),
    PermissionRequested(PermissionRequestedData),
    PermissionCompleted(PermissionCompletedData),
    ExternalToolRequested(ExternalToolRequestedData),
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
    SessionScheduleCreated(SessionScheduleCreatedData),
    SessionScheduleCancelled(SessionScheduleCancelledData),
    SessionScheduleRearmed(SessionScheduleRearmedData),
    SessionAutopilotObjectiveChanged(SessionAutopilotObjectiveChangedData),
    SessionModeNoticeDelivered(SessionModeNoticeDeliveredData),
    SessionPermissionsChanged(SessionPermissionsChangedData),
    SessionContextCleared(SessionContextClearedData),
    SessionCompletionReceipt(SessionCompletionReceiptData),
    SessionFusionRouteFailed(SessionFusionRouteFailedData),
    SessionFusionResolved(SessionFusionResolvedData),
    SessionFusionHandoff(SessionFusionHandoffData),
    SessionFusionCommitStarted(SessionFusionCommitStartedData),
    SessionFusionCompleted(SessionFusionCompletedData),
    AssistantFusionPhaseCompleted(AssistantFusionPhaseCompletedData),
    AssistantFusionPhaseFailed(AssistantFusionPhaseFailedData),
    ToolSearchActivated(ToolSearchActivatedData),
    SubagentConfigured(SubagentConfiguredData),
    SessionBinaryAsset(SessionBinaryAssetData),
    SessionAutoModeResolved(SessionAutoModeResolvedData),
    SessionCanvasRecorded(SessionCanvasRecordedData),
    SessionCanvasRemoved(SessionCanvasRemovedData),
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
