// Fixtures and diagnostic executables fail fast on invalid setup.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::print_stdout,
    clippy::print_stderr
)]
//! Markdown export renderer integration tests.

use std::fs;

use tracepilot_export::options::*;
use tracepilot_export::*;
use tracepilot_test_support::fixtures::full_session_temp_dir;

#[test]
fn export_markdown_full_session() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();

    assert_eq!(files.len(), 1);
    assert!(files[0].filename.ends_with(".md"));

    let text = files[0].as_text().unwrap();
    assert!(text.contains("# Session:"));
    assert!(text.contains("## Metadata"));
    assert!(text.contains("test-session-id"));
    assert!(text.contains("[TracePilot v"));
    assert!(text.contains("https://github.com/MattShelton04/TracePilot"));
    assert!(text.contains("Get [TracePilot](https://github.com/MattShelton04/TracePilot)"));
}

#[test]
fn export_markdown_includes_conversation() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("## Conversation"));
    assert!(text.contains("Hello world"));
    assert!(text.contains("### Turn 1"));
}

#[test]
fn export_markdown_includes_plan() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("## Plan"));
    assert!(text.contains("Build core"));
}

#[test]
fn export_markdown_includes_tool_calls() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("**Tool Calls**"));
    assert!(text.contains("read_file"));
}

#[test]
fn export_markdown_includes_metrics() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("## Metrics"));
    assert!(text.contains("claude-opus-4.6"));
    assert!(text.contains("| AI Credits | 2.500 (observed) |"));
}

#[test]
fn export_markdown_includes_checkpoints() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("## Checkpoints"));
    assert!(text.contains("Initial setup"));
}

#[test]
fn export_markdown_preview() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Markdown);
    let preview = preview_export(dir.path(), &options, Some(200)).unwrap();

    assert!(preview.len() <= 200);
    assert!(preview.starts_with("# Session:"));
}

fn session_with_long_tool_result() -> (tempfile::TempDir, String) {
    let (dir, _) = full_session_temp_dir();
    let result = format!("{}\nTOOL_RESULT_END", "résultat ".repeat(512));
    let events_path = dir.path().join("events.jsonl");
    let events = fs::read_to_string(&events_path).unwrap();
    let updated: Vec<String> = events
        .lines()
        .map(|line| {
            let mut event: serde_json::Value = serde_json::from_str(line).unwrap();
            if event["type"] == "tool.execution_complete" {
                event["data"]["result"] = serde_json::json!(result);
            }
            event.to_string()
        })
        .collect();
    fs::write(events_path, updated.join("\n")).unwrap();
    (dir, result)
}

#[test]
fn export_markdown_respects_full_tool_results() {
    let (dir, result) = session_with_long_tool_result();

    for include_full in [true, false] {
        let mut options = ExportOptions::all(ExportFormat::Json);
        options.sections = [SectionId::Conversation].into_iter().collect();
        options.content_detail.include_full_tool_results = include_full;
        let files = export_session(dir.path(), &options).unwrap();
        let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
        let tool = &archive.sessions[0].conversation.as_ref().unwrap()[0].tool_calls[0];
        let exported_result = tool.result_content.as_deref().unwrap();

        if include_full {
            assert_eq!(exported_result, result);
        } else {
            assert!(result.starts_with(exported_result.trim_end_matches("…[truncated]")));
            assert!(exported_result.ends_with("…[truncated]"));
            assert!(!exported_result.contains("TOOL_RESULT_END"));
        }

        options.format = ExportFormat::Markdown;
        let files = export_session(dir.path(), &options).unwrap();
        let markdown = files[0].as_text().unwrap();
        assert!(
            markdown.contains(&format!("**Result:**\n\n```\n{exported_result}\n```")),
            "Markdown should preserve the same tool result as JSON (include_full={include_full})"
        );
        assert_eq!(markdown.contains("TOOL_RESULT_END"), include_full);
    }
}

#[test]
fn export_markdown_omits_tool_details_even_with_full_results_enabled() {
    let (dir, _) = session_with_long_tool_result();
    let mut options = ExportOptions::all(ExportFormat::Json);
    options.sections = [SectionId::Conversation].into_iter().collect();
    options.content_detail.include_full_tool_results = true;
    options.content_detail.include_tool_details = false;
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let tool = &archive.sessions[0].conversation.as_ref().unwrap()[0].tool_calls[0];
    assert!(tool.arguments.is_none());
    assert!(tool.result_content.is_none());

    options.format = ExportFormat::Markdown;
    let files = export_session(dir.path(), &options).unwrap();
    let markdown = files[0].as_text().unwrap();
    assert!(markdown.contains("| read_file |"));
    assert!(!markdown.contains("**Arguments:**"));
    assert!(!markdown.contains("**Result:**"));
    assert!(!markdown.contains("TOOL_RESULT_END"));
}
