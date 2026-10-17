//! Conversation & turn rendering: user/assistant blocks, reasoning, tool
//! calls (including subagent detail), and per-turn session events.

use tracepilot_core::provider::claude_code::without_paste_tags;
use tracepilot_core::utils::InfallibleWrite;

use crate::document::{ConversationTurn, SessionEventSeverity, TurnSessionEvent, TurnToolCall};

use super::{cell, format_duration, push_fenced};

pub(super) fn write_conversation(md: &mut String, turns: &[ConversationTurn]) {
    md.push_line(format_args!("## Conversation\n"));

    if turns.is_empty() {
        md.push_str("_No conversation turns recorded._\n\n");
        return;
    }

    for turn in turns {
        write_turn(md, turn);
    }
}

fn write_turn(md: &mut String, turn: &ConversationTurn) {
    // The app numbers turns from 0; the export uses the same numbers.
    md.push_line(format_args!("### Turn {}", turn.turn_index));

    let mut meta_parts = Vec::new();
    if let Some(model) = &turn.model {
        meta_parts.push(format!("Model: {}", model));
    }
    if let Some(duration) = turn.duration_ms {
        meta_parts.push(format_duration(duration));
    }
    if let Some(tokens) = turn.output_tokens {
        meta_parts.push(format!("{} output tokens", tokens));
    }
    if !meta_parts.is_empty() {
        md.push_line(format_args!("*{}*\n", meta_parts.join(" · ")));
    }

    // Events logged before the turn's message (`session.start`, a resume or
    // model change) come first; the rest happened during the turn's work.
    let (before, during): (Vec<_>, Vec<_>) = turn
        .session_events
        .iter()
        .partition(|event| happened_before(event, turn));
    write_session_events(md, &before);

    // A background task's completion opened the turn, not the user.
    let author = if turn.notifications.is_empty() {
        "User"
    } else {
        "Notification"
    };
    match turn.user_message.as_deref() {
        // Claude Code wraps pasted text in tags; the text reads fine without them.
        Some(msg) if !msg.is_empty() => write_block(md, author, &without_paste_tags(msg)),
        _ => md.push_str("_No user message._\n\n"),
    }

    for msg in &turn.assistant_messages {
        let label = msg.agent_display_name.as_deref().unwrap_or("Assistant");
        write_block(md, label, &msg.content);
    }

    if !turn.reasoning_texts.is_empty() {
        md.push_line(format_args!("**Reasoning**\n"));
        for msg in &turn.reasoning_texts {
            for line in msg.content.lines() {
                md.push_line(format_args!("> {}", line));
            }
            md.push('\n');
        }
    }

    if !turn.tool_calls.is_empty() {
        md.push_str("**Tool Calls**\n\n");
        md.push_line(format_args!("| Tool | Status | Duration | Summary |"));
        md.push_line(format_args!("|------|--------|----------|---------|"));

        for tool in &turn.tool_calls {
            let status = match tool.success {
                Some(true) => "✅",
                Some(false) => "❌",
                None if tool.is_complete => "✔",
                _ => "⏳",
            };
            let duration = tool
                .duration_ms
                .map(format_duration)
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

            md.push_line(format_args!(
                "| {} | {} | {} | {} |",
                cell(&name),
                status,
                duration,
                cell(&summary)
            ));
        }
        md.push('\n');

        let detailed_tools: Vec<_> = turn
            .tool_calls
            .iter()
            .filter(|t| t.arguments.is_some() || t.result_content.is_some() || failure(t).is_some())
            .collect();
        if !detailed_tools.is_empty() {
            for tool in detailed_tools {
                if tool.is_subagent {
                    let display = tool
                        .agent_display_name
                        .as_deref()
                        .unwrap_or(&tool.tool_name);
                    md.push_line(format_args!("#### 🤖 {}\n", display));

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
                        md.push_line(format_args!("*{}*\n", stats.join(" · ")));
                    }

                    if let Some(desc) = tool.agent_description.as_deref() {
                        md.push_line(format_args!("{}\n", desc));
                    }
                } else {
                    md.push_line(format_args!("#### 🔧 {}\n", tool.tool_name));
                }

                if let Some(args) = &tool.arguments {
                    md.push_str("**Arguments:**\n\n");
                    push_fenced(md, "json", &args.to_string());
                }
                if let Some(result) = &tool.result_content {
                    md.push_str("**Result:**\n\n");
                    push_fenced(md, "", result);
                }
                if let Some(error) = failure(tool) {
                    md.push_str("**Error:**\n\n");
                    push_fenced(md, "", &error_text(error));
                }
            }
        }
    }

    write_session_events(md, &during);
}

/// Longest error text written for one tool call. A failed command's error can
/// carry its whole output; the start says what went wrong.
const MAX_ERROR_BYTES: usize = 2_000;

/// The error a failed tool call reported, if it reported one.
fn failure(tool: &TurnToolCall) -> Option<&str> {
    let error = tool.error.as_deref()?.trim();
    (tool.success != Some(true) && !error.is_empty()).then_some(error)
}

fn error_text(error: &str) -> String {
    if error.len() <= MAX_ERROR_BYTES {
        return error.to_string();
    }
    let kept = tracepilot_core::utils::truncate_utf8(error, MAX_ERROR_BYTES);
    format!(
        "{kept}\n… (truncated: {} of {} bytes shown)",
        kept.len(),
        error.len()
    )
}

/// Whether `event` was logged before the turn's own message. Events without
/// a timestamp, or logged at the same instant, stay with the turn's work.
fn happened_before(event: &TurnSessionEvent, turn: &ConversationTurn) -> bool {
    matches!((event.timestamp, turn.timestamp), (Some(at), Some(start)) if at < start)
}

fn write_session_events(md: &mut String, events: &[&TurnSessionEvent]) {
    if events.is_empty() {
        return;
    }
    for event in events {
        let icon = match event.severity {
            SessionEventSeverity::Error => "🔴",
            SessionEventSeverity::Warning => "🟡",
            SessionEventSeverity::Info => "ℹ️",
        };
        md.push_line(format_args!(
            "> {} **{}**: {}",
            icon, event.event_type, event.summary
        ));
    }
    md.push('\n');
}

fn write_block(md: &mut String, label: &str, text: &str) {
    md.push_line(format_args!("**{}**\n", label));
    for line in text.lines() {
        md.push_line(format_args!("> {}", line));
    }
    md.push('\n');
}
