//! The model a session is on, followed through its event log.
//!
//! `session.shutdown.currentModel` records it only when the CLI exits, so a
//! running session, one that crashed, or one resumed and switched since its
//! last shutdown needs the model derived from the events themselves.

use super::typed::{TypedEvent, TypedEventData};

/// The model id Copilot CLI records while auto mode is choosing per prompt.
pub const AUTO_MODEL: &str = "auto";

/// Whether `model` is auto mode rather than a concrete model.
pub fn is_auto_model(model: &str) -> bool {
    model.eq_ignore_ascii_case(AUTO_MODEL)
}

/// Follows the root agent's model through a session's events. The most
/// recent concrete value wins.
///
/// Selections (`session.start`/`resume`, `session.model_change`, and the
/// shutdown record) say what the session is set to; switching to auto mode
/// forgets the previous model, because auto may pick a different one.
/// Evidence of use (`session.auto_mode_resolved`, and root
/// `assistant.turn_start`/`assistant.message` models) names the concrete
/// model without changing whether auto mode is on.
#[derive(Debug, Clone, Default)]
pub struct SessionModelTracker {
    model: Option<String>,
    auto: bool,
}

impl SessionModelTracker {
    pub fn observe(&mut self, event: &TypedEvent) {
        // Sub-agents run their own models.
        if event.raw.agent_id.is_some() {
            return;
        }
        match &event.typed_data {
            TypedEventData::SessionStart(data) => self.select(data.selected_model.as_deref()),
            TypedEventData::SessionResume(data) => self.select(data.selected_model.as_deref()),
            TypedEventData::ModelChange(data) => self.select(data.new_model.as_deref()),
            TypedEventData::SessionShutdown(data) => self.select(data.current_model.as_deref()),
            TypedEventData::SessionAutoModeResolved(data) => {
                self.used(data.chosen_model.as_deref());
            }
            TypedEventData::TurnStart(data) => self.used(data.model.as_deref()),
            TypedEventData::AssistantMessage(data) if data.parent_tool_call_id.is_none() => {
                self.used(data.model.as_deref());
            }
            _ => {}
        }
    }

    /// The concrete model, or `auto` while auto mode has not yet named one.
    pub fn current_model(&self) -> Option<String> {
        self.model
            .clone()
            .or_else(|| self.auto.then(|| AUTO_MODEL.to_string()))
    }

    fn select(&mut self, model: Option<&str>) {
        let Some(model) = model.filter(|model| !model.is_empty()) else {
            return;
        };
        self.auto = is_auto_model(model);
        self.model = (!self.auto).then(|| model.to_string());
    }

    fn used(&mut self, model: Option<&str>) {
        if let Some(model) = model.filter(|model| !model.is_empty() && !is_auto_model(model)) {
            self.model = Some(model.to_string());
        }
    }
}

/// The model a session was last on, from its whole event log.
pub fn current_session_model(events: &[TypedEvent]) -> Option<String> {
    let mut tracker = SessionModelTracker::default();
    for event in events {
        tracker.observe(event);
    }
    tracker.current_model()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event_types::SessionEventType;
    use crate::parsing::events::RawEvent;
    use crate::parsing::events::typed::typed_data_from_raw;
    use serde_json::{Value, json};

    fn event(event_type: &str, data: Value) -> TypedEvent {
        let kind = SessionEventType::parse_wire(event_type);
        let (typed_data, _) = typed_data_from_raw(&kind, &data);
        TypedEvent {
            raw: RawEvent {
                event_type: event_type.to_string(),
                data,
                id: None,
                timestamp: None,
                parent_id: None,
                agent_id: None,
            },
            event_type: kind,
            typed_data,
        }
    }

    fn subagent(mut event: TypedEvent) -> TypedEvent {
        event.raw.agent_id = Some("agent-1".to_string());
        event
    }

    #[test]
    fn running_session_without_shutdown_uses_the_selected_model() {
        let events = [
            event("session.start", json!({ "selectedModel": "gpt-5.6-luna" })),
            event("user.message", json!({ "content": "hi" })),
        ];
        assert_eq!(
            current_session_model(&events).as_deref(),
            Some("gpt-5.6-luna")
        );
    }

    #[test]
    fn switch_after_a_resume_replaces_the_shutdown_model() {
        let events = [
            event("session.start", json!({ "selectedModel": "gpt-5.4" })),
            event("session.shutdown", json!({ "currentModel": "gpt-5.4" })),
            event("session.resume", json!({ "selectedModel": "gpt-5.4" })),
            event(
                "session.model_change",
                json!({ "previousModel": "gpt-5.4", "newModel": "claude-sonnet-4.6" }),
            ),
        ];
        assert_eq!(
            current_session_model(&events).as_deref(),
            Some("claude-sonnet-4.6")
        );
    }

    #[test]
    fn auto_mode_reports_its_latest_choice() {
        let events = [
            event("session.start", json!({ "selectedModel": "gpt-5.6-luna" })),
            event(
                "session.model_change",
                json!({ "previousModel": "gpt-5.6-luna", "newModel": "auto" }),
            ),
            event(
                "session.auto_mode_resolved",
                json!({ "chosenModel": "gpt-5.6-luna" }),
            ),
            event(
                "assistant.message",
                json!({ "content": "", "model": "mai-code-1.1-flash" }),
            ),
        ];
        assert_eq!(
            current_session_model(&events).as_deref(),
            Some("mai-code-1.1-flash")
        );
    }

    #[test]
    fn switching_to_auto_forgets_the_previous_model() {
        // Older CLIs recorded no concrete choice for auto mode, so the model
        // selected before it would be a guess.
        let events = [
            event("session.model_change", json!({ "newModel": "gpt-5.4" })),
            event(
                "session.model_change",
                json!({ "previousModel": "gpt-5.4", "newModel": "auto" }),
            ),
        ];
        assert_eq!(current_session_model(&events).as_deref(), Some("auto"));

        let mut shut_down = events.to_vec();
        shut_down.push(event(
            "session.shutdown",
            json!({ "currentModel": "claude-sonnet-4.6" }),
        ));
        assert_eq!(
            current_session_model(&shut_down).as_deref(),
            Some("claude-sonnet-4.6")
        );
    }

    #[test]
    fn subagent_models_are_ignored() {
        let events = [
            event("session.start", json!({ "selectedModel": "gpt-5.6-luna" })),
            subagent(event(
                "assistant.turn_start",
                json!({ "model": "gpt-5.4-mini" }),
            )),
            event(
                "assistant.message",
                json!({
                    "content": "",
                    "model": "claude-haiku-4.5",
                    "parentToolCallId": "call-1",
                }),
            ),
        ];
        assert_eq!(
            current_session_model(&events).as_deref(),
            Some("gpt-5.6-luna")
        );
    }

    #[test]
    fn no_model_evidence_yields_none() {
        let events = [event("user.message", json!({ "content": "hi" }))];
        assert_eq!(current_session_model(&events), None);
    }
}
