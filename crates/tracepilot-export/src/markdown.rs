//! Markdown export for sessions.

use std::fmt::Write;

use chrono::{DateTime, Utc};

/// Render a session as a Markdown document.
pub fn render_markdown(
    summary: &tracepilot_core::models::SessionSummary,
    turns: &[tracepilot_core::models::ConversationTurn],
) -> String {
    let mut md = String::new();

    let title = summary
        .summary
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&summary.id);
    let _ = writeln!(md, "# Session: {}", title);
    md.push('\n');

    let _ = writeln!(md, "- ID: `{}`", summary.id);
    if let Some(repo) = summary.repository.as_deref() {
        match (summary.branch.as_deref(), summary.cwd.as_deref()) {
            (Some(branch), Some(cwd)) => {
                let _ = writeln!(md, "- Repository: {} (branch {}) — {}", repo, branch, cwd);
            }
            (Some(branch), None) => {
                let _ = writeln!(md, "- Repository: {} (branch {})", repo, branch);
            }
            (None, Some(cwd)) => {
                let _ = writeln!(md, "- Repository: {} — {}", repo, cwd);
            }
            _ => {
                let _ = writeln!(md, "- Repository: {}", repo);
            }
        }
    } else if let Some(cwd) = summary.cwd.as_deref() {
        let _ = writeln!(md, "- Path: {}", cwd);
    }
    if let Some(host) = summary.host_type.as_deref() {
        let _ = writeln!(md, "- Host: {}", host);
    }
    if let Some(created) = summary.created_at.as_ref() {
        let _ = writeln!(md, "- Created: {}", format_dt(created));
    }
    if let Some(updated) = summary.updated_at.as_ref() {
        let _ = writeln!(md, "- Updated: {}", format_dt(updated));
    }
    if let Some(event_count) = summary.event_count {
        let _ = writeln!(md, "- Events: {}", event_count);
    }
    if let Some(turn_count) = summary.turn_count {
        let _ = writeln!(md, "- Turns: {}", turn_count);
    }
    if summary.has_checkpoints {
        let checkpoints = summary
            .checkpoint_count
            .map(|c| c.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let _ = writeln!(md, "- Checkpoints: {}", checkpoints);
    }
    if summary.has_plan {
        md.push_str("- Plan: present\n");
    }
    if summary.has_session_db {
        md.push_str("- Session DB: available\n");
    }
    if let Some(metrics) = summary.shutdown_metrics.as_ref() {
        md.push_str("- Shutdown metrics:\n");
        if let Some(kind) = metrics.shutdown_type.as_deref() {
            let _ = writeln!(md, "  - Type: {}", kind);
        }
        if let Some(reqs) = metrics.total_premium_requests {
            let _ = writeln!(md, "  - Premium requests: {}", reqs);
        }
        if let Some(api_ms) = metrics.total_api_duration_ms {
            let _ = writeln!(md, "  - API duration: {} ms", api_ms);
        }
        if let Some(model) = metrics.current_model.as_deref() {
            let _ = writeln!(md, "  - Current model: {}", model);
        }
        if let Some(start) = metrics.session_start_time {
            let _ = writeln!(md, "  - Session start (unix ms): {}", start);
        }
        if let Some(shutdowns) = metrics.shutdown_count {
            let _ = writeln!(md, "  - Shutdown events combined: {}", shutdowns);
        }
        if !metrics.model_metrics.is_empty() {
            md.push_str("  - Model metrics:\n");
            let mut sorted_models: Vec<_> = metrics.model_metrics.iter().collect();
            sorted_models.sort_by_key(|(k, _)| k.as_str());
            for (model, detail) in sorted_models {
                let request_count = detail.requests.as_ref().and_then(|r| r.count).unwrap_or(0);
                let input_tokens = detail
                    .usage
                    .as_ref()
                    .and_then(|u| u.input_tokens)
                    .unwrap_or(0);
                let output_tokens = detail
                    .usage
                    .as_ref()
                    .and_then(|u| u.output_tokens)
                    .unwrap_or(0);
                let _ = writeln!(
                    md,
                    "    - {}: requests={}, tokens_in={}, tokens_out={}",
                    model, request_count, input_tokens, output_tokens
                );
            }
        }
    }

    md.push('\n');
    md.push_str("## Conversation\n\n");
    if turns.is_empty() {
        md.push_str("_No conversation turns recorded._\n");
        return md;
    }

    for turn in turns {
        write_turn(&mut md, turn);
    }

    md
}

