// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Claude Code tool calls never carry an intention summary, so the Markdown
//! tool table shows the argument summary the app's turn view shows, never "—".

use serde_json::{Value, json};
use tracepilot_core::SessionId;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{SessionProvider, SessionSource};
use tracepilot_export::document::SectionId;
use tracepilot_export::options::{ExportFormat, ExportOptions};
use tracepilot_export::{ExportInput, ProviderSession, export_inputs};
use tracepilot_test_support::claude::{
    OPUS, SESSION_ID, SessionFiles, Transcript, Usage, text, tool_use, write_session,
};

const TOKEN: &str = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB";

/// `(tool_use id, native name, input, toolUseResult)`; every call succeeds.
type Call = (&'static str, &'static str, Value, Value);

fn calls() -> Vec<Call> {
    let todos = json!([
        {"content": "Read", "status": "completed", "activeForm": "Reading"},
        {"content": "Fix", "status": "in_progress", "activeForm": "Fixing"},
        {"content": "Ship", "status": "pending", "activeForm": "Shipping"},
    ]);
    let hunk = json!([{"oldStart": 3, "oldLines": 1, "newStart": 3, "newLines": 1,
        "lines": ["-a", "+b"]}]);
    let question = json!({"question": "Which viewport?", "header": "Viewport",
        "multiSelect": false, "options": [{"label": "Desktop", "description": "1440"}]});
    vec![
        (
            "toolu_todo",
            "TodoWrite",
            json!({"todos": todos}),
            json!({"oldTodos": [], "newTodos": todos}),
        ),
        (
            "toolu_skill",
            "Skill",
            json!({"skill": "synthetic-review"}),
            json!({"success": true, "commandName": "synthetic-review"}),
        ),
        (
            "toolu_multi",
            "MultiEdit",
            json!({"file_path": "src/a.rs", "edits": [{"old_string": "a", "new_string": "b"}]}),
            json!({"filePath": "src/a.rs", "edits": [{"old_string": "a", "new_string": "b"}],
                "structuredPatch": hunk, "userModified": false}),
        ),
        (
            "toolu_ask",
            "AskUserQuestion",
            json!({"questions": [question.clone()]}),
            json!({"questions": [question], "answers": {"Which viewport?": "Desktop"}}),
        ),
        (
            "toolu_plan",
            "ExitPlanMode",
            json!({"plan": "Context first.\n\n## Retry the upload\n\n1. Wrap the call"}),
            json!({"plan": "## Retry the upload", "isAgent": false}),
        ),
        (
            "toolu_stop",
            "TaskStop",
            json!({"task_id": "a77"}),
            json!({"message": "Stopped a77", "task_id": "a77", "task_type": "local_agent"}),
        ),
        (
            "toolu_mcp",
            "mcp__docs__search_pages",
            json!({"query": format!("deploy key {TOKEN}"), "api_key": "PRIVATE-mcp-key"}),
            json!([{"type": "text", "text": "2 pages"}]),
        ),
    ]
}

fn session() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Plan, edit and track the work.");
    let calls = calls();
    let blocks = calls
        .iter()
        .map(|(id, name, input, _)| tool_use(id, name, input.clone()))
        .collect();
    t.call(
        "msg_tools",
        OPUS,
        blocks,
        Usage::new(1, 10, 0, 5),
        "tool_use",
    );
    for (id, _, _, tur) in calls {
        t.tool_result(id, json!("ok"), tur, false);
    }
    t.call(
        "msg_done",
        OPUS,
        vec![text("Done.")],
        Usage::new(1, 10, 0, 5),
        "end_turn",
    );
    write_session(&t, &[])
}

fn export_markdown(files: &SessionFiles, options: &ExportOptions) -> String {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .unwrap();
    let snapshot = provider.load_snapshot(&locator, false, &|| false).unwrap();
    let artifacts = provider.artifacts(&locator).unwrap();
    let input = ExportInput::Provider(ProviderSession {
        source: SessionSource::ClaudeCode,
        snapshot: &snapshot,
        artifacts: &artifacts,
    });
    let files = export_inputs(&[input], options).unwrap();
    files[0].as_text().unwrap().to_string()
}

fn conversation_options() -> ExportOptions {
    let mut options = ExportOptions::all(ExportFormat::Markdown);
    options.sections = [SectionId::Conversation].into_iter().collect();
    options
}

/// The summary cell of the tool table row named `tool`.
fn summary_cell<'a>(markdown: &'a str, tool: &str) -> &'a str {
    let row = markdown
        .lines()
        .find(|line| line.starts_with(&format!("| {tool} | ")))
        .unwrap_or_else(|| panic!("no {tool} row: {markdown}"));
    row.trim_end_matches(" |").rsplit(" | ").next().unwrap()
}

#[test]
fn claude_tool_rows_show_their_argument_summary() {
    let markdown = export_markdown(&session(), &conversation_options());

    for (tool, summary) in [
        ("TodoWrite", "3 steps · 1 done · 1 in progress"),
        ("Skill", "synthetic-review"),
        ("MultiEdit", "src/a.rs"),
        ("AskUserQuestion", "Which viewport?"),
        ("ExitPlanMode", "Retry the upload"),
        ("TaskStop", "a77"),
        (
            "mcp__docs__search_pages",
            &format!("deploy key {TOKEN}") as &str,
        ),
    ] {
        assert_eq!(summary_cell(&markdown, tool), summary, "{tool}: {markdown}");
    }
    // Only descriptive MCP arguments reach a summary.
    let table_rows: Vec<&str> = markdown.lines().filter(|l| l.starts_with("| ")).collect();
    assert!(
        table_rows
            .iter()
            .all(|row| !row.contains("PRIVATE-mcp-key")),
        "{markdown}"
    );
}

#[test]
fn redaction_covers_the_new_summaries() {
    let mut options = conversation_options();
    options.redaction.strip_secrets = true;
    let markdown = export_markdown(&session(), &options);

    assert_eq!(
        summary_cell(&markdown, "mcp__docs__search_pages"),
        "deploy key <REDACTED_TOKEN>"
    );
    assert!(!markdown.contains("ghp_"), "{markdown}");
}
