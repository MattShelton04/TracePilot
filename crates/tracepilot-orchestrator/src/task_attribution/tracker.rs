//! Attribution tracker — parses subagent events to link tasks.
//!
//! Convention: orchestrator names subagents `tp-{task_id}`. The Copilot CLI's
//! `subagent.started` events record the agent *type* (e.g. "general-purpose")
//! in `agent_name`, NOT the custom name from the `task` tool. To recover the
//! custom name we join on `toolCallId`:
//!
//!   tool.execution_start (toolName="task", arguments.name="tp-{task_id}")
//!       → toolCallId
//!   subagent.started (toolCallId=same)
//!       → we know this subagent is for that task

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};

/// The naming prefix for TracePilot task subagents.
const TASK_AGENT_PREFIX: &str = "tp-";

/// Status of a subagent executing a task.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubagentStatus {
    Spawning,
    Running,
    Completed,
    Failed,
}

/// A tracked subagent linked to a task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedSubagent {
    pub task_id: String,
    pub agent_name: String,
    pub status: SubagentStatus,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

/// Attribution snapshot from a single scan of events.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttributionSnapshot {
    pub subagents: Vec<TrackedSubagent>,
    pub events_scanned: usize,
}

/// Extract task_id from agent_name if it matches the `tp-{task_id}` convention.
pub fn extract_task_id(agent_name: &str) -> Option<&str> {
    agent_name.strip_prefix(TASK_AGENT_PREFIX)
}

/// Build an attribution snapshot from pre-parsed events.
///
/// The Copilot CLI `subagent.started` events do NOT contain the custom `name`
/// parameter from the `task` tool — they only have the agent type (e.g.
/// "general-purpose"). To correlate subagents with tasks, we:
///
/// 1. Scan `tool.execution_start` events where `toolName == "task"` to build a
///    map of `toolCallId → custom_name` (from `arguments.name`).
/// 2. Match `subagent.started/completed/failed` events via their `toolCallId`
///    to resolve the custom name and thus the task ID.
pub fn build_attribution(events: &[TypedEvent]) -> AttributionSnapshot {
    // Phase 1: build toolCallId → custom_name map from task tool invocations
    let mut tool_call_names: HashMap<String, String> = HashMap::new();
    for event in events {
        if let TypedEventData::ToolExecutionStart(ref data) = event.typed_data {
            if data.tool_name.as_deref() == Some("task") {
                if let (Some(call_id), Some(args)) = (&data.tool_call_id, &data.arguments) {
                    if let Some(name) = args.get("name").and_then(|v| v.as_str()) {
                        tool_call_names.insert(call_id.clone(), name.to_string());
                    }
                }
            }
        }
    }

    // Phase 2: process subagent lifecycle events, joining via toolCallId
    let mut agents: HashMap<String, TrackedSubagent> = HashMap::new();

    for event in events {
        let timestamp = event.raw.timestamp.map(|t| t.to_rfc3339());

        match &event.typed_data {
            TypedEventData::SubagentStarted(data) => {
                // Resolve custom name: try toolCallId lookup first, fall back to agent_name
                let custom_name = data
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| tool_call_names.get(id).cloned())
                    .or_else(|| data.agent_name.clone());

                if let Some(ref name) = custom_name {
                    if let Some(task_id) = extract_task_id(name) {
                        agents.insert(
                            task_id.to_string(),
                            TrackedSubagent {
                                task_id: task_id.to_string(),
                                agent_name: name.clone(),
                                status: SubagentStatus::Running,
                                started_at: timestamp,
                                completed_at: None,
                                error: None,
                            },
                        );
                    }
                }
            }
            TypedEventData::SubagentCompleted(data) => {
                let custom_name = data
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| tool_call_names.get(id).cloned())
                    .or_else(|| data.agent_name.clone());

                if let Some(ref name) = custom_name {
                    if let Some(task_id) = extract_task_id(name) {
                        if let Some(agent) = agents.get_mut(task_id) {
                            agent.status = SubagentStatus::Completed;
                            agent.completed_at = timestamp;
                        } else {
                            agents.insert(
                                task_id.to_string(),
                                TrackedSubagent {
                                    task_id: task_id.to_string(),
                                    agent_name: name.clone(),
                                    status: SubagentStatus::Completed,
                                    started_at: None,
                                    completed_at: timestamp,
                                    error: None,
                                },
                            );
                        }
                    }
                }
            }
            TypedEventData::SubagentFailed(data) => {
                let custom_name = data
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| tool_call_names.get(id).cloned())
                    .or_else(|| data.agent_name.clone());

                if let Some(ref name) = custom_name {
                    if let Some(task_id) = extract_task_id(name) {
                        if let Some(agent) = agents.get_mut(task_id) {
                            agent.status = SubagentStatus::Failed;
                            agent.completed_at = timestamp;
                            agent.error = data.error.clone();
                        } else {
                            agents.insert(
                                task_id.to_string(),
                                TrackedSubagent {
                                    task_id: task_id.to_string(),
                                    agent_name: name.clone(),
                                    status: SubagentStatus::Failed,
                                    started_at: None,
                                    completed_at: timestamp,
                                    error: data.error.clone(),
                                },
                            );
                        }
                    }
                }
            }
            _ => {}
        }
    }

    AttributionSnapshot {
        events_scanned: events.len(),
        subagents: agents.into_values().collect(),
    }
}