fn format_dt(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn write_turn(out: &mut String, turn: &tracepilot_core::models::ConversationTurn) {
    let _ = writeln!(out, "### Turn {}", turn.turn_index + 1);
    if let Some(model) = turn.model.as_deref() {
        let _ = writeln!(out, "- Model: {}", model);
    }
    if let Some(ts) = turn.timestamp.as_ref() {
        let _ = writeln!(out, "- Started: {}", format_dt(ts));
    }
    if let Some(end) = turn.end_timestamp.as_ref() {
        let _ = writeln!(out, "- Ended: {}", format_dt(end));
    }
    if let Some(duration_ms) = turn.duration_ms {
        let _ = writeln!(out, "- Duration: {} ms", duration_ms);
    }
    if let Some(tokens) = turn.output_tokens {
        let _ = writeln!(out, "- Output tokens: {}", tokens);
    }
    if let Some(interaction) = turn.interaction_id.as_deref() {
        let _ = writeln!(out, "- Interaction ID: {}", interaction);
    }
    if let Some(event_index) = turn.event_index {
        let _ = writeln!(out, "- Event index: {}", event_index);
    }
    out.push('\n');

    match turn.user_message.as_deref() {
        Some(msg) if !msg.is_empty() => write_block(out, "User", msg),
        _ => out.push_str("_No user message for this turn._\n\n"),
    }

    if !turn.assistant_messages.is_empty() {
        for msg in &turn.assistant_messages {
            let label = msg.agent_display_name.as_deref().unwrap_or("Assistant");
            write_block(out, label, msg.content.as_str());
        }
    }

    if !turn.reasoning_texts.is_empty() {
        for msg in &turn.reasoning_texts {
            let label = msg.agent_display_name.as_deref().unwrap_or("Reasoning");
            write_block(out, label, msg.content.as_str());
        }
    }

    if !turn.tool_calls.is_empty() {
        out.push_str("**Tool Calls**\n");
        for tool in &turn.tool_calls {
            let status = match tool.success {
                Some(true) => "[ok]",
                Some(false) => "[error]",
                None if tool.is_complete => "[done]",
                _ => "[pending]",
            };
            let mut line = format!("- {} {}", status, tool.tool_name.as_str());
            if let Some(name) = tool.mcp_server_name.as_deref() {
                line.push_str(&format!(" ({})", name));
            }
            if let Some(duration_ms) = tool.duration_ms {
                line.push_str(&format!(" — {} ms", duration_ms));
            }
            if let Some(model) = tool.model.as_deref() {
                line.push_str(&format!(" — model {}", model));
            }
            if tool.is_subagent {
                line.push_str(" — subagent");
            }
            if let Some(summary) = tool.intention_summary.as_deref() {
                line.push_str(&format!(" — {}", summary));
            }
            if let Some(id) = tool.tool_call_id.as_deref() {
                line.push_str(&format!(" [id: {}]", id));
            }
            let _ = writeln!(out, "{}", line);
            if let Some(args) = tool.args_summary.as_deref() {
                let _ = writeln!(out, "  - Args: {}", args);
            } else if let Some(args) = tool.arguments.as_ref()
                && let Ok(pretty) = serde_json::to_string_pretty(args) {
                    out.push_str("  - Args:\n");
                    write_indented_code_block(out, "json", &pretty, 4);
                }
            if let Some(err) = tool.error.as_deref() {
                let _ = writeln!(out, "  - Error: {}", err);
            }
            if let Some(mcp_name) = tool.mcp_tool_name.as_deref() {
                let _ = writeln!(out, "  - MCP tool: {}", mcp_name);
            }
            if let Some(result) = tool.result_content.as_deref() {
                out.push_str("  - Result:\n");
                write_indented_block(out, result, 4, "> ");
            }
        }
        out.push('\n');
    }

    if !turn.session_events.is_empty() {
        out.push_str("**Session Events**\n");
        for event in &turn.session_events {
            let severity = match event.severity {
                tracepilot_core::models::SessionEventSeverity::Error => "[error]",
                tracepilot_core::models::SessionEventSeverity::Warning => "[warning]",
                tracepilot_core::models::SessionEventSeverity::Info => "[info]",
            };
            let mut line = format!("- {} {} — {}", severity, event.event_type, event.summary);
            if let Some(ts) = event.timestamp.as_ref() {
                line.push_str(&format!(" ({})", format_dt(ts)));
            }
            let _ = writeln!(out, "{}", line);
        }
        out.push('\n');
    }
}

fn write_block(out: &mut String, label: &str, text: &str) {
    let _ = writeln!(out, "**{}**", label);
    write_indented_block(out, text, 0, "> ");
    out.push('\n');
}

fn write_indented_block(out: &mut String, text: &str, indent_spaces: usize, prefix: &str) {
    let indent = " ".repeat(indent_spaces);
    for line in text.lines() {
        let _ = writeln!(out, "{}{}{}", indent, prefix, line);
    }
}

fn write_indented_code_block(out: &mut String, lang: &str, text: &str, indent_spaces: usize) {
    let indent = " ".repeat(indent_spaces);
    let _ = writeln!(out, "{}```{}", indent, lang);
    for line in text.lines() {
        let _ = writeln!(out, "{}{}", indent, line);
    }
    let _ = writeln!(out, "{}```", indent);
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;
    use std::collections::HashMap;
    use tracepilot_core::models::conversation::AttributedMessage;

    #[test]
    fn renders_session_with_turn_details() {
        let summary = tracepilot_core::models::SessionSummary {
            id: "sess-123".into(),
            summary: Some("CLI export investigation".into()),
            repository: Some("tracepilot/cli".into()),
            branch: Some("main".into()),
            cwd: Some("/workspace/tracepilot".into()),
            host_type: Some("local".into()),
            created_at: Some(Utc.with_ymd_and_hms(2026, 3, 25, 12, 0, 0).unwrap()),
            updated_at: Some(Utc.with_ymd_and_hms(2026, 3, 25, 12, 15, 0).unwrap()),
            event_count: Some(6),
            has_events: true,
            has_session_db: true,
            has_plan: false,
            has_checkpoints: true,
            checkpoint_count: Some(2),
            turn_count: Some(1),
            shutdown_metrics: Some(sample_metrics()),
        };

        let turns = vec![tracepilot_core::models::ConversationTurn {
            turn_index: 0,
            event_index: Some(4),
            turn_id: Some("turn-1".into()),
            interaction_id: Some("interaction-1".into()),
            user_message: Some("Find TODO stubs in export crate.".into()),
            assistant_messages: vec![AttributedMessage {
                content: "Searching for TODO markers.".into(),
                parent_tool_call_id: None,
                agent_display_name: Some("Explore Agent".into()),
            }],
            model: Some("gpt-4o".into()),
            timestamp: Some(Utc.with_ymd_and_hms(2026, 3, 25, 12, 1, 0).unwrap()),
            end_timestamp: Some(Utc.with_ymd_and_hms(2026, 3, 25, 12, 1, 2).unwrap()),
            tool_calls: vec![
                tracepilot_core::models::TurnToolCall {
                    tool_call_id: Some("tc_1".into()),
                    parent_tool_call_id: None,
                    tool_name: "rg".into(),
                    event_index: Some(5),
                    arguments: Some(json!({"pattern": "TODO", "path": "crates/tracepilot-export"})),
                    success: Some(true),
                    error: None,
                    started_at: None,
                    completed_at: None,
                    duration_ms: Some(120),
                    mcp_server_name: Some("search".into()),
                    mcp_tool_name: None,
                    is_complete: true,
                    is_subagent: false,
                    agent_display_name: None,
                    agent_description: None,
                    model: Some("gpt-4o-mini".into()),
                    intention_summary: Some("Locate TODO markers".into()),
                    total_tokens: None,
                    total_tool_calls: None,
                    result_content: Some("Found render_markdown stub".into()),
                    args_summary: None,
                },
                tracepilot_core::models::TurnToolCall {
                    tool_call_id: Some("tc_2".into()),
                    parent_tool_call_id: None,
                    tool_name: "cat".into(),
                    event_index: None,
                    arguments: None,
                    success: Some(false),
                    error: Some("file not found".into()),
                    started_at: None,
                    completed_at: None,
                    duration_ms: Some(30),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                    is_complete: true,
                    is_subagent: false,
                    agent_display_name: None,
                    agent_description: None,
                    model: None,
                    intention_summary: Some("Open missing file".into()),
                    total_tokens: None,
                    total_tool_calls: None,
                    result_content: None,
                    args_summary: Some("--path missing.txt".into()),
                },
            ],
            duration_ms: Some(2000),
            is_complete: true,
            reasoning_texts: vec![AttributedMessage {
                content: "Focus on export crate first.".into(),
                parent_tool_call_id: None,
                agent_display_name: Some("Reasoning".into()),
            }],
            output_tokens: Some(128),
            transformed_user_message: None,
            attachments: None,
            session_events: vec![tracepilot_core::models::TurnSessionEvent {
                event_type: "session.info".into(),
                timestamp: Some(Utc.with_ymd_and_hms(2026, 3, 25, 12, 1, 3).unwrap()),
                severity: tracepilot_core::models::SessionEventSeverity::Info,
                summary: "Export stub located".into(),
            }],
        }];

        let rendered = render_markdown(&summary, &turns);

        assert!(rendered.contains("# Session: CLI export investigation"));
        assert!(
            rendered.contains("- Repository: tracepilot/cli (branch main) — /workspace/tracepilot")
        );
        assert!(rendered.contains("- Events: 6"));
        assert!(rendered.contains("- Checkpoints: 2"));
        assert!(rendered.contains("### Turn 1"));
        assert!(rendered.contains("**User**"));
        assert!(rendered.contains("> Find TODO stubs in export crate."));
        assert!(rendered.contains("**Explore Agent**"));
        assert!(rendered.contains("Focus on export crate first."));
        assert!(rendered.contains(
            "[ok] rg (search) — 120 ms — model gpt-4o-mini — Locate TODO markers [id: tc_1]"
        ));
        assert!(rendered.contains("pattern"));
        assert!(rendered.contains("[error] cat — 30 ms — Open missing file [id: tc_2]"));
        assert!(rendered.contains("**Session Events**"));
        assert!(rendered.contains("session.info — Export stub located"));
    }

    #[test]
    fn renders_empty_conversation() {
        let summary = tracepilot_core::models::SessionSummary {
            id: "sess-empty".into(),
            summary: None,
            repository: None,
            branch: None,
            cwd: None,
            host_type: None,
            created_at: None,
            updated_at: None,
            event_count: None,
            has_events: false,
            has_session_db: false,
            has_plan: false,
            has_checkpoints: false,
            checkpoint_count: None,
            turn_count: None,
            shutdown_metrics: None,
        };

        let rendered = render_markdown(&summary, &[]);

        assert!(rendered.contains("# Session: sess-empty"));
        assert!(rendered.contains("_No conversation turns recorded._"));
    }

    fn sample_metrics() -> tracepilot_core::models::ShutdownMetrics {
        let mut model_metrics = HashMap::new();
        model_metrics.insert(
            "gpt-4o".into(),
            tracepilot_core::models::event_types::ModelMetricDetail {
                requests: Some(tracepilot_core::models::event_types::RequestMetrics {
                    count: Some(5),
                    cost: Some(0.0),
                }),
                usage: Some(tracepilot_core::models::event_types::UsageMetrics {
                    input_tokens: Some(1500),
                    output_tokens: Some(500),
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                    reasoning_tokens: None,
                }),
            },
        );
        tracepilot_core::models::ShutdownMetrics {
            shutdown_type: Some("graceful".into()),
            total_premium_requests: Some(4.0),
            total_api_duration_ms: Some(1200),
            session_start_time: Some(1_700_000_000),
            current_model: Some("gpt-4o".into()),
            current_tokens: None,
            system_tokens: None,
            conversation_tokens: None,
            tool_definitions_tokens: None,
            model_metrics,
            session_segments: None,
            code_changes: None,
            shutdown_count: Some(1),
        }
    }
}
