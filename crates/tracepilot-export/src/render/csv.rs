//! CSV renderer producing tabular files from session data.
//!
//! Outputs multiple CSV files per session, each representing a different
//! aspect of the data. The multi-file approach keeps each CSV simple with
//! consistent columns — much easier to work with in spreadsheets and BI tools.

use std::io::Write;

use chrono::DateTime;

use crate::document::*;
use crate::error::{ExportError, Result};
use crate::options::ExportFormat;
use crate::render::{ExportFile, ExportRenderer};

/// Renderer that produces CSV files for tabular analysis.
///
/// For each session, produces up to 5 files depending on available data:
/// - `session-{id}-summary.csv`: single-row session overview
/// - `session-{id}-conversation.csv`: one row per conversation turn
/// - `session-{id}-tools.csv`: one row per tool call
/// - `session-{id}-events.csv`: one row per raw event
/// - `session-{id}-model-metrics.csv`: one row per model used
pub struct CsvRenderer;

impl ExportRenderer for CsvRenderer {
    fn format(&self) -> ExportFormat {
        ExportFormat::Csv
    }

    fn render(&self, archive: &SessionArchive) -> Result<Vec<ExportFile>> {
        let mut files = Vec::new();

        for session in &archive.sessions {
            let prefix = short_prefix(&session.metadata.id);
            render_session_files(&mut files, session, &prefix)?;
        }

        if files.is_empty() {
            return Err(ExportError::Render {
                format: "CSV".to_string(),
                message: "no sessions to render".to_string(),
            });
        }

        Ok(files)
    }

    fn display_name(&self) -> &'static str {
        "CSV (.csv)"
    }

    fn extension(&self) -> &'static str {
        "csv"
    }

    fn mime_type(&self) -> &'static str {
        "text/csv"
    }
}

// ── File generation ────────────────────────────────────────────────────────

fn render_session_files(
    files: &mut Vec<ExportFile>,
    session: &PortableSession,
    prefix: &str,
) -> Result<()> {
    // Summary is always produced (metadata is always present)
    files.push(make_file(prefix, "summary", render_summary_csv(session)?));

    if let Some(conversation) = &session.conversation
        && !conversation.is_empty()
    {
        files.push(make_file(
            prefix,
            "conversation",
            render_conversation_csv(conversation)?,
        ));

        // Flatten all tool calls from all turns
        let has_tools = conversation.iter().any(|t| !t.tool_calls.is_empty());
        if has_tools {
            files.push(make_file(prefix, "tools", render_tools_csv(conversation)?));
        }
    }

    if let Some(events) = &session.events
        && !events.is_empty()
    {
        files.push(make_file(prefix, "events", render_events_csv(events)?));
    }

    if let Some(metrics) = &session.shutdown_metrics
        && !metrics.model_metrics.is_empty()
    {
        files.push(make_file(
            prefix,
            "model-metrics",
            render_model_metrics_csv(metrics)?,
        ));
    }

    Ok(())
}

fn make_file(prefix: &str, name: &str, content: Vec<u8>) -> ExportFile {
    ExportFile {
        filename: format!("{}-{}.csv", prefix, name),
        content,
        mime_type: "text/csv".to_string(),
    }
}

fn short_prefix(id: &str) -> String {
    let short = &id[..id.floor_char_boundary(8.min(id.len()))];
    format!("session-{}", short)
}

// ── CSV renderers for each data aspect ─────────────────────────────────────

fn render_summary_csv(session: &PortableSession) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let meta = &session.metadata;

    writeln!(
        out,
        "id,summary,repository,branch,host_type,created_at,updated_at,event_count,turn_count,health_score"
    )
    .map_err(csv_write_err)?;

    writeln!(
        out,
        "{},{},{},{},{},{},{},{},{},{}",
        escape_csv(&meta.id),
        escape_csv_opt(meta.summary.as_deref()),
        escape_csv_opt(meta.repository.as_deref()),
        escape_csv_opt(meta.branch.as_deref()),
        escape_csv_opt(meta.host_type.as_deref()),
        escape_csv_opt(meta.created_at.as_ref().map(fmt_dt).as_deref()),
        escape_csv_opt(meta.updated_at.as_ref().map(fmt_dt).as_deref()),
        meta.event_count.unwrap_or(0),
        meta.turn_count.unwrap_or(0),
        session
            .health
            .as_ref()
            .map(|h| format!("{:.2}", h.score))
            .unwrap_or_default(),
    )
    .map_err(csv_write_err)?;

    Ok(out)
}