/// Parse the orchestrator's events.jsonl and build attribution.
///
/// `session_path` is the orchestrator's session directory (under
/// `~/.copilot/session-state/{uuid}/`).
pub fn build_attribution_from_session(
    session_path: &Path,
) -> crate::error::Result<AttributionSnapshot> {
    let events_path = session_path.join("events.jsonl");
    if !events_path.exists() {
        return Ok(AttributionSnapshot::default());
    }
    let parsed = tracepilot_core::parsing::events::parse_typed_events(&events_path)?;
    Ok(build_attribution(&parsed.events))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_task_id_from_name() {
        assert_eq!(extract_task_id("tp-task-001"), Some("task-001"));
        assert_eq!(extract_task_id("tp-abc-123-def"), Some("abc-123-def"));
        assert_eq!(extract_task_id("other-agent"), None);
        assert_eq!(extract_task_id("tp-"), Some(""));
    }

    #[test]
    fn build_attribution_via_tool_call_id_join() {
        use tracepilot_core::models::event_types::agent_data::*;
        use tracepilot_core::models::event_types::event_type_enum::SessionEventType;
        use tracepilot_core::models::event_types::tool_execution_data::ToolExecStartData;
        use tracepilot_core::parsing::events::{RawEvent, TypedEvent, TypedEventData};

        let events = vec![
            // 1. task tool invocation → name = "tp-task-001"
            TypedEvent {
                raw: RawEvent {
                    event_type: "tool.execution_start".to_string(),
                    data: serde_json::Value::Null,
                    id: None,
                    timestamp: None,
                    parent_id: None,
                },
                event_type: SessionEventType::ToolExecutionStart,
                typed_data: TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("call-A".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(serde_json::json!({
                        "name": "tp-task-001",
                        "agent_type": "general-purpose",
                        "prompt": "do stuff"
                    })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
            },
            // 2. subagent.started with agentName="general-purpose" (not the custom name!)
            TypedEvent {
                raw: RawEvent {
                    event_type: "subagent.started".to_string(),
                    data: serde_json::Value::Null,
                    id: None,
                    timestamp: None,
                    parent_id: None,
                },
                event_type: SessionEventType::SubagentStarted,
                typed_data: TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("call-A".to_string()),
                    agent_name: Some("general-purpose".to_string()),
                    agent_display_name: None,
                    agent_description: None,
                }),
            },
            // 3. subagent.completed
            TypedEvent {
                raw: RawEvent {
                    event_type: "subagent.completed".to_string(),
                    data: serde_json::Value::Null,
                    id: None,
                    timestamp: None,
                    parent_id: None,
                },
                event_type: SessionEventType::SubagentCompleted,
                typed_data: TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("call-A".to_string()),
                    agent_name: Some("general-purpose".to_string()),
                    agent_display_name: None,
                    duration_ms: None,
                    model: None,
                    total_tokens: None,
                    total_tool_calls: None,
                }),
            },
            // 4. Another task, still in progress
            TypedEvent {
                raw: RawEvent {
                    event_type: "tool.execution_start".to_string(),
                    data: serde_json::Value::Null,
                    id: None,
                    timestamp: None,
                    parent_id: None,
                },
                event_type: SessionEventType::ToolExecutionStart,
                typed_data: TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("call-B".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(serde_json::json!({ "name": "tp-task-002" })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
            },
            TypedEvent {
                raw: RawEvent {
                    event_type: "subagent.started".to_string(),
                    data: serde_json::Value::Null,
                    id: None,
                    timestamp: None,
                    parent_id: None,
                },
                event_type: SessionEventType::SubagentStarted,
                typed_data: TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("call-B".to_string()),
                    agent_name: Some("general-purpose".to_string()),
                    agent_display_name: None,
                    agent_description: None,
                }),
            },
            // 5. Non-task subagent (explore agent) — should be ignored
            TypedEvent {
                raw: RawEvent {
                    event_type: "tool.execution_start".to_string(),
                    data: serde_json::Value::Null,
                    id: None,
                    timestamp: None,
                    parent_id: None,
                },
                event_type: SessionEventType::ToolExecutionStart,
                typed_data: TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("call-C".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(serde_json::json!({ "name": "some-explore" })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
            },
            TypedEvent {
                raw: RawEvent {
                    event_type: "subagent.started".to_string(),
                    data: serde_json::Value::Null,
                    id: None,
                    timestamp: None,
                    parent_id: None,
                },
                event_type: SessionEventType::SubagentStarted,
                typed_data: TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("call-C".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: None,
                    agent_description: None,
                }),
            },
        ];

        let snapshot = build_attribution(&events);
        assert_eq!(snapshot.events_scanned, 7);
        assert_eq!(snapshot.subagents.len(), 2);

        let t1 = snapshot
            .subagents
            .iter()
            .find(|s| s.task_id == "task-001")
            .expect("task-001 should be tracked");
        assert_eq!(t1.status, SubagentStatus::Completed);
        assert_eq!(t1.agent_name, "tp-task-001");

        let t2 = snapshot
            .subagents
            .iter()
            .find(|s| s.task_id == "task-002")
            .expect("task-002 should be tracked");
        assert_eq!(t2.status, SubagentStatus::Running);
        assert_eq!(t2.agent_name, "tp-task-002");
    }

    #[test]
    fn build_attribution_fallback_to_agent_name() {
        // When there's no tool.execution_start event, fall back to agent_name directly
        use tracepilot_core::models::event_types::agent_data::*;
        use tracepilot_core::models::event_types::event_type_enum::SessionEventType;
        use tracepilot_core::parsing::events::{RawEvent, TypedEvent, TypedEventData};

        let events = vec![TypedEvent {
            raw: RawEvent {
                event_type: "subagent.started".to_string(),
                data: serde_json::Value::Null,
                id: None,
                timestamp: None,
                parent_id: None,
            },
            event_type: SessionEventType::SubagentStarted,
            typed_data: TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: None,
                agent_name: Some("tp-direct-001".to_string()),
                agent_display_name: None,
                agent_description: None,
            }),
        }];

        let snapshot = build_attribution(&events);
        assert_eq!(snapshot.subagents.len(), 1);
        assert_eq!(snapshot.subagents[0].task_id, "direct-001");
        assert_eq!(snapshot.subagents[0].status, SubagentStatus::Running);
    }
}
