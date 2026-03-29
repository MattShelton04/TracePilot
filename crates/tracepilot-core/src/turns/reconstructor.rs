//! Core turn reconstruction state machine.
//!
//! This module contains [`TurnReconstructor`], which processes a chronologically-ordered
//! stream of events and produces reconstructed conversation turns.

use std::collections::HashMap;

use chrono::{DateTime, Utc};

use crate::models::conversation::{
    AttributedMessage, ConversationTurn, SessionEventSeverity, TurnSessionEvent, TurnToolCall,
};
use crate::models::event_types::SessionEventType;
use crate::parsing::events::{TypedEvent, TypedEventData};

use super::postprocess::{
    correct_turn_models, finalize_subagent_completion, infer_subagent_models,
    resolve_agent_display_names,
};
use super::utils::{duration_ms, extract_result_preview, json_value_to_string};

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
    turns: Vec<ConversationTurn>,
    current_turn: Option<ConversationTurn>,
    tool_call_intentions: HashMap<String, String>,
    /// Maps tool_call_id → (turn_index, tool_call_index).
    /// `turn_index == CURRENT_TURN_SENTINEL` means the tool call is in `current_turn`.
    tool_call_index: HashMap<String, (usize, usize)>,
    /// Tracks the most recent session-level model, so new turns inherit it.
    session_model: Option<String>,
    /// Session events buffered while no turn is active.
    /// Flushed into the next real turn when one is opened.
    pending_session_events: Vec<TurnSessionEvent>,
}

const CURRENT_TURN_SENTINEL: usize = usize::MAX;

impl TurnReconstructor {
    pub fn new() -> Self {
        Self {
            turns: Vec::new(),
            current_turn: None,
            tool_call_intentions: HashMap::new(),
            tool_call_index: HashMap::new(),
            session_model: None,
            pending_session_events: Vec::new(),
        }
    }

