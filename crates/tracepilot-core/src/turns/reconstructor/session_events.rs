//! Session-level event handlers (model changes, errors, warnings, lifecycle).

use crate::models::conversation::SessionEventSeverity;
use crate::models::conversation::SkillInvocationEvent;
use crate::models::event_types::{
    CompactionCompleteData, ExternalToolRequestedData, ModelChangeData, PermissionCompletedData,
    PermissionRequestedData, PlanChangedData, SessionErrorData, SessionModeChangedData,
    SessionResumeData, SessionStartData, SessionTruncationData, SessionWarningData,
    SkillInvokedData,
};
use crate::parsing::events::TypedEvent;
use serde_json::Value;

use super::state::SessionEventBuild;
use super::{PendingSkillInvocation, TurnReconstructor};

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

    pub(super) fn handle_skill_invoked(&mut self, event: &TypedEvent, data: &SkillInvokedData) {
        let summary = data
            .name
            .as_deref()
            .map(|name| format!("Skill invoked: {name}"))
            .unwrap_or_else(|| "Skill invoked".to_string());
        let content_len = data.content.as_ref().map(|content| content.chars().count());
        // Cap content size sent over IPC so multi-megabyte skills don't bloat
        // the conversation payload. The UI compares the captured Unicode scalar
        // count against `content_length` to detect and surface truncation.
        const MAX_CONTENT_CHARS: usize = 16_384;
        let content = data.content.as_ref().map(|raw| {
            if raw.chars().count() > MAX_CONTENT_CHARS {
                raw.chars().take(MAX_CONTENT_CHARS).collect()
            } else {
                raw.clone()
            }
        });
        let skill_invocation = SkillInvocationEvent {
            id: event.raw.id.clone(),
            name: data.name.clone(),
            path: data.path.clone(),
            description: data.description.clone(),
            content_length: content_len,
            content,
            context_length: None,
            context_folded: false,
        };

        let attached_to_tool = event
            .raw
            .parent_id
            .as_deref()
            .and_then(|parent_id| self.tool_event_to_call_id.get(parent_id))
            .cloned()
            .and_then(|tool_call_id| self.find_tool_call_mut(Some(&tool_call_id)))
            .filter(|tool_call| tool_call.tool_name == "skill")
            .map(|tool_call| {
                tool_call.skill_invocation = Some(skill_invocation.clone());
            })
            .is_some();

        if !attached_to_tool {
            self.push_session_event_full(SessionEventBuild {
                event_type: "skill.invoked".to_string(),
                timestamp: event.raw.timestamp,
                severity: SessionEventSeverity::Info,
                summary,
                checkpoint_number: None,
                request_id: None,
                tool_call_id: None,
                prompt_kind: None,
                result_kind: None,
                resolved_by_hook: None,
                skill_invocation: Some(skill_invocation.clone()),
            });
        }

        if let Some(event_id) = event.raw.id.clone() {
            self.pending_skill_invocations.insert(
                event_id.clone(),
                PendingSkillInvocation {
                    event_id,
                    name: data.name.clone(),
                    content: data.content.clone(),
                },
            );
        }
    }

    pub(super) fn handle_permission_requested(
        &mut self,
        event: &TypedEvent,
        data: &PermissionRequestedData,
    ) {
        let source = data
            .prompt_request
            .as_ref()
            .or(data.permission_request.as_ref());
        let kind = json_field_str(source, "kind").unwrap_or("unknown");
        let intention = json_field_str(source, "intention");
        let summary = match intention {
            Some(text) if !text.trim().is_empty() => {
                format!("Permission requested ({kind}): {}", text.trim())
            }
            _ => format!("Permission requested ({kind})"),
        };
        let tool_call_id = json_field_str(source, "toolCallId").map(str::to_string);
        self.push_session_event_full(SessionEventBuild {
            event_type: "permission.requested".to_string(),
            timestamp: event.raw.timestamp,
            severity: SessionEventSeverity::Info,
            summary,
            checkpoint_number: None,
            request_id: data.request_id.clone(),
            tool_call_id,
            prompt_kind: Some(kind.to_string()),
            result_kind: None,
            resolved_by_hook: data.resolved_by_hook,
            skill_invocation: None,
        });
    }

    pub(super) fn handle_permission_completed(
        &mut self,
        event: &TypedEvent,
        data: &PermissionCompletedData,
    ) {
        let result_kind = json_field_str(data.result.as_ref(), "kind").unwrap_or("unknown");
        let severity = if result_kind.starts_with("approved") {
            SessionEventSeverity::Info
        } else {
            SessionEventSeverity::Warning
        };
        let feedback = json_field_str(data.result.as_ref(), "feedback")
            .or_else(|| json_field_str(data.result.as_ref(), "reason"))
            .or_else(|| json_field_str(data.result.as_ref(), "message"));
        let summary = match feedback {
            Some(text) if !text.trim().is_empty() => {
                format!("Permission result: {result_kind} ({})", text.trim())
            }
            _ => format!("Permission result: {result_kind}"),
        };
        self.push_session_event_full(SessionEventBuild {
            event_type: "permission.completed".to_string(),
            timestamp: event.raw.timestamp,
            severity,
            summary,
            checkpoint_number: None,
            request_id: data.request_id.clone(),
            tool_call_id: data.tool_call_id.clone(),
            prompt_kind: None,
            result_kind: Some(result_kind.to_string()),
            resolved_by_hook: None,
            skill_invocation: None,
        });
    }

    pub(super) fn handle_external_tool_requested(
        &mut self,
        event: &TypedEvent,
        data: &ExternalToolRequestedData,
    ) {
        let summary = data
            .tool_name
            .as_deref()
            .map(|name| format!("External tool requested: {name}"))
            .unwrap_or_else(|| "External tool requested".to_string());
        self.push_session_event(
            "external_tool.requested",
            event.raw.timestamp,
            SessionEventSeverity::Info,
            summary,
        );
    }
}

fn json_field_str<'a>(value: Option<&'a Value>, field: &str) -> Option<&'a str> {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get(field))
        .and_then(Value::as_str)
}
