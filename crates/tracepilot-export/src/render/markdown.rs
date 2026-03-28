//! Markdown renderer for human-readable session documents.
//!
//! Produces a single `.md` file with all included sections formatted for
//! readability. Intended for sharing with teammates, pasting into docs,
//! or feeding to AI for summarization.

use std::fmt::Write;

use chrono::{DateTime, Utc};

use crate::document::*;
use crate::error::{ExportError, Result};
use crate::options::ExportFormat;
use crate::render::{ExportFile, ExportRenderer};

/// Renderer that produces human-readable Markdown documents.
pub struct MarkdownRenderer;

impl ExportRenderer for MarkdownRenderer {
    fn format(&self) -> ExportFormat {
        ExportFormat::Markdown
    }

    fn render(&self, archive: &SessionArchive) -> Result<Vec<ExportFile>> {
        let mut files = Vec::new();

        for session in &archive.sessions {
            let md = render_session(session, archive);
            let id = &session.metadata.id;
            let short_id = &id[..id.floor_char_boundary(8.min(id.len()))];
            files.push(ExportFile {
                filename: format!("session-{}.md", short_id),
                content: md.into_bytes(),
                mime_type: self.mime_type().to_string(),
            });
        }

        if files.is_empty() {
            return Err(ExportError::Render {
                format: "Markdown".to_string(),
                message: "no sessions to render".to_string(),
            });
        }

        Ok(files)
    }

    fn display_name(&self) -> &'static str {
        "Markdown (.md)"
    }

    fn extension(&self) -> &'static str {
        "md"
    }

    fn mime_type(&self) -> &'static str {
        "text/markdown"
    }
}

// ── Session rendering ──────────────────────────────────────────────────────

fn render_session(session: &PortableSession, archive: &SessionArchive) -> String {
    let mut md = String::with_capacity(4096);

    write_header(&mut md, session, archive);
    write_metadata(&mut md, &session.metadata);

    // Sections in a logical reading order
    if let Some(plan) = &session.plan {
        write_plan(&mut md, plan);
    }
    if let Some(conversation) = &session.conversation {
        write_conversation(&mut md, conversation);
    }
    if let Some(todos) = &session.todos {
        write_todos(&mut md, todos);
    }
    if let Some(checkpoints) = &session.checkpoints {
        write_checkpoints(&mut md, checkpoints);
    }
    if let Some(metrics) = &session.shutdown_metrics {
        write_metrics(&mut md, metrics);
    }
    if let Some(health) = &session.health {
        write_health(&mut md, health);
    }
    if let Some(incidents) = &session.incidents {
        write_incidents(&mut md, incidents);
    }
    if let Some(events) = &session.events {
        write_events_summary(&mut md, events);
    }
    if let Some(diag) = &session.parse_diagnostics {
        write_diagnostics(&mut md, diag);
    }

    md
}

// ── Section writers ────────────────────────────────────────────────────────

fn write_header(md: &mut String, session: &PortableSession, archive: &SessionArchive) {
    let title = session
        .metadata
        .summary
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(&session.metadata.id);

    let _ = writeln!(md, "# Session: {}", title);
    md.push('\n');
    let _ = writeln!(
        md,
        "> Exported by {} on {} · Schema v{}",
        archive.header.exported_by,
        format_dt(&archive.header.exported_at),
        archive.header.schema_version,
    );
    md.push('\n');
}

fn write_metadata(md: &mut String, meta: &PortableSessionMetadata) {
    let _ = writeln!(md, "## Metadata\n");
    let _ = writeln!(md, "| Field | Value |");
    let _ = writeln!(md, "|-------|-------|");
    let _ = writeln!(md, "| ID | `{}` |", meta.id);

    if let Some(repo) = &meta.repository {
        let _ = writeln!(md, "| Repository | {} |", repo);
    }
    if let Some(branch) = &meta.branch {
        let _ = writeln!(md, "| Branch | {} |", branch);
    }
    if let Some(cwd) = &meta.cwd {
        let _ = writeln!(md, "| Working Directory | `{}` |", cwd);
    }
    if let Some(host) = &meta.host_type {
        let _ = writeln!(md, "| Host Type | {} |", host);
    }
    if let Some(created) = &meta.created_at {
        let _ = writeln!(md, "| Created | {} |", format_dt(created));
    }
    if let Some(updated) = &meta.updated_at {
        let _ = writeln!(md, "| Updated | {} |", format_dt(updated));
    }
    if let Some(events) = meta.event_count {
        let _ = writeln!(md, "| Events | {} |", events);
    }
    if let Some(turns) = meta.turn_count {
        let _ = writeln!(md, "| Turns | {} |", turns);
    }
    md.push('\n');
}

