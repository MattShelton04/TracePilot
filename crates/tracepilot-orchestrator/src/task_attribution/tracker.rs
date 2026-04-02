//! Attribution tracker — parses subagent events to link tasks.
//!
//! Convention: orchestrator names subagents `tp-{task_id}`. We parse
//! `events.jsonl` for `subagent.started`, `subagent.completed`, and
//! `subagent.failed` events to build a task→subagent mapping.

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
/// This is the core function — it processes already-parsed `TypedEvent`s
/// and returns a mapping of task_id → subagent status.
pub fn build_attribution(events: &[TypedEvent]) -> AttributionSnapshot {
    let mut agents: HashMap<String, TrackedSubagent> = HashMap::new();

    for event in events {
        let timestamp = event.raw.timestamp.map(|t| t.to_rfc3339());

        match &event.typed_data {
            TypedEventData::SubagentStarted(data) => {
                if let Some(name) = &data.agent_name {
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
                if let Some(name) = &data.agent_name {
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
                if let Some(name) = &data.agent_name {
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
    fn build_attribution_tracks_lifecycle() {
        use tracepilot_core::parsing::events::{RawEvent, TypedEvent, TypedEventData};
        use tracepilot_core::models::event_types::agent_data::*;
        use tracepilot_core::models::event_types::event_type_enum::SessionEventType;

        let events = vec![
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
                    tool_call_id: None,
                    agent_name: Some("tp-task-001".to_string()),
                    agent_display_name: None,
                    agent_description: None,
                }),
            },
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
                    tool_call_id: None,
                    agent_name: Some("tp-task-001".to_string()),
                    agent_display_name: None,
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
                    tool_call_id: None,
                    agent_name: Some("tp-task-002".to_string()),
                    agent_display_name: None,
                    agent_description: None,
                }),
            },
            TypedEvent {
                raw: RawEvent {
                    event_type: "subagent.failed".to_string(),
                    data: serde_json::Value::Null,
                    id: None,
                    timestamp: None,
                    parent_id: None,
                },
                event_type: SessionEventType::SubagentFailed,
                typed_data: TypedEventData::SubagentFailed(SubagentFailedData {
                    tool_call_id: None,
                    agent_name: Some("tp-task-002".to_string()),
                    agent_display_name: None,
                    error: Some("timeout".to_string()),
                }),
            },
            // Non-task agent — should be ignored
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
                    tool_call_id: None,
                    agent_name: Some("some-other-agent".to_string()),
                    agent_display_name: None,
                    agent_description: None,
                }),
            },
        ];

        let snapshot = build_attribution(&events);
        assert_eq!(snapshot.events_scanned, 5);
        assert_eq!(snapshot.subagents.len(), 2);

        let t1 = snapshot.subagents.iter().find(|s| s.task_id == "task-001").unwrap();
        assert_eq!(t1.status, SubagentStatus::Completed);

        let t2 = snapshot.subagents.iter().find(|s| s.task_id == "task-002").unwrap();
        assert_eq!(t2.status, SubagentStatus::Failed);
        assert_eq!(t2.error.as_deref(), Some("timeout"));
    }
}