fn render_conversation_csv(turns: &[ConversationTurn]) -> Result<Vec<u8>> {
    let mut out = Vec::new();

    writeln!(
        out,
        "turn,model,user_message,assistant_response,tool_count,duration_ms,output_tokens,is_complete"
    )
    .map_err(csv_write_err)?;

    for turn in turns {
        let user_msg = turn.user_message.as_deref().unwrap_or("");
        let assistant_msg = turn
            .assistant_messages
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join(" | ");

        writeln!(
            out,
            "{},{},{},{},{},{},{},{}",
            turn.turn_index + 1,
            escape_csv_opt(turn.model.as_deref()),
            escape_csv(user_msg),
            escape_csv(&assistant_msg),
            turn.tool_calls.len(),
            turn.duration_ms.unwrap_or(0),
            turn.output_tokens.unwrap_or(0),
            turn.is_complete,
        )
        .map_err(csv_write_err)?;
    }

    Ok(out)
}

fn render_tools_csv(turns: &[ConversationTurn]) -> Result<Vec<u8>> {
    let mut out = Vec::new();

    writeln!(
        out,
        "turn,tool_name,is_subagent,success,duration_ms,intention_summary"
    )
    .map_err(csv_write_err)?;

    for turn in turns {
        for tool in &turn.tool_calls {
            let success = match tool.success {
                Some(true) => "true",
                Some(false) => "false",
                None => "",
            };

            writeln!(
                out,
                "{},{},{},{},{},{}",
                turn.turn_index + 1,
                escape_csv(&tool.tool_name),
                tool.is_subagent,
                success,
                tool.duration_ms.unwrap_or(0),
                escape_csv_opt(tool.intention_summary.as_deref()),
            )
            .map_err(csv_write_err)?;
        }
    }

    Ok(out)
}

fn render_events_csv(events: &[RawEvent]) -> Result<Vec<u8>> {
    let mut out = Vec::new();

    writeln!(out, "event_type,timestamp,data_preview").map_err(csv_write_err)?;

    for event in events {
        let ts = event.timestamp.as_ref().map(fmt_dt).unwrap_or_default();

        // Show a truncated preview of the data payload
        let preview = {
            let s = event.data.to_string();
            if s.len() > 200 {
                let boundary = s.floor_char_boundary(200);
                format!("{}…", &s[..boundary])
            } else {
                s
            }
        };

        writeln!(
            out,
            "{},{},{}",
            escape_csv(&event.event_type),
            escape_csv(&ts),
            escape_csv(&preview),
        )
        .map_err(csv_write_err)?;
    }

    Ok(out)
}

fn render_model_metrics_csv(metrics: &ShutdownMetrics) -> Result<Vec<u8>> {
    let mut out = Vec::new();

    writeln!(
        out,
        "model,requests,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens"
    )
    .map_err(csv_write_err)?;

    let mut models: Vec<_> = metrics.model_metrics.iter().collect();
    models.sort_by_key(|(k, _)| k.as_str());

    for (model, detail) in models {
        let reqs = detail.requests.as_ref().and_then(|r| r.count).unwrap_or(0);
        let usage = detail.usage.as_ref();
        let input = usage.and_then(|u| u.input_tokens).unwrap_or(0);
        let output = usage.and_then(|u| u.output_tokens).unwrap_or(0);
        let cache_r = usage.and_then(|u| u.cache_read_tokens).unwrap_or(0);
        let cache_w = usage.and_then(|u| u.cache_write_tokens).unwrap_or(0);

        writeln!(
            out,
            "{},{},{},{},{},{}",
            escape_csv(model),
            reqs,
            input,
            output,
            cache_r,
            cache_w,
        )
        .map_err(csv_write_err)?;
    }

    Ok(out)
}

// ── CSV helpers ────────────────────────────────────────────────────────────