fn write_plan(md: &mut String, plan: &str) {
    let _ = writeln!(md, "## Plan\n");
    // Indent plan content to avoid heading conflicts
    for line in plan.lines() {
        if line.starts_with('#') {
            // Demote headings by 2 levels to nest under our "Plan" heading
            let _ = writeln!(md, "##{}", line);
        } else {
            let _ = writeln!(md, "{}", line);
        }
    }
    md.push('\n');
}

fn write_conversation(md: &mut String, turns: &[ConversationTurn]) {
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

    // Turn metadata line
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

    // User message
    match turn.user_message.as_deref() {
        Some(msg) if !msg.is_empty() => write_block(md, "User", msg),
        _ => md.push_str("_No user message._\n\n"),
    }

    // Assistant messages
    for msg in &turn.assistant_messages {
        let label = msg
            .agent_display_name
            .as_deref()
            .unwrap_or("Assistant");
        write_block(md, label, &msg.content);
    }

    // Reasoning (rendered as a blockquote section)
    if !turn.reasoning_texts.is_empty() {
        let _ = writeln!(md, "**Reasoning**\n");
        for msg in &turn.reasoning_texts {
            for line in msg.content.lines() {
                let _ = writeln!(md, "> {}", line);
            }
            md.push('\n');
        }
    }

    // Tool calls
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
            let summary = tool
                .intention_summary
                .as_deref()
                .or(tool.args_summary.as_deref())
                .unwrap_or("—");

            let name = if tool.is_subagent {
                format!("🤖 {}", tool.tool_name)
            } else {
                tool.tool_name.clone()
            };

            let _ = writeln!(md, "| {} | {} | {} | {} |", name, status, duration, summary);
        }
        md.push('\n');

        // Detailed tool call content (when tool details are included)
        let detailed_tools: Vec<_> = turn.tool_calls.iter()
            .filter(|t| t.arguments.is_some() || t.result_content.is_some())
            .collect();
        if !detailed_tools.is_empty() {
            for tool in detailed_tools {
                let _ = writeln!(md, "#### 🔧 {}\n", tool.tool_name);
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

    // Session events within this turn
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

fn write_todos(md: &mut String, todos: &TodoExport) {
    let _ = writeln!(md, "## Todos\n");

    if todos.items.is_empty() {
        md.push_str("_No todos._\n\n");
        return;
    }

    for item in &todos.items {
        let checkbox = match item.status.as_str() {
            "done" => "[x]",
            _ => "[ ]",
        };
        let _ = writeln!(md, "- {} **{}**: {}", checkbox, item.id, item.title);
        if let Some(desc) = &item.description {
            if !desc.is_empty() {
                let _ = writeln!(md, "  {}", desc);
            }
        }
    }

    // Dependency graph if present
    if !todos.deps.is_empty() {
        md.push_str("\n**Dependencies:**\n");
        for dep in &todos.deps {
            let _ = writeln!(md, "- {} → {}", dep.todo_id, dep.depends_on);
        }
    }
    md.push('\n');
}

fn write_checkpoints(md: &mut String, checkpoints: &[CheckpointExport]) {
    let _ = writeln!(md, "## Checkpoints\n");

    if checkpoints.is_empty() {
        md.push_str("_No checkpoints._\n\n");
        return;
    }

    for cp in checkpoints {
        let _ = writeln!(md, "### Checkpoint {}: {}\n", cp.number, cp.title);
        if let Some(content) = &cp.content {
            // Demote headings in checkpoint content
            for line in content.lines() {
                if line.starts_with('#') {
                    let _ = writeln!(md, "####{}", line);
                } else {
                    let _ = writeln!(md, "{}", line);
                }
            }
            md.push('\n');
        }
    }
}

fn write_metrics(md: &mut String, metrics: &ShutdownMetrics) {
    let _ = writeln!(md, "## Metrics\n");

    let _ = writeln!(md, "| Metric | Value |");
    let _ = writeln!(md, "|--------|-------|");

    if let Some(kind) = &metrics.shutdown_type {
        let _ = writeln!(md, "| Shutdown Type | {} |", kind);
    }
    if let Some(model) = &metrics.current_model {
        let _ = writeln!(md, "| Model | {} |", model);
    }
    if let Some(reqs) = metrics.total_premium_requests {
        let _ = writeln!(md, "| Premium Requests | {} |", reqs);
    }
    if let Some(api_ms) = metrics.total_api_duration_ms {
        let _ = writeln!(md, "| API Duration | {}ms |", api_ms);
    }
    if let Some(changes) = &metrics.code_changes {
        if let Some(added) = changes.lines_added {
            let _ = writeln!(md, "| Lines Added | +{} |", added);
        }
        if let Some(removed) = changes.lines_removed {
            let _ = writeln!(md, "| Lines Removed | -{} |", removed);
        }
    }
    md.push('\n');

    // Per-model breakdown
    if !metrics.model_metrics.is_empty() {
        let _ = writeln!(md, "### Model Usage\n");
        let _ = writeln!(
            md,
            "| Model | Requests | Input Tokens | Output Tokens | Cache Read | Cache Write |"
        );
        let _ = writeln!(md, "|-------|----------|--------------|---------------|------------|-------------|");

        let mut sorted: Vec<_> = metrics.model_metrics.iter().collect();
        sorted.sort_by_key(|(k, _)| k.as_str());

        for (model, detail) in sorted {
            let reqs = detail
                .requests
                .as_ref()
                .and_then(|r| r.count)
                .unwrap_or(0);
            let input = detail
                .usage
                .as_ref()
                .and_then(|u| u.input_tokens)
                .unwrap_or(0);
            let output = detail
                .usage
                .as_ref()
                .and_then(|u| u.output_tokens)
                .unwrap_or(0);
            let cache_r = detail
                .usage
                .as_ref()
                .and_then(|u| u.cache_read_tokens)
                .unwrap_or(0);
            let cache_w = detail
                .usage
                .as_ref()
                .and_then(|u| u.cache_write_tokens)
                .unwrap_or(0);

            let _ = writeln!(
                md,
                "| {} | {} | {} | {} | {} | {} |",
                model, reqs, input, output, cache_r, cache_w
            );
        }
        md.push('\n');
    }
}

fn write_health(md: &mut String, health: &SessionHealth) {
    let _ = writeln!(md, "## Health\n");
    let _ = writeln!(md, "**Score:** {:.0}%\n", health.score * 100.0);

    if !health.flags.is_empty() {
        let _ = writeln!(md, "| Severity | Category | Message |");
        let _ = writeln!(md, "|----------|----------|---------|");
        for flag in &health.flags {
            let icon = match flag.severity {
                HealthSeverity::Error => "🔴 Error",
                HealthSeverity::Warning => "🟡 Warning",
                HealthSeverity::Info => "ℹ️ Info",
            };
            let _ = writeln!(md, "| {} | {} | {} |", icon, flag.category, flag.message);
        }
        md.push('\n');
    }
}

fn write_incidents(md: &mut String, incidents: &[IncidentExport]) {
    if incidents.is_empty() {
        return;
    }

    let _ = writeln!(md, "## Incidents\n");
    let _ = writeln!(md, "| Time | Type | Severity | Summary |");
    let _ = writeln!(md, "|------|------|----------|---------|");

    for inc in incidents {
        let time = inc
            .timestamp
            .as_ref()
            .map(|t| format_dt(t))
            .unwrap_or_else(|| "—".to_string());
        let _ = writeln!(
            md,
            "| {} | {} | {} | {} |",
            time, inc.event_type, inc.severity, inc.summary
        );
    }
    md.push('\n');
}

fn write_events_summary(md: &mut String, events: &[RawEvent]) {
    let _ = writeln!(md, "## Events Summary\n");
    let _ = writeln!(md, "Total events: {}\n", events.len());

    // Count by type
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for event in events {
        *counts.entry(&event.event_type).or_default() += 1;
    }

    let mut sorted: Vec<_> = counts.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));

    let _ = writeln!(md, "| Event Type | Count |");
    let _ = writeln!(md, "|------------|-------|");
    for (event_type, count) in sorted {
        let _ = writeln!(md, "| `{}` | {} |", event_type, count);
    }
    md.push('\n');
}

