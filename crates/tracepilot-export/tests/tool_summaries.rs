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
    session_with_calls(&[
        ("powershell", json!({"command": command})),
        (
            "view",
            json!({"path": r"C:\Users\John Smith\proj\notes.md"}),
        ),
    ])
}

/// One turn with these `(tool name, arguments)` calls, each taking a second
/// and none carrying an intention.
fn session_with_calls(calls: &[(&str, serde_json::Value)]) -> tempfile::TempDir {
    let (dir, _) = workspace_only_temp_dir(full_workspace_yaml());
    let at = |second: usize| format!("2026-03-10T10:00:{second:02}Z");
    let mut records = vec![
        json!({"type":"user.message","id":"user","timestamp":at(0),"data":{"content":"Tag the release"}}),
    ];
    let mut parent = "user".to_string();
    for (index, (tool, args)) in calls.iter().enumerate() {
        let (start, done, id) = (
            format!("s{index}"),
            format!("c{index}"),
            format!("call-{index}"),
        );
        records.push(json!({"type":"tool.execution_start","id":start,"parentId":parent,"timestamp":at(2 * index + 1),"data":{"toolCallId":id,"toolName":tool,"arguments":args}}));
        records.push(json!({"type":"tool.execution_complete","id":done,"parentId":start,"timestamp":at(2 * index + 2),"data":{"toolCallId":id,"success":true,"result":{"content":"done"}}}));
        parent = done;
    }
    records.push(json!({"type":"assistant.message","id":"assistant","parentId":parent,"timestamp":at(59),"data":{"content":"Tagged."}}));
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
    options.redaction.strip_secrets = true;
    let markdown = export_text(&dir, &options);

    assert!(!markdown.contains("ghp_"), "{markdown}");
    assert!(
        markdown.contains("<REDACTED_TOKEN> --verb… |"),
        "{markdown}"
    );
}

/// Dropping tool details drops the raw arguments and results, and the one-line
/// summary cut from the arguments with them.
#[test]
fn dropped_tool_details_drop_the_argument_summary() {
    let dir = session_with_tool_calls("git tag v2.4.0");
    let mut options = conversation_options(ExportFormat::Json);
    options.content_detail.include_tool_details = false;
    let output = export_text(&dir, &options);
    let archive: SessionArchive = serde_json::from_str(&output).unwrap();
    let shell = &archive.sessions[0].conversation.as_ref().unwrap()[0].tool_calls[0];
    assert!(shell.arguments.is_none());
    assert!(shell.result_content.is_none());
    assert!(shell.args_summary.is_none());

    options.format = ExportFormat::Markdown;
    let markdown = export_text(&dir, &options);
    assert!(markdown.contains("| powershell |"), "{markdown}");
    assert!(!markdown.contains("git tag"), "{markdown}");
    assert!(!markdown.contains("**Arguments:**"), "{markdown}");
}

/// Copilot `store_memory`, `bash` and `apply_patch` (a raw patch string) rows
/// show a summary, cut from redacted arguments when redaction is on.
#[test]
fn new_summaries_are_shown_and_redacted() {
    let patch = "*** Begin Patch\n*** Update File: C:\\Users\\John Smith\\proj\\a.rs\n@@\n-a\n+b\n*** End Patch";
    let dir = session_with_calls(&[
        (
            "store_memory",
            json!({"fact": format!("The deploy token is {TOKEN}.")}),
        ),
        ("bash", json!({"command": "cargo test -p core"})),
        ("apply_patch", json!(patch)),
    ]);
    let plain = export_text(&dir, &conversation_options(ExportFormat::Markdown));
    for row in [
        format!("| store_memory | ✅ | 1s | The deploy token is {TOKEN}. |"),
        "| bash | ✅ | 1s | cargo test -p core |".to_string(),
        r"| apply_patch | ✅ | 1s | C:\Users\John Smith\proj\a.rs |".to_string(),
    ] {
        assert!(plain.contains(&row), "{row}: {plain}");
    }

    let mut options = conversation_options(ExportFormat::Markdown);
    options.redaction = redact_all();
    let markdown = export_text(&dir, &options);
    for leak in ["ghp_", "John", "Smith"] {
        assert!(!markdown.contains(leak), "leaked {leak}: {markdown}");
    }
    for row in [
        "| store_memory | ✅ | 1s | The deploy token is <REDACTED_TOKEN>. |",
        "| apply_patch | ✅ | 1s | <REDACTED_PATH> |",
    ] {
        assert!(markdown.contains(row), "{row}: {markdown}");
    }
}
