//! State helpers and shared utilities for [`TurnReconstructor`].

use chrono::{DateTime, Utc};

use crate::models::conversation::{
    ConversationTurn, SessionEventSeverity, TurnSessionEvent, TurnToolCall,
};
use crate::models::event_types::SubagentStartedData;

use super::super::utils::duration_ms;
use super::{CURRENT_TURN_SENTINEL, TurnReconstructor};

impl TurnReconstructor {
    /// Push a session event into the current turn, or buffer it for the next one.
    pub(crate) fn push_session_event(
        &mut self,
        event_type: &str,
        timestamp: Option<DateTime<Utc>>,
        severity: SessionEventSeverity,
        summary: String,
    ) {
        self.push_session_event_ext(event_type, timestamp, severity, summary, None);
    }

    pub(crate) fn push_session_event_ext(
        &mut self,
        event_type: &str,
        timestamp: Option<DateTime<Utc>>,
        severity: SessionEventSeverity,
        summary: String,
        checkpoint_number: Option<u32>,
    ) {
        let se = TurnSessionEvent {
            event_type: event_type.to_string(),
            timestamp,
            severity,
            summary,
            checkpoint_number,
        };
        if let Some(turn) = &mut self.current_turn {
            turn.session_events.push(se);
        } else {
            self.pending_session_events.push(se);
        }
    }

    pub(crate) fn ensure_current_turn(
        &mut self,
        timestamp: Option<DateTime<Utc>>,
    ) -> &mut ConversationTurn {
        if self.current_turn.is_none() {
            let mut turn = new_turn(self.turns.len(), timestamp, None, None, None, None);
            // Inherit session model, same as UserMessage does
            turn.model = self.session_model.clone();
            // Flush any session events that occurred while no turn was active
            turn.session_events.append(&mut self.pending_session_events);
            // Flush any system messages that arrived before this turn
            turn.system_messages.append(&mut self.pending_system_messages);
            self.current_turn = Some(turn);
        }
        self.current_turn
            .as_mut()
            .expect("BUG: current_turn is None after ensure logic set it to Some")
    }

    pub(crate) fn finalize_current_turn(
        &mut self,
        is_complete: bool,
        end_timestamp: Option<DateTime<Utc>>,
    ) {
        if let Some(mut turn) = self.current_turn.take() {
            if turn.end_timestamp.is_none() {
                turn.end_timestamp = end_timestamp;
            }
            turn.duration_ms = duration_ms(turn.timestamp, turn.end_timestamp);
            turn.is_complete = is_complete;

            let finalized_index = self.turns.len();
            // Update the tool call index: remap CURRENT_TURN_SENTINEL → actual turn index
            for (tc_idx, tc) in turn.tool_calls.iter().enumerate() {
                if let Some(id) = &tc.tool_call_id {
                    self.tool_call_index
                        .insert(id.clone(), (finalized_index, tc_idx));
                }
            }

            self.turns.push(turn);
        }
    }

    // ── Tool call lookup (O(1) via index) ─────────────────────────────

    /// Find a tool call by ID across current turn and all finalized turns.
    /// Uses the HashMap index for O(1) lookup instead of linear scan.
    pub(crate) fn find_tool_call_mut(
        &mut self,
        tool_call_id: Option<&str>,
    ) -> Option<&mut TurnToolCall> {
        let id = tool_call_id?;
        let &(turn_idx, tc_idx) = self.tool_call_index.get(id)?;

        if turn_idx == CURRENT_TURN_SENTINEL {
            self.current_turn
                .as_mut()
                .and_then(|t| t.tool_calls.get_mut(tc_idx))
        } else {
            self.turns
                .get_mut(turn_idx)
                .and_then(|t| t.tool_calls.get_mut(tc_idx))
        }
    }

    /// Read-only tool call lookup (for checking is_subagent etc. without borrowing issues).
    pub(crate) fn find_tool_call_ref(&self, tool_call_id: Option<&str>) -> Option<&TurnToolCall> {
        let id = tool_call_id?;
        let &(turn_idx, tc_idx) = self.tool_call_index.get(id)?;

        if turn_idx == CURRENT_TURN_SENTINEL {
            self.current_turn
                .as_ref()
                .and_then(|t| t.tool_calls.get(tc_idx))
        } else {
            self.turns
                .get(turn_idx)
                .and_then(|t| t.tool_calls.get(tc_idx))
        }
    }

