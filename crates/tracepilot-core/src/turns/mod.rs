//! Conversation turn reconstruction from flat typed event streams.
//!
//! ## Architecture
//!
//! [`TurnReconstructor`] is an encapsulated state machine that processes a
//! chronologically-ordered stream of [`TypedEvent`]s and produces a
//! `Vec<ConversationTurn>`.
//!
//! ## State Machine
//!
//! Turn reconstruction has two logical states: **idle** (`current_turn == None`)
//! and **in-turn** (`current_turn == Some(...)`):
//!
//! 1. A `UserMessage` opens a new turn (finalizing any previous one)
//! 2. `AssistantTurnStart` / `AssistantTurnEnd` bracket the assistant's response
//! 3. `ToolExecutionStart` / `ToolExecutionComplete` are paired into `TurnToolCall`s
//! 4. `SubagentStarted` / `SubagentCompleted` / `SubagentFailed` are treated as
//!    nested tool calls within the enclosing turn
//! 5. `AssistantMessage` appends content to the current turn
//! 6. `SessionModelChange` sets the turn-level model when no tool completion has
//! 7. `Abort` finalizes the current turn as incomplete
//!
//! Events that don't affect turn state (e.g. `SessionInfo`, `SystemNotification`)
//! are silently skipped.
//!
//! ## Tool Call Indexing
//!
//! Tool calls are tracked by `tool_call_id` in a `HashMap<String, (usize, usize)>`
//! mapping `id → (turn_index, tool_call_index)` for O(1) lookups. This replaces
//! the previous O(T×C) reverse linear scan pattern.
//!
//! ## Assumptions
//!
//! - Events are ordered chronologically (as written to `events.jsonl`)
//! - `parentId` links are used for subagent nesting, not for turn ordering
//! - A session may end mid-turn (no `TurnEnd`); the final turn is still emitted

use std::collections::HashMap;

use crate::models::conversation::{AttributedMessage, ConversationTurn, TurnToolCall};
use crate::models::event_types::SessionEventType;
use crate::parsing::events::{TypedEvent, TypedEventData};
use chrono::{DateTime, Utc};

/// Aggregate statistics for reconstructed turns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnStats {
    pub total_turns: usize,
    pub complete_turns: usize,
    pub incomplete_turns: usize,
    pub total_tool_calls: usize,
    pub total_messages: usize,
    pub models_used: Vec<String>,
}

/// Reconstruct conversation turns from a flat stream of typed events.
///
/// This is the public entry point — it delegates to [`TurnReconstructor`].
pub fn reconstruct_turns(events: &[TypedEvent]) -> Vec<ConversationTurn> {
    let mut reconstructor = TurnReconstructor::new();
    for event in events {
        reconstructor.process(event);
    }
    reconstructor.finalize()
}

/// Compute summary statistics for reconstructed turns.
pub fn turn_stats(turns: &[ConversationTurn]) -> TurnStats {
    let mut models_set = std::collections::HashSet::new();

    for model in turns.iter().filter_map(|turn| turn.model.as_ref()) {
        models_set.insert(model.clone());
    }
    let models_used: Vec<String> = models_set.into_iter().collect();

    TurnStats {
        total_turns: turns.len(),
        complete_turns: turns.iter().filter(|turn| turn.is_complete).count(),
        incomplete_turns: turns.iter().filter(|turn| !turn.is_complete).count(),
        total_tool_calls: turns.iter().map(|turn| turn.tool_calls.len()).sum(),
        total_messages: turns.iter().map(|turn| turn.assistant_messages.len()).sum(),
        models_used,
    }
}

// ── TurnReconstructor ─────────────────────────────────────────────────

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
struct TurnReconstructor {
    turns: Vec<ConversationTurn>,
    current_turn: Option<ConversationTurn>,
    tool_call_intentions: HashMap<String, String>,
    /// Maps tool_call_id → (turn_index, tool_call_index).
    /// `turn_index == CURRENT_TURN_SENTINEL` means the tool call is in `current_turn`.
    tool_call_index: HashMap<String, (usize, usize)>,
    /// Tracks the most recent session-level model, so new turns inherit it.
    session_model: Option<String>,
}

