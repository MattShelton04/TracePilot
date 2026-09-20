use chrono::{Duration as ChronoDuration, TimeZone, Utc};
use serde_json::{Value, json};
use std::fs::OpenOptions;
use std::io::{BufWriter, Write};
use std::path::Path;

use super::model::{AnyError, STRESS_LABEL};
use super::plan::SessionSpec;
use super::validate::fail;

#[derive(Debug)]
pub(super) struct EventWriteStats {
    pub(super) stress_bytes: usize,
    pub(super) source_bytes: u64,
}

pub(super) fn write_events(
    path: &Path,
    spec: &SessionSpec,
    session_index: usize,
) -> Result<EventWriteStats, AnyError> {
    let file = OpenOptions::new().create_new(true).write(true).open(path)?;
    let mut writer = BufWriter::new(file);
    let base = Utc
        .with_ymd_and_hms(2026, 1, 1, 8, 0, 0)
        .single()
        .ok_or_else(|| std::io::Error::other("invalid fixed fixture timestamp"))?
        + ChronoDuration::days((session_index % 28) as i64);
    let mut sequence = 0usize;
    let mut event_index = 0usize;
    let mut write_event = |event_type: &str, data: Value| -> Result<(), AnyError> {
        sequence += 1;
        event_index += 1;
        let timestamp = (base + ChronoDuration::seconds(sequence as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        serde_json::to_writer(
            &mut writer,
            &json!({
                "type": event_type,
                "data": data,
                "id": format!("{}-e{event_index:06}", spec.id),
                "timestamp": timestamp
            }),
        )?;
        writer.write_all(b"\n")?;
        Ok(())
    };

    write_event(
        "session.start",
        json!({
            "sessionId": spec.id,
            "version": "1.0.83",
            "producer": "copilot-cli",
            "copilotVersion": "1.0.83",
            "selectedModel": "claude-sonnet-4.5",
            "context": {
                "cwd": "C:/synthetic/tracepilot-workload",
                "gitRoot": "C:/synthetic/tracepilot-workload",
                "repository": "github.com/example/tracepilot-synthetic",
                "branch": "perf-fixture",
                "hostType": "cli"
            }
        }),
    )?;

    let base_tools = spec.tool_call_count / spec.turn_count;
    let extra_tools = spec.tool_call_count % spec.turn_count;
    let mut tool_ordinal = 0usize;
    let stress_ordinal = spec.stress_output.then_some(spec.tool_call_count / 2);
    let mut stress_bytes = 0usize;

    for turn_index in 0..spec.turn_count {
        let turn_id = format!("{}-turn-{turn_index:05}", spec.id);
        let interaction_id = format!("{}-interaction-{turn_index:05}", spec.id);
        write_event(
            "user.message",
            json!({
                "content": user_message(turn_index),
                "interactionId": interaction_id,
                "messageId": format!("user-{turn_index:05}"),
                "turnId": turn_id
            }),
        )?;
        write_event(
            "assistant.turn_start",
            json!({
                "turnId": turn_id,
                "interactionId": interaction_id,
                "model": "claude-sonnet-4.5"
            }),
        )?;
        write_event(
            "assistant.message",
            json!({
                "content": assistant_message(turn_index),
                "messageId": format!("assistant-{turn_index:05}"),
                "interactionId": interaction_id,
                "turnId": turn_id,
                "model": "claude-sonnet-4.5"
            }),
        )?;

        let tools_this_turn = base_tools + usize::from(turn_index < extra_tools);
        for local_tool in 0..tools_this_turn {
            let tool_name = tool_name(tool_ordinal);
            let call_id = format!("{}-tool-{tool_ordinal:06}", spec.id);
            write_event(
                "tool.execution_start",
                json!({
                    "toolName": tool_name,
                    "toolCallId": call_id,
                    "turnId": turn_id,
                    "arguments": tool_arguments(tool_name, turn_index, local_tool)
                }),
            )?;
            let result = if spec.tool_output_bytes > 0 {
                let planned =
                    weighted_output_len(spec.tool_output_bytes, spec.tool_call_count, tool_ordinal);
                let is_stress = stress_ordinal == Some(tool_ordinal);
                let target = if is_stress {
                    planned.max(1024 * 1024 + STRESS_LABEL.len() + 1)
                } else {
                    planned
                };
                sized_tool_result(
                    tool_name,
                    session_index,
                    turn_index,
                    local_tool,
                    tool_ordinal,
                    target,
                    is_stress,
                )
            } else if stress_ordinal == Some(tool_ordinal) {
                format!("{STRESS_LABEL}\n{}", "x".repeat(1024 * 1024))
            } else {
                tool_result(tool_name, turn_index, local_tool)
            };
            if stress_ordinal == Some(tool_ordinal) {
                stress_bytes = result.len();
            }
            write_event(
                "tool.execution_complete",
                json!({
                    "toolCallId": call_id,
                    "result": result,
                    "success": true,
                    "turnId": turn_id,
                    "interactionId": interaction_id,
                    "toolTelemetry": {"durationMs": 5 + (tool_ordinal % 97)}
                }),
            )?;
            tool_ordinal += 1;
        }
        write_event(
            "assistant.turn_end",
            json!({"turnId": turn_id, "model": "claude-sonnet-4.5"}),
        )?;
    }

    write_event(
        "session.shutdown",
        json!({
            "shutdownType": "routine",
            "totalPremiumRequests": spec.turn_count as f64,
            "totalApiDurationMs": spec.turn_count as u64 * 850,
            "sessionStartTime": base.timestamp_millis() as u64,
            "currentModel": "claude-sonnet-4.5",
            "currentTokens": spec.turn_count as u64 * 900,
            "codeChanges": {
                "linesAdded": spec.turn_count * 7,
                "linesRemoved": spec.turn_count * 2,
                "filesModified": ["src/service.rs", "src/index.rs", "tests/service.rs"]
            },
            "modelMetrics": {
                "claude-sonnet-4.5": {
                    "requests": {"count": spec.turn_count, "cost": spec.turn_count as f64 * 0.02},
                    "usage": {
                        "inputTokens": spec.turn_count * 600,
                        "outputTokens": spec.turn_count * 300,
                        "cacheReadTokens": spec.turn_count * 250,
                        "cacheWriteTokens": spec.turn_count * 25
                    }
                }
            }
        }),
    )?;
    writer.flush()?;

    if event_index != spec.event_count || tool_ordinal != spec.tool_call_count {
        return fail(format!(
            "generator count mismatch for {}: events {event_index}/{}, tools {tool_ordinal}/{}",
            spec.id, spec.event_count, spec.tool_call_count
        ));
    }
    Ok(EventWriteStats {
        stress_bytes,
        source_bytes: std::fs::metadata(path)?.len(),
    })
}

fn weighted_output_len(total_bytes: u64, tool_count: usize, ordinal: usize) -> usize {
    const WEIGHTS: &[u64] = &[1, 2, 1, 5, 13, 3, 8, 2, 21, 5, 1, 8, 3, 13, 2, 5];
    let cycles = tool_count / WEIGHTS.len();
    let remainder = tool_count % WEIGHTS.len();
    let total_weight =
        cycles as u64 * WEIGHTS.iter().sum::<u64>() + WEIGHTS[..remainder].iter().sum::<u64>();
    let bytes = total_bytes.saturating_mul(WEIGHTS[ordinal % WEIGHTS.len()]) / total_weight;
    usize::try_from(bytes).unwrap_or(usize::MAX).max(256)
}

fn sized_tool_result(
    tool: &str,
    session: usize,
    turn: usize,
    local: usize,
    ordinal: usize,
    target_bytes: usize,
    stress: bool,
) -> String {
    let mut output = String::with_capacity(target_bytes);
    if stress {
        output.push_str(STRESS_LABEL);
        output.push('\n');
    }
    output.push_str(&tool_result(tool, turn, local));
    output.push('\n');
    let mut line = 0usize;
    while output.len() < target_bytes {
        output.push_str(&source_like_line(tool, session, turn, ordinal, line));
        line += 1;
    }
    output.truncate(target_bytes);
    output
}

fn source_like_line(
    tool: &str,
    session: usize,
    turn: usize,
    ordinal: usize,
    line: usize,
) -> String {
    let key = session
        .wrapping_mul(65_537)
        .wrapping_add(turn * 257)
        .wrapping_add(ordinal * 17)
        .wrapping_add(line);
    match tool {
        "view" => format!(
            "pub(crate) fn case_{key:08x}(input: usize) -> Result<usize, ServiceError> {{ Ok(input.saturating_add({})) }}\n",
            key % 97
        ),
        "grep" => format!(
            "src/domain_{:03}/module_{:04}.rs:{}: match request.kind() {{ Some(kind) => dispatch(kind) }}\n",
            session % 211,
            turn % 4096,
            20 + key % 700
        ),
        "powershell" => format!(
            "test service::case_{key:08x} ... ok; finished target {} in {}.{:03}s\n",
            ordinal % 37,
            key % 19,
            key % 1000
        ),
        "edit" => format!(
            "@@ -{0},3 +{0},5 @@ fn update_{key:08x}() {{ context.record({1}); validate_path({2}); }}\n",
            10 + key % 900,
            key % 131,
            turn % 997
        ),
        "glob" => format!(
            "crates/service_{:03}/src/feature_{:04}/case_{key:08x}.rs\n",
            session % 127,
            turn % 2048
        ),
        _ => format!(
            "{{\"case\":\"{key:08x}\",\"session\":{session},\"turn\":{turn},\"status\":\"verified\",\"files\":{}}}\n",
            1 + key % 23
        ),
    }
}

fn user_message(turn: usize) -> String {
    match turn % 4 {
        0 => format!("Please refactor service module {turn} and keep its public behavior stable."),
        1 => format!(
            "Please refactor the request pipeline for case {turn}. Check error propagation, cancellation, and deterministic ordering before updating the implementation."
        ),
        2 => format!(
            "Please refactor this Rust example and explain the result:\n```rust\nfn case_{turn}(value: usize) -> usize {{\n    value.saturating_add(1)\n}}\n```"
        ),
        _ => format!(
            "Please refactor workload {turn}. The acceptance notes require stable IDs, explicit failures, bounded output, and a regression check with representative tool activity."
        ),
    }
}

fn assistant_message(turn: usize) -> String {
    match turn % 3 {
        0 => format!("I’ll inspect the module and trace the call sites for workload {turn}."),
        1 => format!(
            "I found the relevant boundary for workload {turn}; I’ll update it and verify the result."
        ),
        _ => format!("The implementation for workload {turn} is ready for focused validation."),
    }
}

fn tool_name(ordinal: usize) -> &'static str {
    const TOOLS: &[&str] = &["view", "grep", "powershell", "edit", "glob", "create"];
    TOOLS[ordinal % TOOLS.len()]
}

fn tool_arguments(tool: &str, turn: usize, local: usize) -> Value {
    match tool {
        "grep" => json!({"pattern": "Result<", "path": format!("src/module_{turn}")}),
        "powershell" => json!({"command": format!("cargo test focused_case_{turn}_{local}")}),
        "glob" => json!({"pattern": format!("src/module_{turn}/**/*.rs")}),
        _ => json!({"path": format!("src/module_{turn}/file_{local}.rs")}),
    }
}

fn tool_result(tool: &str, turn: usize, local: usize) -> String {
    match tool {
        "grep" => format!("src/module_{turn}/file_{local}.rs:42: Result<(), ServiceError>"),
        "powershell" => {
            format!("running 1 test\ntest focused_case_{turn}_{local} ... ok\ntest result: ok")
        }
        "view" => {
            format!("pub fn workload_{turn}_{local}() -> Result<(), ServiceError> {{ Ok(()) }}")
        }
        "edit" | "create" => {
            format!("Updated src/module_{turn}/file_{local}.rs successfully")
        }
        _ => format!("src/module_{turn}/file_{local}.rs"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn representative_session_is_deterministic_and_parseable() {
        let spec = SessionSpec {
            id: "7ace1000-0000-4000-8000-00000000f00d".to_string(),
            title: "Representative deterministic session".to_string(),
            profile: "test",
            event_count: 18,
            turn_count: 2,
            tool_call_count: 4,
            stress_output: false,
            tool_output_bytes: 16 * 1024,
        };
        let first_guard = tempfile::tempdir().unwrap();
        let first = first_guard.path().join("first.jsonl");
        let second_guard = tempfile::tempdir().unwrap();
        let second = second_guard.path().join("second.jsonl");

        let first_stats = write_events(&first, &spec, 7).unwrap();
        let second_stats = write_events(&second, &spec, 7).unwrap();
        assert_eq!(
            std::fs::read(&first).unwrap(),
            std::fs::read(&second).unwrap()
        );
        assert_eq!(first_stats.source_bytes, second_stats.source_bytes);
        assert!(first_stats.source_bytes > spec.tool_output_bytes);

        let parsed = tracepilot_core::parsing::events::parse_typed_events(&first).unwrap();
        assert_eq!(parsed.events.len(), spec.event_count);
        assert!(!parsed.diagnostics.has_warnings());
        assert_eq!(
            tracepilot_core::turns::reconstruct_turns(&parsed.events).len(),
            spec.turn_count
        );
    }
}