    /// Find the turn that owns a given tool call (mutable).
    pub(crate) fn find_owning_turn_mut(
        &mut self,
        tool_call_id: Option<&str>,
    ) -> Option<&mut ConversationTurn> {
        let id = tool_call_id?;
        let &(turn_idx, _) = self.tool_call_index.get(id)?;

        if turn_idx == CURRENT_TURN_SENTINEL {
            self.current_turn.as_mut()
        } else {
            self.turns.get_mut(turn_idx)
        }
    }

    // ── Unified subagent terminal handler ─────────────────────────────

    /// Handle SubagentCompleted or SubagentFailed — merged to eliminate duplication.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn handle_subagent_terminal(
        &mut self,
        tool_call_id: Option<&str>,
        timestamp: Option<DateTime<Utc>>,
        success: bool,
        error: Option<&str>,
        model: Option<&str>,
        reported_duration_ms: Option<u64>,
        total_tokens: Option<u64>,
        total_tool_calls: Option<u64>,
    ) {
        if let Some(tool_call) = self.find_tool_call_mut(tool_call_id) {
            // Mark as subagent — handles the case where SubagentCompleted arrives
            // before SubagentStarted (so enrich_subagent can detect this later).
            tool_call.is_subagent = true;
            if tool_call.completed_at.is_none() || timestamp > tool_call.completed_at {
                tool_call.completed_at = timestamp;
                // Prefer the subagent's self-reported duration over timestamp math.
                tool_call.duration_ms = reported_duration_ms
                    .or_else(|| duration_ms(tool_call.started_at, tool_call.completed_at));
            }
            tool_call.success = Some(success);
            if let Some(err) = error {
                tool_call.error = Some(err.to_string());
            }
            // Subagent's self-reported model is authoritative.
            if let Some(m) = model {
                tool_call.model = Some(m.to_string());
            }
            tool_call.total_tokens = total_tokens;
            tool_call.total_tool_calls = total_tool_calls;
            tool_call.is_complete = true;
        } else {
            tracing::debug!(
                tool_call_id = ?tool_call_id,
                success,
                "Subagent terminal event with no matching start — skipping"
            );
        }
    }
}

// ── Free helpers ──────────────────────────────────────────────────────

/// Create a new conversation turn with the given initial data.
pub(crate) fn new_turn(
    turn_index: usize,
    timestamp: Option<DateTime<Utc>>,
    interaction_id: Option<String>,
    user_message: Option<String>,
    transformed_user_message: Option<String>,
    attachments: Option<Vec<serde_json::Value>>,
) -> ConversationTurn {
    ConversationTurn {
        turn_index,
        event_index: None,
        turn_id: None,
        interaction_id,
        user_message,
        assistant_messages: Vec::new(),
        model: None,
        timestamp,
        end_timestamp: None,
        tool_calls: Vec::new(),
        duration_ms: None,
        is_complete: false,
        reasoning_texts: Vec::new(),
        output_tokens: None,
        transformed_user_message,
        attachments,
        session_events: Vec::new(),
        system_messages: Vec::new(),
    }
}

/// Enrich an existing tool call entry with subagent metadata.
pub(crate) fn enrich_subagent(existing: &mut TurnToolCall, data: &SubagentStartedData) {
    // Detect whether completion state was set by a real subagent terminal event
    // (SubagentCompleted/SubagentFailed) vs ToolExecComplete on an unknown-subagent.
    // handle_subagent_terminal() sets is_subagent=true, so:
    //   is_subagent=true + is_complete=true → terminal event already processed, preserve state
    //   is_subagent=false + is_complete=true → ToolExecComplete set it, clear it
    let has_terminal_state = existing.is_subagent && existing.is_complete;
    existing.is_subagent = true;
    if !has_terminal_state {
        // Clear stale ToolExecComplete-derived state. With the ToolExecComplete guard,
        // this is mostly a no-op for normal ordering, but handles the edge case where
        // ToolExecComplete arrived before SubagentStarted and set completed_at/is_complete
        // because is_subagent was still false at that point.
        existing.is_complete = false;
        existing.completed_at = None;
        existing.duration_ms = None;
    }
    existing.agent_display_name = data.agent_display_name.clone();
    existing.agent_description = data.agent_description.clone();
    if let Some(name) = data
        .agent_name
        .as_ref()
        .or(data.agent_display_name.as_ref())
    {
        existing.tool_name = name.clone();
    }
}
