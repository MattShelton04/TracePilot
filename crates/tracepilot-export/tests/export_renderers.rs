//! Markdown and CSV export renderer integration tests.

use tracepilot_export::options::*;
use tracepilot_export::*;
use tracepilot_test_support::fixtures::{
    full_session_temp_dir, minimal_workspace_yaml, workspace_only_temp_dir,
};

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

#[test]
fn export_csv_produces_multiple_files() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    assert!(
        files.len() >= 3,
        "CSV should produce multiple files, got {}",
        files.len()
    );

    let filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();
    assert!(filenames.iter().any(|f| f.contains("summary")));
    assert!(filenames.iter().any(|f| f.contains("conversation")));
    assert!(filenames.iter().any(|f| f.contains("events")));
}

#[test]
fn export_csv_summary_has_session_data() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let summary = files
        .iter()
        .find(|f| f.filename.contains("summary"))
        .unwrap();
    let text = summary.as_text().unwrap();
    assert!(text.contains("test-session-id"));
    assert!(text.contains("user/repo"));
}

#[test]
fn export_csv_conversation_has_turns() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let conv = files
        .iter()
        .find(|f| f.filename.contains("conversation"))
        .unwrap();
    let text = conv.as_text().unwrap();
    assert!(text.contains("turn,model,user_message"));
    assert!(text.contains("Hello world"));
}

#[test]
fn export_csv_tools_has_entries() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let tools = files.iter().find(|f| f.filename.contains("tools"));
    assert!(tools.is_some(), "should have tools CSV");
    let text = tools.unwrap().as_text().unwrap();
    assert!(text.contains("read_file"));
}

#[test]
fn export_csv_events_has_all_event_types() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let events = files
        .iter()
        .find(|f| f.filename.contains("events"))
        .unwrap();
    let text = events.as_text().unwrap();
    assert!(text.contains("session.start"));
    assert!(text.contains("session.shutdown"));
}

#[test]
fn export_csv_model_metrics() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let metrics = files.iter().find(|f| f.filename.contains("model-metrics"));
    assert!(metrics.is_some(), "should have model-metrics CSV");
    let text = metrics.unwrap().as_text().unwrap();
    assert!(text.contains("claude-opus-4.6"));
}

#[test]
fn export_csv_minimal_session() {
    let (dir, _) = workspace_only_temp_dir(minimal_workspace_yaml());

    let options = ExportOptions::minimal(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    assert_eq!(files.len(), 1);
    assert!(files[0].filename.contains("summary"));
}
