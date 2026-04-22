//! Core turn reconstruction state machine.
//!
//! This module contains [`TurnReconstructor`], which processes a chronologically-ordered
//! stream of events and produces reconstructed conversation turns.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use crate::models::conversation::{ConversationTurn, TurnSessionEvent};
use crate::models::event_types::SessionEventType;
use crate::parsing::events::{TypedEvent, TypedEventData};

use super::postprocess::{
    correct_turn_models, finalize_subagent_completion, infer_subagent_models,
    resolve_agent_display_names,
};

mod messages;
mod session_events;
mod state;
mod tool_exec;

#[cfg(test)]
mod tests;

pub(crate) use state::new_turn;

/// Encapsulated state machine for reconstructing conversation turns from events.
///
/// Holds all mutable state needed during reconstruction:
/// - `turns`: finalized turns
/// - `current_turn`: the in-progress turn (if any)
/// - `tool_call_intentions`: maps `tool_call_id → intention_summary` from assistant messages
/// - `tool_call_index`: maps `tool_call_id → (turn_index, tool_call_index)` for O(1) lookups
///
/// The `turn_index` in the index uses `usize::MAX` as a sentinel for "in current_turn"
/// (since current_turn hasn't been pushed to `turns` yet).
pub struct TurnReconstructor {
    pub(crate) turns: Vec<ConversationTurn>,
    pub(crate) current_turn: Option<ConversationTurn>,
    pub(crate) tool_call_intentions: HashMap<String, String>,
    /// Maps tool_call_id → (turn_index, tool_call_index).
    /// `turn_index == CURRENT_TURN_SENTINEL` means the tool call is in `current_turn`.
    pub(crate) tool_call_index: HashMap<String, (usize, usize)>,
    /// Tracks the most recent session-level model, so new turns inherit it.
    pub(crate) session_model: Option<String>,
    /// Session events buffered while no turn is active.
    /// Flushed into the next real turn when one is opened.
    pub(crate) pending_session_events: Vec<TurnSessionEvent>,
    /// System message contents buffered while no turn is active.
    /// Flushed into the next real turn when one is opened.
    pub(crate) pending_system_messages: Vec<String>,
    /// Timestamp of the first pending system message — used as fallback when
    /// building a synthetic turn in sessions that have no real turns.
    pub(crate) pending_system_messages_ts: Option<DateTime<Utc>>,
}

pub(crate) const CURRENT_TURN_SENTINEL: usize = usize::MAX;

impl Default for TurnReconstructor {
    fn default() -> Self {
        Self::new()
    }
}

impl TurnReconstructor {
    pub fn new() -> Self {
        Self {
            turns: Vec::new(),
            current_turn: None,
            tool_call_intentions: HashMap::new(),
            tool_call_index: HashMap::new(),
            session_model: None,
            pending_session_events: Vec::new(),
            pending_system_messages: Vec::new(),
            pending_system_messages_ts: None,
        }
    }

