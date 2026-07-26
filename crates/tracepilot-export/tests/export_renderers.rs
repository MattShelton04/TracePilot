//! Markdown export renderer integration tests.

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
