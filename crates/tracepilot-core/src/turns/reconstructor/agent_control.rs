//! Persisted read_agent/write_agent telemetry completes the multi-turn lifecycle.
//! Child logs only emit subagent.completed for their initial invocation in 1.0.83.

use super::TurnReconstructor;
use crate::models::event_types::ToolExecCompleteData;
use crate::parsing::events::TypedEvent;

impl TurnReconstructor {
    pub(super) fn handle_agent_control_complete(
        &mut self,
        event: &TypedEvent,
        data: &ToolExecCompleteData,
    ) {
        if data.success != Some(true) {
            return;
        }
        let Some(control) = self.find_tool_call_ref(data.tool_call_id.as_deref()) else {
            return;
        };
        if control.mcp_server_name.is_some() {
            return;
        }
        let is_write = control.tool_name == "write_agent";
        if !is_write && control.tool_name != "read_agent" {
            return;
        }
        let telemetry = data.tool_telemetry.as_ref();
        let agent_id = telemetry
            .and_then(|v| v.pointer("/properties/agent_id"))
            .and_then(|v| v.as_str())
            .or_else(|| control.arguments.as_ref()?.get("agent_id")?.as_str());
        let Some(agent_id) = agent_id else {
            return;
        };
        let owner = self.resolve_agent_id(agent_id);
        let status = if is_write {
            Some("running")
        } else {
            telemetry
                .and_then(|v| v.pointer("/properties/status"))
                .and_then(|v| v.as_str())
        };
        let Some(status @ ("running" | "pending" | "idle" | "completed" | "failed" | "cancelled")) =
            status
        else {
            return;
        };
        // An idle worker with queued messages still has outstanding work.
        let queued = telemetry
            .and_then(|v| v.pointer("/metrics/queue_depth"))
            .and_then(|v| v.as_u64())
            .is_some_and(|depth| depth > 0);
        let status = if queued && matches!(status, "idle" | "completed") {
            "pending"
        } else {
            status
        };
        if is_write {
            self.followup_agents.insert(owner.clone());
        }
        let Some(agent) = self
            .find_tool_call_mut(Some(&owner))
            .filter(|tc| tc.is_subagent)
        else {
            return;
        };
        let running = matches!(status, "running" | "pending");
        let was_complete = agent.is_complete;
        if running {
            agent.is_complete = false;
            agent.completed_at = None;
            agent.duration_ms = None;
            agent.success = None;
            agent.error = None;
            agent.cancelled = None;
            // Initial invocation counters are not cumulative follow-up metrics.
            agent.total_tokens = None;
            agent.total_tool_calls = None;
        } else if !was_complete || matches!(status, "failed" | "cancelled") {
            agent.is_complete = true;
            agent.completed_at = event.raw.timestamp;
            agent.duration_ms = telemetry
                .and_then(|v| v.pointer("/metrics/elapsed_seconds"))
                .and_then(|v| v.as_u64())
                .and_then(|seconds| seconds.checked_mul(1000));
            agent.success = Some(matches!(status, "idle" | "completed"));
            agent.cancelled = Some(status == "cancelled");
            if status == "cancelled" {
                agent.error = Some("Cancelled".into());
            }
        }
        // A later successful read must not erase a recorded cancellation/failure.
        if running
            || !was_complete
            || matches!(status, "failed" | "cancelled")
            || (agent.success != Some(false) && agent.cancelled != Some(true))
        {
            agent.agent_status = Some(status.to_string());
        }
    }
}
