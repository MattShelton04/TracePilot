// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Tool-call argument summaries in exports: the one-line command, path or
//! pattern the app's turn view shows, which the Markdown tool table falls back
//! to when a call has no intention summary.

use std::fs;

use serde_json::json;
use tracepilot_export::document::{SectionId, SessionArchive};
use tracepilot_export::options::*;
use tracepilot_export::*;
use tracepilot_test_support::fixtures::{full_workspace_yaml, workspace_only_temp_dir};

const TOKEN: &str = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";

/// One turn with a shell call and a file view, neither carrying an intention.
fn session_with_tool_calls(command: &str) -> tempfile::TempDir {
    let (dir, _) = workspace_only_temp_dir(full_workspace_yaml());
    let records = [
        json!({"type":"user.message","id":"user","timestamp":"2026-03-10T10:00:00Z","data":{"content":"Tag the release"}}),
        json!({"type":"tool.execution_start","id":"s1","parentId":"user","timestamp":"2026-03-10T10:00:01Z","data":{"toolCallId":"call-shell","toolName":"powershell","arguments":{"command":command}}}),
        json!({"type":"tool.execution_complete","id":"c1","parentId":"s1","timestamp":"2026-03-10T10:00:02Z","data":{"toolCallId":"call-shell","success":true,"result":{"content":"done"}}}),
        json!({"type":"tool.execution_start","id":"s2","parentId":"c1","timestamp":"2026-03-10T10:00:03Z","data":{"toolCallId":"call-view","toolName":"view","arguments":{"path":r"C:\Users\John Smith\proj\notes.md"}}}),
        json!({"type":"tool.execution_complete","id":"c2","parentId":"s2","timestamp":"2026-03-10T10:00:04Z","data":{"toolCallId":"call-view","success":true,"result":{"content":"notes"}}}),
        json!({"type":"assistant.message","id":"assistant","parentId":"c2","timestamp":"2026-03-10T10:00:05Z","data":{"content":"Tagged."}}),
    ];
    let events = records
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(dir.path().join("events.jsonl"), events).unwrap();
    dir
}

fn conversation_options(format: ExportFormat) -> ExportOptions {
    let mut options = ExportOptions::all(format);
    options.sections = [SectionId::Conversation].into_iter().collect();
    options
}

fn export_text(dir: &tempfile::TempDir, options: &ExportOptions) -> String {
    let files = export_session(dir.path(), options).unwrap();
    files[0].as_text().unwrap().to_string()
}

fn redact_all() -> RedactionOptions {
    RedactionOptions {
        anonymize_paths: true,
        strip_secrets: true,
        strip_pii: true,
    }
}

#[test]
fn markdown_tool_table_shows_the_argument_summary() {
    let dir = session_with_tool_calls("git tag v2.4.0");
    let markdown = export_text(&dir, &conversation_options(ExportFormat::Markdown));

    assert!(
        markdown.contains("| powershell | ✅ | 1s | git tag v2.4.0 |"),
        "{markdown}"
    );
    assert!(
        markdown.contains(r"| view | ✅ | 1s | C:\Users\John Smith\proj\notes.md |"),
        "{markdown}"
    );
}

#[test]
fn json_export_carries_the_argument_summary() {
    let dir = session_with_tool_calls("git tag v2.4.0");
    let output = export_text(&dir, &conversation_options(ExportFormat::Json));
    let archive: SessionArchive = serde_json::from_str(&output).unwrap();
    let calls = &archive.sessions[0].conversation.as_ref().unwrap()[0].tool_calls;

    assert_eq!(calls[0].args_summary.as_deref(), Some("git tag v2.4.0"));
    assert_eq!(
        calls[1].args_summary.as_deref(),
        Some(r"C:\Users\John Smith\proj\notes.md")
    );
}

#[test]
fn argument_summaries_are_redacted() {
    let command = format!(r"gh auth login --with-token {TOKEN}; cd C:\Users\John Smith\proj");
    let dir = session_with_tool_calls(&command);
    for format in [ExportFormat::Json, ExportFormat::Markdown] {
        let mut options = conversation_options(format);
        options.redaction = redact_all();
        let output = export_text(&dir, &options);
        for leak in ["ghp_", "John", "Smith"] {
            assert!(!output.contains(leak), "{format:?} leaked {leak}: {output}");
        }
        if format == ExportFormat::Markdown {
            assert!(
                output.contains(
                    "| powershell | ✅ | 1s | gh auth login --with-token <REDACTED_TOKEN>; cd <REDACTED_PATH> |"
                ),
                "{output}"
            );
        }
    }
}

/// The summary cuts a long command at 150 characters. Cut through a token, the
/// fragment left is too short for the token pattern, so the summary must come
/// from the already-redacted command.
#[test]
fn a_summary_cut_through_a_secret_leaks_no_fragment() {
    let command = format!("{} {TOKEN} --verbose", "echo x;".repeat(18));
    // The token starts before the cut and ends after it.
    let start = command.find(TOKEN).unwrap();
    assert!(start < 150 && start + TOKEN.len() > 150);
    let dir = session_with_tool_calls(&command);

    let mut options = conversation_options(ExportFormat::Markdown);
    options.content_detail.include_tool_details = false;
    options.redaction.strip_secrets = true;
    let markdown = export_text(&dir, &options);

    assert!(!markdown.contains("ghp_"), "{markdown}");
    assert!(
        markdown.contains("<REDACTED_TOKEN> --verb… |"),
        "{markdown}"
    );
}

/// Dropping tool details drops the raw arguments and results, but keeps the
/// one-line summary, as it keeps the intention summary.
#[test]
fn summaries_survive_dropped_tool_details() {
    let dir = session_with_tool_calls("git tag v2.4.0");
    let mut options = conversation_options(ExportFormat::Json);
    options.content_detail.include_tool_details = false;
    let output = export_text(&dir, &options);
    let archive: SessionArchive = serde_json::from_str(&output).unwrap();
    let shell = &archive.sessions[0].conversation.as_ref().unwrap()[0].tool_calls[0];
    assert!(shell.arguments.is_none());
    assert!(shell.result_content.is_none());
    assert_eq!(shell.args_summary.as_deref(), Some("git tag v2.4.0"));

    options.format = ExportFormat::Markdown;
    let markdown = export_text(&dir, &options);
    assert!(markdown.contains("| git tag v2.4.0 |"), "{markdown}");
    assert!(!markdown.contains("**Arguments:**"), "{markdown}");
}
