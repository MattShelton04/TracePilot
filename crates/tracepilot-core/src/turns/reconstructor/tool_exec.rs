//! Tool execution and subagent lifecycle handlers.

use crate::models::conversation::TurnToolCall;
use crate::models::event_types::{
    SubagentStartedData, ToolExecCompleteData, ToolExecStartData,
};
use crate::parsing::events::TypedEvent;

use super::super::utils::{duration_ms, extract_result_preview, json_value_to_string};
use super::state::enrich_subagent;
use super::{CURRENT_TURN_SENTINEL, TurnReconstructor};

impl TurnReconstructor {
    pub(super) fn handle_tool_execution_start(
        &mut self,
        event: &TypedEvent,
        event_index: usize,
        data: &ToolExecStartData,
    ) {
        // Dedup: skip if we already have a tool call with this ID
        if let Some(id) = &data.tool_call_id
            && self.tool_call_index.contains_key(id)
        {
            tracing::debug!(tool_call_id = %id, "Duplicate ToolExecutionStart — skipping");
            return;
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
            model: model_from_args.clone(),
            requested_model: model_from_args,
            intention_summary: intention,
            total_tokens: None,
            total_tool_calls: None,
            result_content: None,
            args_summary: None,
        });

        // Index the new tool call
        if let Some(id) = &data.tool_call_id {
            self.tool_call_index
                .insert(id.clone(), (CURRENT_TURN_SENTINEL, tc_index));
        }
    }

    pub(super) fn handle_tool_execution_complete(
        &mut self,
        event: &TypedEvent,
        data: &ToolExecCompleteData,
    ) {
        if let Some(turn) = self.current_turn.as_mut()
            && turn.interaction_id.is_none()
        {
            turn.interaction_id = data.interaction_id.clone();
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
            // For subagents, SubagentCompleted/Failed has the authoritative model.
            // Only apply ToolExecComplete's model for non-subagent tool calls,
            // or as a fallback if the subagent hasn't reported its own model yet.
            if data.model.is_some() && (!tool_call.is_subagent || tool_call.model.is_none()) {
                tool_call.model = data.model.clone();
            }
            if tool_call.parent_tool_call_id.is_none() {
                tool_call.parent_tool_call_id = data.parent_tool_call_id.clone();
            }
            if let Some(result) = &data.result
                && let Some(preview) = extract_result_preview(result)
            {
                tool_call.result_content = Some(preview);
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
                .map(|tc| (tc.is_subagent, tc.parent_tool_call_id.as_deref()));
            if let Some((is_subagent, parent_id)) = tc_info {
                let parent_is_subagent = parent_id
                    .and_then(|pid| self.find_tool_call_ref(Some(pid)))
                    .map(|p| p.is_subagent)
                    .unwrap_or(false);
                if !is_subagent
                    && !parent_is_subagent
                    && let Some(turn) =
                        self.find_owning_turn_mut(data.tool_call_id.as_deref())
                    && turn.model.is_none()
                {
                    turn.model = Some(model.clone());
                }
            }
        }
    }

    pub(super) fn handle_subagent_started(
        &mut self,
        event: &TypedEvent,
        event_index: usize,
        data: &SubagentStartedData,
    ) {
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
                requested_model: None,
                intention_summary: None,
                total_tokens: None,
                total_tool_calls: None,
                result_content: None,
                args_summary: None,
            });
            if let Some(id) = &data.tool_call_id {
                self.tool_call_index
                    .insert(id.clone(), (CURRENT_TURN_SENTINEL, tc_index));
            }
        }
    }
}