/// Escape a string value for CSV.
///
/// Applies formula-injection hardening: values starting with `=`, `+`, `-`,
/// `@`, `\t`, or `\r` are prefixed with a single-quote to prevent spreadsheet
/// formula execution — a security best practice for user-generated content.
fn escape_csv(value: &str) -> String {
    // Formula-injection hardening
    let sanitized = if value.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{}", value)
    } else {
        value.to_string()
    };

    // Standard CSV quoting: if the value contains commas, quotes, or newlines,
    // wrap in double-quotes and escape internal quotes by doubling them.
    if sanitized.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", sanitized.replace('"', "\"\""))
    } else {
        sanitized
    }
}

fn escape_csv_opt(value: Option<&str>) -> String {
    match value {
        Some(v) => escape_csv(v),
        None => String::new(),
    }
}

fn fmt_dt(dt: &DateTime<chrono::Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn csv_write_err(e: std::io::Error) -> ExportError {
    ExportError::Render {
        format: "CSV".to_string(),
        message: format!("write error: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{minimal_session, simple_tool_call, simple_turn, test_archive};

    #[test]
    fn summary_csv_always_produced() {
        let archive = test_archive(minimal_session());
        let renderer = CsvRenderer;
        let files = renderer.render(&archive).unwrap();

        assert!(!files.is_empty());
        assert!(files[0].filename.ends_with("-summary.csv"));

        let text = files[0].as_text().unwrap();
        assert!(text.contains("id,summary,repository"));
        assert!(text.contains("test-12345678"));
    }

    #[test]
    fn conversation_csv_rows() {
        let mut session = minimal_session();
        session.conversation = Some(vec![simple_turn(
            0,
            "Hello",
            "Hi!",
            Some("claude-opus-4.6"),
        )]);

        let archive = test_archive(session);
        let renderer = CsvRenderer;
        let files = renderer.render(&archive).unwrap();

        let conv_file = files
            .iter()
            .find(|f| f.filename.contains("conversation"))
            .unwrap();
        let text = conv_file.as_text().unwrap();
        assert!(text.contains("turn,model,user_message"));
        assert!(text.contains("claude-opus-4.6"));
    }

    #[test]
    fn tools_csv_generated_when_tools_present() {
        let mut session = minimal_session();
        let mut turn = simple_turn(0, "fix it", "", None);
        turn.tool_calls = vec![simple_tool_call("write_file", Some(true), false)];
        session.conversation = Some(vec![turn]);

        let archive = test_archive(session);
        let renderer = CsvRenderer;
        let files = renderer.render(&archive).unwrap();

        let tools_file = files.iter().find(|f| f.filename.contains("tools")).unwrap();
        let text = tools_file.as_text().unwrap();
        assert!(text.contains("write_file"));
        assert!(text.contains("Run write_file"));
    }

    #[test]
    fn formula_injection_hardening() {
        assert!(escape_csv("=SUM(A1)").starts_with("'="));
        assert!(escape_csv("+cmd|'/c calc'!A0").starts_with("'+"));
        assert!(escape_csv("-1+1").starts_with("'-"));
        assert!(escape_csv("@SUM(A1)").starts_with("'@"));

        // Normal values are not prefixed
        assert_eq!(escape_csv("hello"), "hello");
    }

    #[test]
    fn csv_quoting_for_special_chars() {
        let result = escape_csv("value with, comma");
        assert!(result.starts_with('"'));
        assert!(result.ends_with('"'));

        let result = escape_csv("value with \"quotes\"");
        assert!(result.contains("\"\""));
    }

    #[test]
    fn no_tools_csv_when_no_tools() {
        let mut session = minimal_session();
        session.conversation = Some(vec![simple_turn(0, "Hello", "", None)]);

        let archive = test_archive(session);
        let renderer = CsvRenderer;
        let files = renderer.render(&archive).unwrap();

        assert!(files.iter().all(|f| !f.filename.contains("tools")));
    }

    #[test]
    fn filenames_use_short_prefix() {
        let archive = test_archive(minimal_session());
        let renderer = CsvRenderer;
        let files = renderer.render(&archive).unwrap();

        for file in &files {
            assert!(file.filename.starts_with("session-test-123"));
        }
    }
}