fn write_diagnostics(md: &mut String, diag: &ParseDiagnosticsExport) {
    let _ = writeln!(md, "## Parse Diagnostics\n");
    let _ = writeln!(md, "- Total events: {}", diag.total_events);
    let _ = writeln!(md, "- Malformed lines: {}", diag.malformed_lines);
    let _ = writeln!(md, "- Unknown event types: {}", diag.unknown_event_types);
    let _ = writeln!(
        md,
        "- Deserialization failures: {}",
        diag.deserialization_failures
    );
    md.push('\n');
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn format_dt(dt: &DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn write_block(md: &mut String, label: &str, text: &str) {
    let _ = writeln!(md, "**{}**\n", label);
    for line in text.lines() {
        let _ = writeln!(md, "> {}", line);
    }
    md.push('\n');
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{minimal_session, simple_turn, test_archive};

    #[test]
    fn renders_metadata_table() {
        let archive = test_archive(minimal_session());
        let renderer = MarkdownRenderer;
        let files = renderer.render(&archive).unwrap();

        let text = files[0].as_text().unwrap();
        assert!(text.contains("# Session: Test session"));
        assert!(text.contains("| ID | `test-12345678` |"));
        assert!(text.contains("| Repository | user/repo |"));
        assert!(text.contains("| Branch | main |"));
    }

    #[test]
    fn renders_conversation_turns() {
        let mut session = minimal_session();
        session.conversation = Some(vec![
            simple_turn(0, "Hello", "Hi there!", Some("claude-opus-4.6")),
        ]);

        let archive = test_archive(session);
        let renderer = MarkdownRenderer;
        let files = renderer.render(&archive).unwrap();

        let text = files[0].as_text().unwrap();
        assert!(text.contains("## Conversation"));
        assert!(text.contains("### Turn 1"));
        assert!(text.contains("*Model: claude-opus-4.6"));
        assert!(text.contains("> Hello"));
        assert!(text.contains("> Hi there!"));
    }

    #[test]
    fn renders_todos_with_checkboxes() {
        let mut session = minimal_session();
        session.todos = Some(TodoExport {
            items: vec![
                TodoItemExport {
                    id: "setup".to_string(),
                    title: "Project setup".to_string(),
                    description: Some("Initialize the project".to_string()),
                    status: "done".to_string(),
                    created_at: None,
                    updated_at: None,
                },
                TodoItemExport {
                    id: "impl".to_string(),
                    title: "Implementation".to_string(),
                    description: None,
                    status: "pending".to_string(),
                    created_at: None,
                    updated_at: None,
                },
            ],
            deps: vec![TodoDepExport {
                todo_id: "impl".to_string(),
                depends_on: "setup".to_string(),
            }],
        });

        let archive = test_archive(session);
        let renderer = MarkdownRenderer;
        let files = renderer.render(&archive).unwrap();

        let text = files[0].as_text().unwrap();
        assert!(text.contains("[x] **setup**: Project setup"));
        assert!(text.contains("[ ] **impl**: Implementation"));
        assert!(text.contains("impl → setup"));
    }

    #[test]
    fn renders_plan() {
        let mut session = minimal_session();
        session.plan = Some("# My Plan\n\n## Phase 1\n\n- Build core\n".to_string());

        let archive = test_archive(session);
        let renderer = MarkdownRenderer;
        let files = renderer.render(&archive).unwrap();

        let text = files[0].as_text().unwrap();
        assert!(text.contains("## Plan"));
        assert!(text.contains("Build core"));
    }

    #[test]
    fn renders_health_score() {
        let mut session = minimal_session();
        session.health = Some(SessionHealth {
            score: 0.85,
            flags: vec![HealthFlag {
                severity: HealthSeverity::Warning,
                category: "size".to_string(),
                message: "Large session".to_string(),
            }],
        });

        let archive = test_archive(session);
        let renderer = MarkdownRenderer;
        let files = renderer.render(&archive).unwrap();

        let text = files[0].as_text().unwrap();
        assert!(text.contains("**Score:** 85%"));
        assert!(text.contains("Large session"));
    }

    #[test]
    fn filename_uses_short_id() {
        let archive = test_archive(minimal_session());
        let renderer = MarkdownRenderer;
        let files = renderer.render(&archive).unwrap();
        assert_eq!(files[0].filename, "session-test-123.md");
    }

    #[test]
    fn renders_tool_calls_table() {
        let mut session = minimal_session();
        let mut turn = simple_turn(0, "Fix the bug", "Done!", None);
        turn.tool_calls = vec![
            crate::test_helpers::simple_tool_call("write_file", Some(true), false),
            crate::test_helpers::simple_tool_call("task", Some(true), true),
        ];
        session.conversation = Some(vec![turn]);

        let archive = test_archive(session);
        let renderer = MarkdownRenderer;
        let files = renderer.render(&archive).unwrap();

        let text = files[0].as_text().unwrap();
        assert!(text.contains("**Tool Calls**"));
        assert!(text.contains("write_file"));
        assert!(text.contains("🤖 task")); // subagent icon
    }

    #[test]
    fn renders_empty_conversation() {
        let mut session = minimal_session();
        session.conversation = Some(vec![]);

        let archive = test_archive(session);
        let renderer = MarkdownRenderer;
        let files = renderer.render(&archive).unwrap();

        let text = files[0].as_text().unwrap();
        assert!(text.contains("_No conversation turns recorded._"));
    }
}
