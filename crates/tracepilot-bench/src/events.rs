use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};
pub(crate) use tracepilot_core::parsing::events::events_to_jsonl;

/// Tool names rotated through when generating tool call events.
const TOOL_NAMES: &[&str] = &[
    "read_file",
    "edit_file",
    "grep",
    "glob",
    "powershell",
    "view",
    "create",
    "web_search",
    "task",
    "write_powershell",
];

/// Models rotated through for session metadata.
const MODELS: &[&str] = &[
    "claude-sonnet-4-20250514",
    "claude-haiku-4-20250514",
    "gpt-4.1",
];

fn base_time() -> DateTime<Utc> {
    "2025-01-01T00:00:00Z".parse().unwrap()
}

fn make_timestamp(base: DateTime<Utc>, offset_secs: i64) -> String {
    (base + Duration::seconds(offset_secs)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Generate a sequence of realistic session events.
///
/// Produces a deterministic stream following real Copilot CLI event patterns:
/// `session.start` → N×(user.message, turn_start, assistant.message, tools…, turn_end) → `session.shutdown`.
pub(crate) fn build_session_events(turn_count: usize, tool_call_count: usize) -> Vec<Value> {
    let base = base_time();
    let mut events = Vec::new();
    let mut ts_offset: i64 = 0;
    let mut event_id: usize = 0;

    let mut next = |ts: &mut i64| -> (String, String) {
        event_id += 1;
        *ts += 1;
        (format!("e{event_id}"), make_timestamp(base, *ts))
    };

    // session.start
    let (id, ts) = next(&mut ts_offset);
    events.push(json!({
        "type": "session.start",
        "data": {
            "sessionId": "bench-session-0001",
            "version": "1.0",
            "producer": "copilot-cli",
            "context": {
                "cwd": "/bench/project",
                "branch": "main",
                "repository": "github.com/bench/project",
                "hostType": "cli"
            }
        },
        "id": id,
        "timestamp": ts
    }));

    // Distribute tool calls across turns
    let tools_per_turn = if turn_count > 0 {
        tool_call_count / turn_count
    } else {
        0
    };
    let extra_tools = if turn_count > 0 {
        tool_call_count % turn_count
    } else {
        0
    };

    for turn_idx in 0..turn_count {
        let turn_id = format!("turn-{turn_idx}");
        let interaction_id = format!("interaction-{turn_idx}");

        // user.message
        let (id, ts) = next(&mut ts_offset);
        events.push(json!({
            "type": "user.message",
            "data": {
                "content": format!("Refactor module {turn_idx} to improve error handling and add tests"),
                "interactionId": interaction_id
            },
            "id": id,
            "timestamp": ts
        }));

        // assistant.turn_start
        let (id, ts) = next(&mut ts_offset);
        events.push(json!({
            "type": "assistant.turn_start",
            "data": {
                "turnId": turn_id,
                "interactionId": interaction_id
            },
            "id": id,
            "timestamp": ts
        }));

        // assistant.message
        let (id, ts) = next(&mut ts_offset);
        events.push(json!({
            "type": "assistant.message",
            "data": {
                "content": format!(
                    "I'll help you refactor module {turn_idx}. Let me read the relevant files first."
                ),
                "messageId": format!("msg-{turn_idx}"),
                "interactionId": interaction_id,
                "turnId": turn_id
            },
            "id": id,
            "timestamp": ts
        }));

        // Tool calls for this turn
        let num_tools = tools_per_turn + if turn_idx < extra_tools { 1 } else { 0 };
        for tc_idx in 0..num_tools {
            let tool_name = TOOL_NAMES[(turn_idx + tc_idx) % TOOL_NAMES.len()];
            let tool_call_id = format!("tc-{turn_idx}-{tc_idx}");

            // tool.execution_start
            let (id, ts) = next(&mut ts_offset);
            events.push(json!({
                "type": "tool.execution_start",
                "data": {
                    "toolName": tool_name,
                    "toolCallId": tool_call_id,
                    "turnId": turn_id,
                    "arguments": {
                        "path": format!("src/module_{turn_idx}/file_{tc_idx}.rs")
                    }
                },
                "id": id,
                "timestamp": ts
            }));

            // tool.execution_complete
            let (id, ts) = next(&mut ts_offset);
            events.push(json!({
                "type": "tool.execution_complete",
                "data": {
                    "toolCallId": tool_call_id,
                    "result": format!("Tool {tool_name} completed successfully for {tool_call_id}"),
                    "success": true,
                    "turnId": turn_id,
                    "interactionId": interaction_id
                },
                "id": id,
                "timestamp": ts
            }));
        }

        // assistant.turn_end
        let (id, ts) = next(&mut ts_offset);
        events.push(json!({
            "type": "assistant.turn_end",
            "data": {
                "turnId": turn_id,
                "interactionId": interaction_id
            },
            "id": id,
            "timestamp": ts
        }));
    }

    // session.shutdown with model metrics
    let total_input = (turn_count.max(1) * 600) as u64;
    let total_output = (turn_count.max(1) * 400) as u64;
    let model_name = MODELS[0].to_string();
    let mut model_metrics_map = serde_json::Map::new();
    model_metrics_map.insert(
        model_name.clone(),
        json!({
            "requests": {
                "count": turn_count,
                "cost": turn_count as f64 * 0.15
            },
            "usage": {
                "inputTokens": total_input,
                "outputTokens": total_output,
                "cacheReadTokens": total_input / 2,
                "cacheWriteTokens": 0u64
            }
        }),
    );

    let files_modified: Vec<String> = (0..turn_count.min(5))
        .map(|i| format!("src/file_{i}.rs"))
        .collect();

    let (id, ts) = next(&mut ts_offset);
    events.push(json!({
        "type": "session.shutdown",
        "data": {
            "shutdownType": "routine",
            "totalPremiumRequests": turn_count as f64,
            "totalApiDurationMs": ts_offset as u64 * 1000,
            "sessionStartTime": base.timestamp_millis(),
            "currentModel": model_name,
            "codeChanges": {
                "linesAdded": turn_count * 10,
                "linesRemoved": turn_count * 3,
                "filesModified": files_modified
            },
            "modelMetrics": Value::Object(model_metrics_map)
        },
        "id": id,
        "timestamp": ts
    }));

    events
}