const CURRENT_TURN_SENTINEL: usize = usize::MAX;

impl TurnReconstructor {
    fn new() -> Self {
        Self {
            turns: Vec::new(),
            current_turn: None,
            tool_call_intentions: HashMap::new(),
            tool_call_index: HashMap::new(),
            session_model: None,
        }
    }

    /// Process a single event, advancing the state machine.
    fn process(&mut self, event: &TypedEvent) {
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
                turn.model = self.session_model.clone();
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

                // Set turn-level model from non-subagent completions
                if let Some(ref model) = data.model {
                    let is_subagent = self
                        .find_tool_call_ref(data.tool_call_id.as_deref())
                        .map(|tc| tc.is_subagent)
                        .unwrap_or(false);
                    if !is_subagent {
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

            _ => {}
        }
    }

    /// Finalize any in-progress turn, run post-processing, and return all turns.
    fn finalize(mut self) -> Vec<ConversationTurn> {
        self.finalize_current_turn(false, None);
        infer_subagent_models(&mut self.turns);
        finalize_subagent_completion(&mut self.turns);
        resolve_agent_display_names(&mut self.turns);
        self.turns
    }

    // ── State helpers ─────────────────────────────────────────────────

    fn ensure_current_turn(&mut self, timestamp: Option<DateTime<Utc>>) -> &mut ConversationTurn {
        self.current_turn.get_or_insert_with(|| {
            new_turn(self.turns.len(), timestamp, None, None, None, None)
        })
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

// ── Free functions (unchanged public contract) ────────────────────────

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
    if let Some(name) = data.agent_name.as_ref().or(data.agent_display_name.as_ref()) {
        existing.tool_name = name.clone();
    }
}

/// Post-processing: infer subagent models from their child tool calls.
///
/// Uses a fixed-point loop since model inference can propagate through
/// multiple nesting levels (subagent → child subagent → tool call).
fn infer_subagent_models(turns: &mut [ConversationTurn]) {
    // Cap iterations to prevent infinite loops from cyclic parent_tool_call_id data.
    // Valid DAGs converge in at most depth iterations; we use total tool calls as a safe bound.
    let max_iterations = turns.iter().map(|t| t.tool_calls.len()).sum::<usize>().max(1);
    let mut iterations = 0;

    loop {
        let mut changed = false;
        for turn in turns.iter_mut() {
            // Build map: tool_call_id → first child model found
            let mut child_models: HashMap<String, String> = HashMap::new();
            for tc in turn.tool_calls.iter() {
                if let (Some(model), Some(parent_id)) = (&tc.model, &tc.parent_tool_call_id) {
                    child_models
                        .entry(parent_id.clone())
                        .or_insert_with(|| model.clone());
                }
            }
            // Propagate to subagents — prefer child model over parent's ToolExecComplete model
            for tc in turn.tool_calls.iter_mut() {
                if tc.is_subagent {
                    if let Some(ref id) = tc.tool_call_id {
                        if let Some(model) = child_models.get(id) {
                            if tc.model.as_deref() != Some(model.as_str()) {
                                tc.model = Some(model.clone());
                                changed = true;
                            }
                        } else {
                            // No child tool calls — fall back to model from arguments
                            let args_model = tc
                                .arguments
                                .as_ref()
                                .and_then(|a| a.get("model"))
                                .and_then(|m| m.as_str())
                                .map(|s| s.to_string());
                            if let Some(ref m) = args_model {
                                if tc.model.as_deref() != Some(m.as_str()) {
                                    tc.model = args_model;
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        if !changed {
            break;
        }
        iterations += 1;
        if iterations >= max_iterations {
            tracing::warn!(
                iterations,
                "infer_subagent_models hit iteration cap — possible cyclic parent_tool_call_id"
            );
            break;
        }
    }
}

/// Post-processing: mark subagents complete when lifecycle events partially arrived.
///
/// After our fix, `completed_at` on a subagent is ONLY set by `SubagentCompleted`
/// or `SubagentFailed` (via `handle_subagent_terminal`). If a subagent has
/// `completed_at` set but `is_complete` is still false (e.g., due to event
/// reordering where `enrich_subagent` cleared it), this finalizes it.
///
/// Subagents without `completed_at` are truly still running (or truncated) and
/// should remain `is_complete = false` so the UI shows them as in-progress.
fn finalize_subagent_completion(turns: &mut [ConversationTurn]) {
    for turn in turns.iter_mut() {
        for tc in turn.tool_calls.iter_mut() {
            if tc.is_subagent && !tc.is_complete && tc.completed_at.is_some() {
                tracing::debug!(
                    tool_call_id = ?tc.tool_call_id,
                    "Subagent has completed_at but no terminal event — inferring completion"
                );
                tc.is_complete = true;
                if tc.success.is_none() {
                    tc.success = Some(tc.error.is_none());
                }
            }
        }
    }
}

/// Post-processing: resolve `agent_display_name` on attributed messages/reasoning.
///
/// For each `AttributedMessage` with a `parent_tool_call_id`, looks up the matching
/// subagent tool call in the same turn and copies its `agent_display_name`.
fn resolve_agent_display_names(turns: &mut [ConversationTurn]) {
    for turn in turns.iter_mut() {
        // Build lookup: tool_call_id → agent_display_name
        let agent_names: HashMap<String, String> = turn
            .tool_calls
            .iter()
            .filter(|tc| tc.is_subagent)
            .filter_map(|tc| {
                let id = tc.tool_call_id.as_ref()?;
                let name = tc.agent_display_name.as_ref()?;
                Some((id.clone(), name.clone()))
            })
            .collect();

        if agent_names.is_empty() {
            continue;
        }

        for msg in turn
            .assistant_messages
            .iter_mut()
            .chain(turn.reasoning_texts.iter_mut())
        {
            if let Some(parent_id) = &msg.parent_tool_call_id {
                if msg.agent_display_name.is_none() {
                    msg.agent_display_name = agent_names.get(parent_id).cloned();
                }
            }
        }
    }
}

fn duration_ms(start: Option<DateTime<Utc>>, end: Option<DateTime<Utc>>) -> Option<u64> {
    let (Some(start), Some(end)) = (start, end) else {
        return None;
    };

    let millis = end.signed_duration_since(start).num_milliseconds();
    (millis >= 0).then_some(millis as u64)
}

fn json_value_to_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

const RESULT_PREVIEW_MAX_BYTES: usize = 1024;

/// Truncate a string to a maximum byte length, respecting UTF-8 boundaries.
fn truncate_str(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let truncate_at = s
        .char_indices()
        .map(|(idx, _)| idx)
        .take_while(|idx| *idx <= max_bytes)
        .last()
        .unwrap_or(0);
    format!("{}…[truncated]", &s[..truncate_at])
}

/// Extract a truncated result preview from a polymorphic `result` field.
/// The result can be a plain string, an object with `content`/`detailedContent`, or other shapes.
fn extract_result_preview(result: &serde_json::Value) -> Option<String> {
    match result {
        serde_json::Value::String(s) => {
            if s.trim().is_empty() {
                None
            } else {
                Some(truncate_str(s, RESULT_PREVIEW_MAX_BYTES))
            }
        }
        serde_json::Value::Object(obj) => {
            let text = obj
                .get("content")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    obj.get("detailedContent")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                });
            text.map(|s| truncate_str(s, RESULT_PREVIEW_MAX_BYTES))
        }
        _ => None,
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
