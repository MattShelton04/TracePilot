//! Post-processing functions for turn reconstruction.
//!
//! These functions run after all events have been processed by the state machine
//! to perform cleanup, inference, and correction operations on the reconstructed turns.

use std::collections::{HashMap, HashSet};

use crate::models::conversation::ConversationTurn;

/// Post-processing: infer subagent models from their child tool calls.
///
/// Uses a fixed-point loop since model inference can propagate through
/// multiple nesting levels (subagent → child subagent → tool call).
pub(crate) fn infer_subagent_models(turns: &mut [ConversationTurn]) {
    // Cap iterations to prevent infinite loops from cyclic parent_tool_call_id data.
    // Valid DAGs converge in at most depth iterations; we use total tool calls as a safe bound.
    let max_iterations = turns
        .iter()
        .map(|t| t.tool_calls.len())
        .sum::<usize>()
        .max(1);
    let mut iterations = 0;

    loop {
        // Build a session-wide map: tool_call_id → first child model found.
        //
        // IMPORTANT: this must scan ALL turns, not just the current turn. For background
        // subagents, the main agent's turn ends before the subagent's child tool calls arrive,
        // so the children live in later synthetic turns. A per-turn scan would miss them and
        // incorrectly fall back to the requested args model, overwriting the authoritative
        // actual model set by SubagentCompleted.
        let mut child_models: HashMap<String, String> = HashMap::new();
        for turn in turns.iter() {
            for tc in turn.tool_calls.iter() {
                if let (Some(model), Some(parent_id)) = (&tc.model, &tc.parent_tool_call_id) {
                    // First-child-wins: assumes all children of a given subagent
                    // report the same model. If the CLI ever supports mid-subagent
                    // model switching, this should be revisited (last-child or
                    // most-common may be more accurate).
                    child_models
                        .entry(parent_id.clone())
                        .or_insert_with(|| model.clone());
                }
            }
        }

        let mut changed = false;
        for turn in turns.iter_mut() {
            // Propagate to subagents — prefer child model over parent's ToolExecComplete model
            for tc in turn.tool_calls.iter_mut() {
                if tc.is_subagent
                    && let Some(ref id) = tc.tool_call_id
                {
                    if let Some(model) = child_models.get(id) {
                        if tc.model.as_deref() != Some(model.as_str()) {
                            tc.model = Some(model.clone());
                            changed = true;
                        }
                    }
                    // No children and model is already set (from terminal event or ToolExecStart
                    // args): leave as-is. `requested_model` tracks what was configured;
                    // `model` should only be updated by observed events.
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
pub(crate) fn finalize_subagent_completion(turns: &mut [ConversationTurn]) {
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

/// Post-processing: correct `turn.model` when it was set from subagent child tool calls.
///
/// Some tool calls that run under a subagent carry the subagent's model but have
/// `is_subagent = false` (they are regular tools dispatched by the subagent). If such
/// a tool's `ToolExecutionComplete` arrives before the parent subagent is marked
/// `is_subagent = true`, the inline guard in `process()` cannot catch it, and
/// `turn.model` may be incorrectly set to the subagent's model.
///
/// This function runs after all events are processed (when subagent flags are final)
/// and corrects any polluted turn models. It also forward-fills `None` models from
/// the nearest preceding turn with a known model.
pub(crate) fn correct_turn_models(turns: &mut [ConversationTurn]) {
    // Build session-wide set of subagent tool call IDs.
    let subagent_ids: HashSet<String> = turns
        .iter()
        .flat_map(|t| t.tool_calls.iter())
        .filter(|tc| tc.is_subagent)
        .filter_map(|tc| tc.tool_call_id.clone())
        .collect();

    if subagent_ids.is_empty() {
        return;
    }

    // Build session-wide set of subagent models for cross-turn pollution detection.
    let subagent_models: HashSet<String> = turns
        .iter()
        .flat_map(|t| t.tool_calls.iter())
        .filter(|tc| tc.is_subagent)
        .filter_map(|tc| tc.model.clone())
        .collect();

    // Pass 1: correct or clear polluted models.
    for turn in turns.iter_mut() {
        // Find the model from direct main-agent tool calls: tool calls that are
        // neither subagents themselves, nor children of a subagent.
        let main_agent_model = turn
            .tool_calls
            .iter()
            .filter(|tc| !tc.is_subagent)
            .filter(|tc| {
                tc.parent_tool_call_id
                    .as_ref()
                    .is_none_or(|pid| !subagent_ids.contains(pid))
            })
            .find_map(|tc| tc.model.clone());

        if let Some(ref correct_model) = main_agent_model {
            // Turn has a real main-agent tool call with a known model — use it.
            if turn.model.as_ref() != Some(correct_model) {
                tracing::debug!(
                    turn_index = turn.turn_index,
                    old_model = ?turn.model,
                    new_model = %correct_model,
                    "Correcting turn model from main-agent tool call"
                );
                turn.model = Some(correct_model.clone());
            }
        } else if let Some(ref current_model) = turn.model {
            // No direct main-agent tool calls with a model in this turn.
            // Check session-wide: if turn.model matches ANY subagent model from
            // the entire session, it was likely inherited from a polluted
            // session_model or set by a cross-turn subagent child.
            if subagent_models.contains(current_model) {
                tracing::debug!(
                    turn_index = turn.turn_index,
                    polluted_model = %current_model,
                    "Clearing turn model that matches a subagent model"
                );
                turn.model = None;
            }
        }
    }

    // Pass 2: forward-fill None models from the nearest preceding turn.
    // If a turn has no model after correction, inherit from the previous turn.
    // This handles cases where session_model was polluted and the turn had no
    // direct main-agent tool calls to derive a model from.
    let mut last_known_model: Option<String> = None;
    for turn in turns.iter_mut() {
        if let Some(ref model) = turn.model {
            last_known_model = Some(model.clone());
        } else if let Some(ref fallback) = last_known_model {
            tracing::debug!(
                turn_index = turn.turn_index,
                inherited_model = %fallback,
                "Forward-filling turn model from previous turn"
            );
            turn.model = Some(fallback.clone());
        }
    }
}

/// Post-processing: resolve `agent_display_name` on attributed messages/reasoning.
///
/// For each `AttributedMessage` with a `parent_tool_call_id`, looks up the matching
/// subagent tool call in the same turn and copies its `agent_display_name`.
pub(crate) fn resolve_agent_display_names(turns: &mut [ConversationTurn]) {
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
            if let Some(parent_id) = &msg.parent_tool_call_id
                && msg.agent_display_name.is_none()
            {
                msg.agent_display_name = agent_names.get(parent_id).cloned();
            }
        }
    }
}