    /// Process a single event, advancing the state machine.
    pub fn process(&mut self, event: &TypedEvent, event_index: usize) {
        match (&event.event_type, &event.typed_data) {
            (SessionEventType::UserMessage, TypedEventData::UserMessage(data)) => {
                self.handle_user_message(event, event_index, data);
            }
            (SessionEventType::AssistantTurnStart, TypedEventData::TurnStart(data)) => {
                self.handle_assistant_turn_start(event, data);
            }
            (SessionEventType::AssistantMessage, TypedEventData::AssistantMessage(data)) => {
                self.handle_assistant_message(event, data);
            }
            (SessionEventType::ToolExecutionStart, TypedEventData::ToolExecutionStart(data)) => {
                self.handle_tool_execution_start(event, event_index, data);
            }
            (
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(data),
            ) => {
                self.handle_tool_execution_complete(event, data);
            }
            (SessionEventType::SubagentStarted, TypedEventData::SubagentStarted(data)) => {
                self.handle_subagent_started(event, event_index, data);
            }
            (SessionEventType::SubagentCompleted, TypedEventData::SubagentCompleted(data)) => {
                self.handle_subagent_terminal(
                    data.tool_call_id.as_deref(),
                    event.raw.timestamp,
                    true,
                    None,
                    data.model.as_deref(),
                    data.duration_ms,
                    data.total_tokens,
                    data.total_tool_calls,
                );
            }
            (SessionEventType::SubagentFailed, TypedEventData::SubagentFailed(data)) => {
                self.handle_subagent_terminal(
                    data.tool_call_id.as_deref(),
                    event.raw.timestamp,
                    false,
                    data.error.as_deref(),
                    data.model.as_deref(),
                    data.duration_ms,
                    data.total_tokens,
                    data.total_tool_calls,
                );
            }
            (SessionEventType::AssistantTurnEnd, TypedEventData::TurnEnd(data)) => {
                self.handle_assistant_turn_end(event, data);
            }
            (SessionEventType::SessionModelChange, TypedEventData::ModelChange(data)) => {
                self.handle_session_model_change(data);
            }
            (SessionEventType::Abort, TypedEventData::Abort(_data)) => {
                self.finalize_current_turn(false, event.raw.timestamp);
            }
            (SessionEventType::AssistantReasoning, TypedEventData::AssistantReasoning(data)) => {
                self.handle_assistant_reasoning(event, data);
            }
            (SessionEventType::SessionError, TypedEventData::SessionError(data)) => {
                self.handle_session_error(event, data);
            }
            (SessionEventType::SessionWarning, TypedEventData::SessionWarning(data)) => {
                self.handle_session_warning(event, data);
            }
            (SessionEventType::SessionCompactionStart, TypedEventData::CompactionStart(_data)) => {
                self.handle_session_compaction_start(event);
            }
            (
                SessionEventType::SessionCompactionComplete,
                TypedEventData::CompactionComplete(data),
            ) => {
                self.handle_session_compaction_complete(event, data);
            }
            (SessionEventType::SessionTruncation, TypedEventData::SessionTruncation(data)) => {
                self.handle_session_truncation(event, data);
            }
            (SessionEventType::SessionPlanChanged, TypedEventData::PlanChanged(data)) => {
                self.handle_session_plan_changed(event, data);
            }
            (SessionEventType::SessionModeChanged, TypedEventData::SessionModeChanged(data)) => {
                self.handle_session_mode_changed(event, data);
            }
            (SessionEventType::SessionStart, TypedEventData::SessionStart(data)) => {
                self.handle_session_start(event, data);
            }
            (SessionEventType::SessionResume, TypedEventData::SessionResume(data)) => {
                self.handle_session_resume(event, data);
            }
            (SessionEventType::SystemMessage, TypedEventData::SystemMessage(data)) => {
                self.handle_system_message(event, data);
            }
            _ => {}
        }
    }

    pub fn finalize(mut self) -> Vec<ConversationTurn> {
        self.finalize_current_turn(false, None);

        // Attach any remaining buffered session events to the last turn,
        // or create a synthetic turn if no turns exist (e.g., failed-start sessions).
        if !self.pending_session_events.is_empty() || !self.pending_system_messages.is_empty() {
            if let Some(last) = self.turns.last_mut() {
                last.session_events.append(&mut self.pending_session_events);
                last.system_messages
                    .append(&mut self.pending_system_messages);
            } else {
                let ts = self
                    .pending_session_events
                    .first()
                    .and_then(|e| e.timestamp)
                    .or(self.pending_system_messages_ts);
                let mut turn = new_turn(0, ts, None, None, None, None);
                turn.session_events.append(&mut self.pending_session_events);
                turn.system_messages
                    .append(&mut self.pending_system_messages);
                self.turns.push(turn);
            }
        }

        infer_subagent_models(&mut self.turns);
        finalize_subagent_completion(&mut self.turns);
        correct_turn_models(&mut self.turns);
        resolve_agent_display_names(&mut self.turns);
        self.turns
    }
}
