//! Tool execution and subagent lifecycle handlers.

use crate::models::conversation::TurnToolCall;
use crate::models::event_types::{SubagentStartedData, ToolExecCompleteData, ToolExecStartData};
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
        if let (Some(event_id), Some(tool_call_id)) = (&event.raw.id, &data.tool_call_id) {
            self.tool_event_to_call_id
                .insert(event_id.clone(), tool_call_id.clone());
        }

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
        let args = data.arguments.as_ref();
        // Background child logs may be flushed only when read_agent runs. The
        // built-in task invocation already tells us a subagent is being launched.
        let is_subagent = data.tool_name.as_deref() == Some("task")
            && data.mcp_server_name.is_none()
            && args
                .and_then(|a| a.get("agent_type"))
                .and_then(|v| v.as_str())
                .is_some();
        let parent = data
            .parent_tool_call_id
            .clone()
            .or_else(|| self.event_owner(event));

        let (turn, turn_index) = self.turn_for_event(event);

        let tc_index = turn.tool_calls.len();
        turn.tool_calls.push(TurnToolCall {
            tool_call_id: data.tool_call_id.clone(),
            parent_tool_call_id: parent,
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
            is_subagent,
            agent_id: None,
            agent_status: None,
            cancelled: None,
            agent_display_name: if is_subagent {
                args.and_then(|a| a.get("name"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            } else {
                None
            },
            agent_description: if is_subagent {
                args.and_then(|a| a.get("description"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            } else {
                None
            },
            model: if is_subagent {
                model_from_args.clone()
            } else {
                data.model.clone().or(model_from_args.clone())
            },
            requested_model: model_from_args,
            intention_summary: intention,
            total_tokens: None,
            total_tool_calls: None,
            result_content: None,
            args_summary: None,
            skill_invocation: None,
        });

        // Index the new tool call
        if let Some(id) = &data.tool_call_id {
            self.tool_call_index
                .insert(id.clone(), (turn_index, tc_index));
        }
    }

    pub(super) fn handle_tool_execution_complete(
        &mut self,
        event: &TypedEvent,
        data: &ToolExecCompleteData,
    ) {
        if let (Some(event_id), Some(tool_call_id)) = (&event.raw.id, &data.tool_call_id) {
            self.tool_event_to_call_id
                .insert(event_id.clone(), tool_call_id.clone());
        }

        if event.raw.agent_id.is_none()
            && data.parent_tool_call_id.is_none()
            && let Some(turn) = self.current_turn.as_mut()
            && turn.interaction_id.is_none()
        {
            turn.interaction_id = data.interaction_id.clone();
        }

        let started = data
            .tool_call_id
            .as_ref()
            .is_some_and(|id| self.started_subagents.contains(id));
        let agent_id = data
            .tool_telemetry
            .as_ref()
            .and_then(|v| v.pointer("/restrictedProperties/agent_id"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let parent = data
            .parent_tool_call_id
            .clone()
            .or_else(|| self.event_owner(event));
        if let Some(tool_call) = self.find_tool_call_mut(data.tool_call_id.as_deref()) {
            if tool_call.is_subagent && agent_id.is_some() {
                tool_call.agent_id = agent_id.clone();
            }
            let launch_failed = tool_call.is_subagent && !started && data.success == Some(false);
            // For subagents, SubagentCompleted/Failed has authority over success/error.
            // Only apply ToolExecComplete's values if the subagent terminal event
            // hasn't already set them (prevents flipping failure→success).
            if !tool_call.is_subagent || launch_failed {
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
            if !tool_call.is_subagent || launch_failed {
                if tool_call.completed_at.is_none() || event.raw.timestamp > tool_call.completed_at
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
            if data.model.is_some() && !tool_call.is_subagent {
                tool_call.model = data.model.clone();
            }
            if tool_call.parent_tool_call_id.is_none() {
                tool_call.parent_tool_call_id = parent;
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
        if let (Some(agent_id), Some(tool_id)) = (agent_id, &data.tool_call_id)
            && self
                .find_tool_call_ref(Some(tool_id))
                .is_some_and(|tc| tc.is_subagent)
        {
            self.agent_owners.insert(agent_id, tool_id.clone());
        }

        // Set turn-level model from non-subagent completions.
        self.handle_agent_control_complete(event, data);
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
                    && let Some(turn) = self.find_owning_turn_mut(data.tool_call_id.as_deref())
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
        if let Some(id) = &data.tool_call_id {
            self.started_subagents.insert(id.clone());
            if data.model.is_some() {
                self.authoritative_subagent_models.insert(id.clone());
            }
        }
        let parent = data
            .parent_id
            .as_deref()
            .map(|id| self.resolve_agent_id(id));
        if let Some(existing) = self.find_tool_call_mut(data.tool_call_id.as_deref()) {
            enrich_subagent(existing, data);
            if existing.parent_tool_call_id.is_none() {
                existing.parent_tool_call_id = parent;
            }
            if event.raw.agent_id.is_some() {
                existing.agent_id = event.raw.agent_id.clone();
            }
        } else {
            // No matching ToolExecStart — create a new entry in current turn
            let turn = self.ensure_current_turn(event.raw.timestamp);
            let tc_index = turn.tool_calls.len();
            turn.tool_calls.push(TurnToolCall {
                tool_call_id: data.tool_call_id.clone(),
                parent_tool_call_id: parent,
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
                agent_id: event.raw.agent_id.clone(),
                agent_status: None,
                cancelled: None,
                agent_display_name: data.agent_display_name.clone(),
                agent_description: data.agent_description.clone(),
                model: data.model.clone(),
                requested_model: None,
                intention_summary: None,
                total_tokens: None,
                total_tool_calls: None,
                result_content: None,
                args_summary: None,
                skill_invocation: None,
            });
            if let Some(id) = &data.tool_call_id {
                self.tool_call_index
                    .insert(id.clone(), (CURRENT_TURN_SENTINEL, tc_index));
            }
        }
    }
}
