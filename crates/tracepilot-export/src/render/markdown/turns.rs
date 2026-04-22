//! Conversation & turn rendering: user/assistant blocks, reasoning, tool
//! calls (including subagent detail), and per-turn session events.

use std::fmt::Write;

use crate::document::{ConversationTurn, SessionEventSeverity};

pub(super) fn write_conversation(md: &mut String, turns: &[ConversationTurn]) {
    let _ = writeln!(md, "## Conversation\n");

    if turns.is_empty() {
        md.push_str("_No conversation turns recorded._\n\n");
        return;
    }

    for turn in turns {
        write_turn(md, turn);
    }
}

fn write_turn(md: &mut String, turn: &ConversationTurn) {
    let _ = writeln!(md, "### Turn {}", turn.turn_index + 1);

    let mut meta_parts = Vec::new();
    if let Some(model) = &turn.model {
        meta_parts.push(format!("Model: {}", model));
    }
    if let Some(duration) = turn.duration_ms {
        meta_parts.push(format!("{}ms", duration));
    }
    if let Some(tokens) = turn.output_tokens {
        meta_parts.push(format!("{} tokens", tokens));
    }
    if !meta_parts.is_empty() {
        let _ = writeln!(md, "*{}*\n", meta_parts.join(" · "));
    }

    match turn.user_message.as_deref() {
        Some(msg) if !msg.is_empty() => write_block(md, "User", msg),
        _ => md.push_str("_No user message._\n\n"),
    }

    for msg in &turn.assistant_messages {
        let label = msg.agent_display_name.as_deref().unwrap_or("Assistant");
        write_block(md, label, &msg.content);
    }

    if !turn.reasoning_texts.is_empty() {
        let _ = writeln!(md, "**Reasoning**\n");
        for msg in &turn.reasoning_texts {
            for line in msg.content.lines() {
                let _ = writeln!(md, "> {}", line);
            }
            md.push('\n');
        }
    }

    if !turn.tool_calls.is_empty() {
        md.push_str("**Tool Calls**\n\n");
        let _ = writeln!(md, "| Tool | Status | Duration | Summary |");
        let _ = writeln!(md, "|------|--------|----------|---------|");

        for tool in &turn.tool_calls {
            let status = match tool.success {
                Some(true) => "✅",
                Some(false) => "❌",
                None if tool.is_complete => "✔",
                _ => "⏳",
            };
            let duration = tool
                .duration_ms
                .map(|d| format!("{}ms", d))
                .unwrap_or_else(|| "—".to_string());

            let name = if tool.is_subagent {
                let display = tool
                    .agent_display_name
                    .as_deref()
                    .unwrap_or(&tool.tool_name);
                format!("🤖 {}", display)
            } else {
                tool.tool_name.clone()
            };

            let summary = if tool.is_subagent {
                let base = tool
                    .intention_summary
                    .as_deref()
                    .or(tool.args_summary.as_deref())
                    .unwrap_or("—");
                let mut parts: Vec<String> = vec![base.to_string()];
                if let Some(model) = tool.model.as_deref() {
                    parts.push(model.to_string());
                }
                if let Some(tok) = tool.total_tokens {
                    parts.push(format!("{} tok", tok));
                }
                if let Some(calls) = tool.total_tool_calls {
                    parts.push(format!("{} calls", calls));
                }
                parts.join(" · ")
            } else {
                tool.intention_summary
                    .as_deref()
                    .or(tool.args_summary.as_deref())
                    .unwrap_or("—")
                    .to_string()
            };

            let _ = writeln!(md, "| {} | {} | {} | {} |", name, status, duration, summary);
        }
        md.push('\n');

        let detailed_tools: Vec<_> = turn
            .tool_calls
            .iter()
            .filter(|t| t.arguments.is_some() || t.result_content.is_some())
            .collect();
        if !detailed_tools.is_empty() {
            for tool in detailed_tools {
                if tool.is_subagent {
                    let display = tool
                        .agent_display_name
                        .as_deref()
                        .unwrap_or(&tool.tool_name);
                    let _ = writeln!(md, "#### 🤖 {}\n", display);

                    let mut stats: Vec<String> = Vec::new();
                    if let Some(model) = tool.model.as_deref() {
                        if let Some(req) = tool.requested_model.as_deref()
                            && req != model
                        {
                            stats.push(format!("{} (requested: {})", model, req));
                        } else {
                            stats.push(model.to_string());
                        }
                    }
                    if let Some(tok) = tool.total_tokens {
                        stats.push(format!("{} tokens", tok));
                    }
                    if let Some(calls) = tool.total_tool_calls {
                        stats.push(format!("{} tool calls", calls));
                    }
                    if !stats.is_empty() {
                        let _ = writeln!(md, "*{}*\n", stats.join(" · "));
                    }

                    if let Some(desc) = tool.agent_description.as_deref() {
                        let _ = writeln!(md, "{}\n", desc);
                    }
                } else {
                    let _ = writeln!(md, "#### 🔧 {}\n", tool.tool_name);
                }

                if let Some(args) = &tool.arguments {
                    md.push_str("**Arguments:**\n\n");
                    let _ = writeln!(md, "```json\n{}\n```\n", args);
                }
                if let Some(result) = &tool.result_content {
                    let preview = if result.len() > 2000 {
                        format!(
                            "{}…\n\n*(truncated — {} bytes total)*",
                            &result[..result.floor_char_boundary(2000)],
                            result.len()
                        )
                    } else {
                        result.clone()
                    };
                    md.push_str("**Result:**\n\n");
                    let _ = writeln!(md, "```\n{}\n```\n", preview);
                }
            }
        }
    }

    if !turn.session_events.is_empty() {
        for event in &turn.session_events {
            let icon = match event.severity {
                SessionEventSeverity::Error => "🔴",
                SessionEventSeverity::Warning => "🟡",
                SessionEventSeverity::Info => "ℹ️",
            };
            let _ = writeln!(md, "> {} **{}**: {}", icon, event.event_type, event.summary);
        }
        md.push('\n');
    }
}

fn write_block(md: &mut String, label: &str, text: &str) {
    let _ = writeln!(md, "**{}**\n", label);
    for line in text.lines() {
        let _ = writeln!(md, "> {}", line);
    }
    md.push('\n');
}
