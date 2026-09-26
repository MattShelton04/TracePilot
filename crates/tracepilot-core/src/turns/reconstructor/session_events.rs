//! Session-level event handlers (model changes, errors, warnings, lifecycle).

use crate::models::conversation::SessionEventSeverity;
use crate::models::conversation::SkillInvocationEvent;
use crate::models::event_types::{
    CompactionCompleteData, ExternalToolRequestedData, ModelChangeData, PermissionCompletedData,
    PermissionRequestedData, PlanChangedData, SessionAutoModeResolvedData, SessionErrorData,
    SessionModeChangedData, SessionResumeData, SessionStartData, SessionTruncationData,
    SessionWarningData, SkillInvokedData,
};
use crate::parsing::events::{TypedEvent, is_auto_model};
use serde_json::Value;

use super::state::SessionEventBuild;
use super::{PendingSkillInvocation, TurnReconstructor};

impl TurnReconstructor {
    // Model change: update session-level model; set turn model if not already set
    pub(super) fn handle_session_model_change(
        &mut self,
        event: &TypedEvent,
        data: &ModelChangeData,
    ) {
        let known_model = data
            .previous_model
            .as_deref()
            .or(self.session_model.as_deref());
        if let Some(summary) = describe_model_change(data, known_model) {
            self.push_session_event(
                "session.model_change",
                event.raw.timestamp,
                SessionEventSeverity::Info,
                summary,
            );
        }
        if !data.new_model.as_deref().is_some_and(is_auto_model) {
            self.auto_model_choice = None;
        }
        if let Some(ref model) = data.new_model {
            self.session_model = Some(model.clone());
        }
        if let Some(turn) = self.current_turn.as_mut()
            && turn.model.is_none()
        {
            turn.model = data.new_model.clone();
        }
    }

    /// Auto mode picks a concrete model before each prompt. The choice becomes
    /// the session model, and is shown only when it differs from the last one.
    pub(super) fn handle_auto_mode_resolved(
        &mut self,
        event: &TypedEvent,
        data: &SessionAutoModeResolvedData,
    ) {
        let Some(chosen) = data.chosen_model.clone() else {
            return;
        };
        if self.auto_model_choice.as_deref() != Some(chosen.as_str()) {
            self.push_session_event(
                "session.auto_mode_resolved",
                event.raw.timestamp,
                SessionEventSeverity::Info,
                format!("Auto mode chose {chosen}"),
            );
        }
        if let Some(turn) = self.current_turn.as_mut()
            && turn.model.as_deref().is_none_or(is_auto_model)
        {
            turn.model = Some(chosen.clone());
        }
        self.auto_model_choice = Some(chosen.clone());
        self.session_model = Some(chosen);
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
        // Every client that joins a session appends a `session.resume` (a
        // TracePilot live attach does too), so back-to-back resumes collapse
        // into one row with a count instead of stacking up. Bookkeeping
        // events in between (permissions, model diagnostics) don't count;
        // any conversation does.
        let collapse = std::mem::replace(&mut self.resume_row_open, true);
        let target = match &mut self.current_turn {
            Some(turn) => &mut turn.session_events,
            None => &mut self.pending_session_events,
        };
        if collapse
            && let Some(last) = target.last_mut()
            && last.event_type == "session.resume"
        {
            last.summary = resume_summary(
                resume_count(&last.summary) + 1,
                data.selected_model.as_deref(),
            );
            return;
        }
        self.push_session_event(
            "session.resume",
            event.raw.timestamp,
            SessionEventSeverity::Info,
            resume_summary(1, data.selected_model.as_deref()),
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

        let attached_tool_call_id = event
            .raw
            .parent_id
            .as_deref()
            .and_then(|parent_id| self.tool_event_to_call_id.get(parent_id))
            .cloned()
            .filter(|tool_call_id| {
                self.find_tool_call_ref(Some(tool_call_id))
                    .is_some_and(|tool_call| tool_call.tool_name == "skill")
            });

        if let Some(tool_call_id) = attached_tool_call_id.as_deref()
            && let Some(tool_call) = self.find_tool_call_mut(Some(tool_call_id))
        {
            tool_call.skill_invocation = Some(skill_invocation.clone());
        }

        if attached_tool_call_id.is_none() {
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
                    attached_tool_call_id,
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

/// `Session resumed`, `Session resumed 3×`, each with an optional model.
pub(super) fn resume_summary(count: u32, model: Option<&str>) -> String {
    let times = if count > 1 {
        format!(" {count}×")
    } else {
        String::new()
    };
    match model {
        Some(m) => format!("Session resumed{times} (model: {m})"),
        None => format!("Session resumed{times}"),
    }
}

/// The count encoded by [`resume_summary`].
fn resume_count(summary: &str) -> u32 {
    summary
        .strip_prefix("Session resumed ")
        .and_then(|rest| rest.split('×').next())
        .and_then(|n| n.parse().ok())
        .unwrap_or(1)
}

fn json_field_str<'a>(value: Option<&'a Value>, field: &str) -> Option<&'a str> {
    value
        .and_then(Value::as_object)
        .and_then(|object| object.get(field))
        .and_then(Value::as_str)
}

/// A readable summary of a model or effort switch, or `None` when nothing a
/// reader would notice changed. `known_model` is the model the session was on
/// before this event, from the event itself or from earlier events.
///
/// Every 1.0.83+ session opens with a `startup` event that restates the
/// selected model, and older CLIs open with one that has no previous model.
/// Both are the initial selection, not a change.
fn describe_model_change(data: &ModelChangeData, known_model: Option<&str>) -> Option<String> {
    if data.source.as_deref() == Some("startup") {
        return None;
    }
    let known_model = known_model?;
    let model = data
        .new_model
        .as_deref()
        .filter(|to| *to != known_model)
        .map(|to| format!("Model changed {known_model} → {to}"));
    let effort = match (
        data.previous_reasoning_effort.as_deref(),
        data.reasoning_effort.as_deref(),
    ) {
        (Some(from), Some(to)) if from != to => Some(format!("effort {from} → {to}")),
        _ => None,
    };
    match (model, effort) {
        (Some(model), Some(effort)) => Some(format!("{model} · {effort}")),
        (Some(model), None) => Some(model),
        (None, Some(effort)) => Some(format!("Reasoning {effort}")),
        (None, None) => None,
    }
}