    /// Process a single event, advancing the state machine.
    pub fn process(&mut self, event: &TypedEvent, event_index: usize) {
        match (&event.event_type, &event.typed_data) {
            (SessionEventType::UserMessage, TypedEventData::UserMessage(data)) => {
                self.finalize_current_turn(false, None);
                let mut turn = new_turn(
                    self.turns.len(),
                    event.raw.timestamp,
                    data.interaction_id.clone(),
                    data.content.clone(),
                    data.transformed_content.clone(),
                    data.attachments.clone(),
                );
                turn.event_index = Some(event_index);
                turn.model = self.session_model.clone();
                // Flush any session events that occurred between turns
                turn.session_events.append(&mut self.pending_session_events);
                self.current_turn = Some(turn);
            }

            (SessionEventType::AssistantTurnStart, TypedEventData::TurnStart(data)) => {
                let turn = self.ensure_current_turn(event.raw.timestamp);
                if turn.turn_id.is_none() {
                    turn.turn_id = data.turn_id.clone();
                }
                if turn.interaction_id.is_none() {
                    turn.interaction_id = data.interaction_id.clone();
                }
            }

            (SessionEventType::AssistantMessage, TypedEventData::AssistantMessage(data)) => {
                let turn = self.ensure_current_turn(event.raw.timestamp);
                if turn.interaction_id.is_none() {
                    turn.interaction_id = data.interaction_id.clone();
                }
                if let Some(content) = &data.content {
                    if !content.trim().is_empty() {
                        turn.assistant_messages.push(AttributedMessage {
                            content: content.clone(),
                            parent_tool_call_id: data.parent_tool_call_id.clone(),
                            agent_display_name: None, // resolved in finalize()
                        });
                    }
                }
                if let Some(reasoning) = &data.reasoning_text {
                    if !reasoning.trim().is_empty() {
                        turn.reasoning_texts.push(AttributedMessage {
                            content: reasoning.clone(),
                            parent_tool_call_id: data.parent_tool_call_id.clone(),
                            agent_display_name: None, // resolved in finalize()
                        });
                    }
                }
                if let Some(tokens) = data.output_tokens {
                    *turn.output_tokens.get_or_insert(0) += tokens;
                }
                if let Some(requests) = &data.tool_requests {
                    for req in requests {
                        if let (Some(id), Some(summary)) = (
                            req.get("toolCallId").and_then(|v| v.as_str()),
                            req.get("intentionSummary").and_then(|v| v.as_str()),
                        ) {
                            if !summary.trim().is_empty() {
                                self.tool_call_intentions
                                    .insert(id.to_string(), summary.to_string());
                            }
                        }
                    }
                }
            }

            (SessionEventType::ToolExecutionStart, TypedEventData::ToolExecutionStart(data)) => {
                // Dedup: skip if we already have a tool call with this ID
                if let Some(id) = &data.tool_call_id {
                    if self.tool_call_index.contains_key(id) {
                        tracing::debug!(tool_call_id = %id, "Duplicate ToolExecutionStart — skipping");
                        return;
                    }
                }

                // Lookup intention before borrowing self mutably via ensure_current_turn
                let intention = data
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| self.tool_call_intentions.get(id))
                    .cloned();
                let model_from_args = data
                    .arguments
                    .as_ref()
                    .and_then(|args| args.get("model"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string());

                let turn = self.ensure_current_turn(event.raw.timestamp);

                let tc_index = turn.tool_calls.len();
                turn.tool_calls.push(TurnToolCall {
                    tool_call_id: data.tool_call_id.clone(),
                    parent_tool_call_id: data.parent_tool_call_id.clone(),
                    tool_name: data
                        .tool_name
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                    event_index: Some(event_index),
                    arguments: data.arguments.clone(),
                    success: None,
                    error: None,
                    started_at: event.raw.timestamp,
                    completed_at: None,
                    duration_ms: None,
                    mcp_server_name: data.mcp_server_name.clone(),
                    mcp_tool_name: data.mcp_tool_name.clone(),
                    is_complete: false,
                    is_subagent: false,
                    agent_display_name: None,
                    agent_description: None,
                    model: model_from_args,
                    intention_summary: intention,
                    result_content: None,
                    args_summary: None,
                });

                // Index the new tool call
                if let Some(id) = &data.tool_call_id {
                    self.tool_call_index
                        .insert(id.clone(), (CURRENT_TURN_SENTINEL, tc_index));
                }
            }

            (
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(data),
            ) => {
                if let Some(turn) = self.current_turn.as_mut() {
                    if turn.interaction_id.is_none() {
                        turn.interaction_id = data.interaction_id.clone();
                    }
                }

                if let Some(tool_call) = self.find_tool_call_mut(data.tool_call_id.as_deref()) {
                    // For subagents, SubagentCompleted/Failed has authority over success/error.
                    // Only apply ToolExecComplete's values if the subagent terminal event
                    // hasn't already set them (prevents flipping failure→success).
                    if !tool_call.is_subagent || tool_call.success.is_none() {
                        if data.success.is_some() {
                            tool_call.success = data.success;
                        }
                        if let Some(ref err) = data.error {
                            tool_call.error = Some(json_value_to_string(err));
                        }
                    }
                    // For subagents, SubagentCompleted/SubagentFailed owns completion
                    // timing. Don't let ToolExecComplete set completed_at/duration_ms
                    // — it reflects the wrapper tool, not the subagent's actual runtime.
                    if !tool_call.is_subagent {
                        if tool_call.completed_at.is_none()
                            || event.raw.timestamp > tool_call.completed_at
                        {
                            tool_call.completed_at = event.raw.timestamp;
                            tool_call.duration_ms =
                                duration_ms(tool_call.started_at, tool_call.completed_at);
                        }
                        tool_call.is_complete = true;
                    }
                    if data.model.is_some() {
                        tool_call.model = data.model.clone();
                    }
                    if tool_call.parent_tool_call_id.is_none() {
                        tool_call.parent_tool_call_id = data.parent_tool_call_id.clone();
                    }
                    if let Some(result) = &data.result {
                        if let Some(preview) = extract_result_preview(result) {
                            tool_call.result_content = Some(preview);
                        }
                    }
                } else {
                    tracing::debug!(
                        tool_call_id = ?data.tool_call_id,
                        "ToolExecutionComplete with no matching start — skipping"
                    );
                }

                // Set turn-level model from non-subagent completions.
                // Also skip tool calls that are children of a subagent (they carry
                // the subagent's model, not the main agent's). This is a best-effort
                // inline guard; correct_turn_models() handles event-ordering edge
                // cases in post-processing.
                if let Some(ref model) = data.model {
                    let tc_info = self
                        .find_tool_call_ref(data.tool_call_id.as_deref())
                        .map(|tc| (tc.is_subagent, tc.parent_tool_call_id.clone()));
                    if let Some((is_subagent, parent_id)) = tc_info {
                        let parent_is_subagent = parent_id
                            .as_deref()
                            .and_then(|pid| self.find_tool_call_ref(Some(pid)))
                            .map(|p| p.is_subagent)
                            .unwrap_or(false);
                        if !is_subagent && !parent_is_subagent {
                            if let Some(turn) =
                                self.find_owning_turn_mut(data.tool_call_id.as_deref())
                            {
                                if turn.model.is_none() {
                                    turn.model = Some(model.clone());
                                }
                            }
                        }
                    }
                }
            }

            (SessionEventType::SubagentStarted, TypedEventData::SubagentStarted(data)) => {
                if let Some(existing) = self.find_tool_call_mut(data.tool_call_id.as_deref()) {
                    enrich_subagent(existing, data);
                } else {
                    // No matching ToolExecStart — create a new entry in current turn
                    let turn = self.ensure_current_turn(event.raw.timestamp);
                    let tc_index = turn.tool_calls.len();
                    turn.tool_calls.push(TurnToolCall {
                        tool_call_id: data.tool_call_id.clone(),
                        parent_tool_call_id: None,
                        tool_name: data
                            .agent_name
                            .clone()
                            .or_else(|| data.agent_display_name.clone())
                            .unwrap_or_else(|| "subagent".to_string()),
                        event_index: Some(event_index),
                        arguments: None,
                        success: None,
                        error: None,
                        started_at: event.raw.timestamp,
                        completed_at: None,
                        duration_ms: None,
                        mcp_server_name: None,
                        mcp_tool_name: None,
                        is_complete: false,
                        is_subagent: true,
                        agent_display_name: data.agent_display_name.clone(),
                        agent_description: data.agent_description.clone(),
                        model: None,
                        intention_summary: None,
                        result_content: None,
                        args_summary: None,
                    });
                    if let Some(id) = &data.tool_call_id {
                        self.tool_call_index
                            .insert(id.clone(), (CURRENT_TURN_SENTINEL, tc_index));
                    }
                }
            }

            (SessionEventType::SubagentCompleted, TypedEventData::SubagentCompleted(data)) => {
                self.handle_subagent_terminal(
                    data.tool_call_id.as_deref(),
                    event.raw.timestamp,
                    true,
                    None,
                );
            }

            (SessionEventType::SubagentFailed, TypedEventData::SubagentFailed(data)) => {
                self.handle_subagent_terminal(
                    data.tool_call_id.as_deref(),
                    event.raw.timestamp,
                    false,
                    data.error.as_deref(),
                );
            }

            (SessionEventType::AssistantTurnEnd, TypedEventData::TurnEnd(data)) => {
                if let Some(turn) = self.current_turn.as_mut() {
                    if turn.turn_id.is_none() {
                        turn.turn_id = data.turn_id.clone();
                    }
                }
                self.finalize_current_turn(true, event.raw.timestamp);
            }

            // Model change: update session-level model; set turn model if not already set
            (SessionEventType::SessionModelChange, TypedEventData::ModelChange(data)) => {
                if let Some(ref model) = data.new_model {
                    self.session_model = Some(model.clone());
                }
                if let Some(turn) = self.current_turn.as_mut() {
                    if turn.model.is_none() {
                        turn.model = data.new_model.clone();
                    }
                }
            }

            // Abort: finalize the current turn as incomplete
            (SessionEventType::Abort, TypedEventData::Abort(_data)) => {
                self.finalize_current_turn(false, event.raw.timestamp);
            }

            // Standalone reasoning block: append to current turn's reasoning texts
            (SessionEventType::AssistantReasoning, TypedEventData::AssistantReasoning(data)) => {
                if let Some(content) = &data.content {
                    if !content.trim().is_empty() {
                        let turn = self.ensure_current_turn(event.raw.timestamp);
                        turn.reasoning_texts.push(AttributedMessage {
                            content: content.clone(),
                            parent_tool_call_id: None,
                            agent_display_name: None,
                        });
                    }
                }
            }

            // ── Session-level events ────────────────────────────────────
            (SessionEventType::SessionError, TypedEventData::SessionError(data)) => {
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

            (SessionEventType::SessionWarning, TypedEventData::SessionWarning(data)) => {
                let summary = data
                    .message
                    .clone()
                    .unwrap_or_else(|| "Session warning".to_string());
                self.push_session_event(
                    "session.warning",
                    event.raw.timestamp,
                    SessionEventSeverity::Warning,
                    summary,
                );
            }

            (SessionEventType::SessionCompactionStart, TypedEventData::CompactionStart(_data)) => {
                self.push_session_event(
                    "session.compaction_start",
                    event.raw.timestamp,
                    SessionEventSeverity::Info,
                    "Context compaction started".to_string(),
                );
            }

            (
                SessionEventType::SessionCompactionComplete,
                TypedEventData::CompactionComplete(data),
            ) => {
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
                self.push_session_event(
                    "session.compaction_complete",
                    event.raw.timestamp,
                    severity,
                    summary,
                );
            }

            (SessionEventType::SessionTruncation, TypedEventData::SessionTruncation(data)) => {
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

            (SessionEventType::SessionPlanChanged, TypedEventData::PlanChanged(data)) => {
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

            (SessionEventType::SessionModeChanged, TypedEventData::SessionModeChanged(data)) => {
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
            (SessionEventType::SessionStart, TypedEventData::SessionStart(data)) => {
                if self.session_model.is_none() {
                    if let Some(ref model) = data.selected_model {
                        self.session_model = Some(model.clone());
                    }
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

            (SessionEventType::SessionResume, TypedEventData::SessionResume(data)) => {
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

            _ => {}
        }
    }

    /// Finalize any in-progress turn, run post-processing, and return all turns.
    pub fn finalize(mut self) -> Vec<ConversationTurn> {
        self.finalize_current_turn(false, None);

        // Attach any remaining buffered session events to the last turn,
        // or create a synthetic turn if no turns exist (e.g., failed-start sessions).
        if !self.pending_session_events.is_empty() {
            if let Some(last) = self.turns.last_mut() {
                last.session_events.append(&mut self.pending_session_events);
            } else {
                let ts = self
                    .pending_session_events
                    .first()
                    .and_then(|e| e.timestamp);
                let mut turn = new_turn(0, ts, None, None, None, None);
                turn.session_events.append(&mut self.pending_session_events);
                self.turns.push(turn);
            }
        }

        infer_subagent_models(&mut self.turns);
        finalize_subagent_completion(&mut self.turns);
        correct_turn_models(&mut self.turns);
        resolve_agent_display_names(&mut self.turns);
        self.turns
    }

    // ── State helpers ─────────────────────────────────────────────────

    /// Push a session event into the current turn, or buffer it for the next one.
    fn push_session_event(
        &mut self,
        event_type: &str,
        timestamp: Option<DateTime<Utc>>,
        severity: SessionEventSeverity,
        summary: String,
    ) {
        let se = TurnSessionEvent {
            event_type: event_type.to_string(),
            timestamp,
            severity,
            summary,
        };
        if let Some(turn) = &mut self.current_turn {
            turn.session_events.push(se);
        } else {
            self.pending_session_events.push(se);
        }
    }

    fn ensure_current_turn(&mut self, timestamp: Option<DateTime<Utc>>) -> &mut ConversationTurn {
        if self.current_turn.is_none() {
            let mut turn = new_turn(self.turns.len(), timestamp, None, None, None, None);
            // Inherit session model, same as UserMessage does
            turn.model = self.session_model.clone();
            // Flush any session events that occurred while no turn was active
            turn.session_events.append(&mut self.pending_session_events);
            self.current_turn = Some(turn);
        }
        self.current_turn.as_mut().unwrap()
    }

    fn finalize_current_turn(&mut self, is_complete: bool, end_timestamp: Option<DateTime<Utc>>) {
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
    fn find_tool_call_mut(&mut self, tool_call_id: Option<&str>) -> Option<&mut TurnToolCall> {
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
    fn find_tool_call_ref(&self, tool_call_id: Option<&str>) -> Option<&TurnToolCall> {
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
    fn find_owning_turn_mut(
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
    fn handle_subagent_terminal(
        &mut self,
        tool_call_id: Option<&str>,
        timestamp: Option<DateTime<Utc>>,
        success: bool,
        error: Option<&str>,
    ) {
        if let Some(tool_call) = self.find_tool_call_mut(tool_call_id) {
            // Mark as subagent — handles the case where SubagentCompleted arrives
            // before SubagentStarted (so enrich_subagent can detect this later).
            tool_call.is_subagent = true;
            if tool_call.completed_at.is_none() || timestamp > tool_call.completed_at {
                tool_call.completed_at = timestamp;
                tool_call.duration_ms = duration_ms(tool_call.started_at, tool_call.completed_at);
            }
            tool_call.success = Some(success);
            if let Some(err) = error {
                tool_call.error = Some(err.to_string());
            }
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

// ── Helper functions ──────────────────────────────────────────────────

/// Create a new conversation turn with the given initial data.
fn new_turn(
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
    }
}

/// Enrich an existing tool call entry with subagent metadata.
fn enrich_subagent(
    existing: &mut TurnToolCall,
    data: &crate::models::event_types::SubagentStartedData,
) {
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
