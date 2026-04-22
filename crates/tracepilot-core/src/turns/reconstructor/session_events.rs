//! Session-level event handlers (model changes, errors, warnings, lifecycle).

use crate::models::conversation::SessionEventSeverity;
use crate::models::event_types::{
    CompactionCompleteData, ModelChangeData, PlanChangedData, SessionErrorData,
    SessionModeChangedData, SessionResumeData, SessionStartData, SessionTruncationData,
    SessionWarningData,
};
use crate::parsing::events::TypedEvent;

use super::TurnReconstructor;

impl TurnReconstructor {
    // Model change: update session-level model; set turn model if not already set
    pub(super) fn handle_session_model_change(&mut self, data: &ModelChangeData) {
        if let Some(ref model) = data.new_model {
            self.session_model = Some(model.clone());
        }
        if let Some(turn) = self.current_turn.as_mut()
            && turn.model.is_none()
        {
            turn.model = data.new_model.clone();
        }
    }

    pub(super) fn handle_session_error(&mut self, event: &TypedEvent, data: &SessionErrorData) {
        let summary = data
            .message
            .as_deref()
            .or(data.error_type.as_deref())
            .map(|s| s.to_string())
            .or_else(|| data.status_code.map(|c| format!("HTTP {c}")))
            .unwrap_or_else(|| "Session error".to_string());
        self.push_session_event(
            "session.error",
            event.raw.timestamp,
            SessionEventSeverity::Error,
            summary,
        );
    }

    pub(super) fn handle_session_warning(&mut self, event: &TypedEvent, data: &SessionWarningData) {
        let summary = data
            .message
            .as_deref()
            .unwrap_or("Session warning")
            .to_string();
        self.push_session_event(
            "session.warning",
            event.raw.timestamp,
            SessionEventSeverity::Warning,
            summary,
        );
    }

    pub(super) fn handle_session_compaction_start(&mut self, event: &TypedEvent) {
        self.push_session_event(
            "session.compaction_start",
            event.raw.timestamp,
            SessionEventSeverity::Info,
            "Context compaction started".to_string(),
        );
    }

    pub(super) fn handle_session_compaction_complete(
        &mut self,
        event: &TypedEvent,
        data: &CompactionCompleteData,
    ) {
        let has_error = data.error.is_some();
        let severity = if data.success == Some(true) && !has_error {
            SessionEventSeverity::Info
        } else {
            SessionEventSeverity::Warning
        };
        let summary = match (data.pre_compaction_tokens, data.success, &data.error) {
            (Some(tokens), Some(true), None) => {
                format!("Compaction complete ({tokens} tokens)")
            }
            (_, Some(false), _) | (_, None, Some(_)) => data
                .error
                .as_ref()
                .map(|e| format!("Compaction failed: {e}"))
                .unwrap_or_else(|| "Compaction failed".to_string()),
            (Some(tokens), _, _) => format!("Compaction complete ({tokens} tokens)"),
            _ => "Compaction complete".to_string(),
        };
        let cp_num = data.checkpoint_number.and_then(|n| u32::try_from(n).ok());
        self.push_session_event_ext(
            "session.compaction_complete",
            event.raw.timestamp,
            severity,
            summary,
            cp_num,
        );
    }

    pub(super) fn handle_session_truncation(
        &mut self,
        event: &TypedEvent,
        data: &SessionTruncationData,
    ) {
        let summary = match (
            data.tokens_removed_during_truncation,
            data.messages_removed_during_truncation,
        ) {
            (Some(tokens), Some(msgs)) => {
                format!("Truncated {tokens} tokens, {msgs} messages")
            }
            (Some(tokens), None) => format!("Truncated {tokens} tokens"),
            (None, Some(msgs)) => format!("Truncated {msgs} messages"),
            _ => "Context truncated".to_string(),
        };
        self.push_session_event(
            "session.truncation",
            event.raw.timestamp,
            SessionEventSeverity::Warning,
            summary,
        );
    }

    pub(super) fn handle_session_plan_changed(
        &mut self,
        event: &TypedEvent,
        data: &PlanChangedData,
    ) {
        let summary = data
            .operation
            .as_ref()
            .map(|op| format!("Agent plan updated ({op})"))
            .unwrap_or_else(|| "Agent plan updated".to_string());
        self.push_session_event(
            "session.plan_changed",
            event.raw.timestamp,
            SessionEventSeverity::Info,
            summary,
        );
    }

    pub(super) fn handle_session_mode_changed(
        &mut self,
        event: &TypedEvent,
        data: &SessionModeChangedData,
    ) {
        let summary = match (&data.previous_mode, &data.new_mode) {
            (Some(prev), Some(new)) => format!("Mode: {prev} → {new}"),
            (None, Some(new)) => format!("Mode changed to {new}"),
            _ => "Mode changed".to_string(),
        };
        self.push_session_event(
            "session.mode_changed",
            event.raw.timestamp,
            SessionEventSeverity::Info,
            summary,
        );
    }

    // Session start/resume: seed session_model from selected_model
    pub(super) fn handle_session_start(&mut self, event: &TypedEvent, data: &SessionStartData) {
        if self.session_model.is_none()
            && let Some(ref model) = data.selected_model
        {
            self.session_model = Some(model.clone());
        }
        self.push_session_event(
            "session.start",
            event.raw.timestamp,
            SessionEventSeverity::Info,
            data.selected_model
                .as_deref()
                .map(|m| format!("Session started (model: {m})"))
                .unwrap_or_else(|| "Session started".to_string()),
        );
    }

    pub(super) fn handle_session_resume(&mut self, event: &TypedEvent, data: &SessionResumeData) {
        if let Some(ref model) = data.selected_model {
            self.session_model = Some(model.clone());
        }
        self.push_session_event(
            "session.resume",
            event.raw.timestamp,
            SessionEventSeverity::Info,
            data.selected_model
                .as_deref()
                .map(|m| format!("Session resumed (model: {m})"))
                .unwrap_or_else(|| "Session resumed".to_string()),
        );
    }
}
