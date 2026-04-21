//! Unit tests for the Markdown renderer. These cover the per-section writers
//! via the public `MarkdownRenderer::render` entry point.

use super::MarkdownRenderer;
use crate::document::*;
use crate::render::ExportRenderer;
use crate::test_helpers::{minimal_session, simple_turn, test_archive};
use tracepilot_core::models::TurnToolCall;

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
    session.conversation = Some(vec![simple_turn(
        0,
        "Hello",
        "Hi there!",
        Some("claude-opus-4.6"),
    )]);

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
    assert!(text.contains("**Dependencies:**"));
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
    // Subagent falls back to tool_name when agent_display_name is absent
    assert!(text.contains("🤖 task"));
}

#[test]
fn renders_subagent_with_rich_metadata() {
    let mut session = minimal_session();
    let mut turn = simple_turn(0, "Explore the codebase", "Done!", None);
    turn.tool_calls = vec![TurnToolCall {
        tool_call_id: Some("tc_1".into()),
        parent_tool_call_id: None,
        tool_name: "task".into(),
        event_index: None,
        arguments: Some(serde_json::json!({"description": "Find all bugs"})),
        success: Some(true),
        error: None,
        started_at: None,
        completed_at: None,
        duration_ms: Some(4500),
        mcp_server_name: None,
        mcp_tool_name: None,
        is_complete: true,
        is_subagent: true,
        agent_display_name: Some("Explore Agent".into()),
        agent_description: Some("Fast agent for codebase exploration".into()),
        model: Some("claude-haiku-4.5".into()),
        requested_model: None,
        intention_summary: Some("Find all TODO markers".into()),
        total_tokens: Some(1240),
        total_tool_calls: Some(8),
        result_content: Some("Found 3 TODOs".into()),
        args_summary: None,
    }];
    session.conversation = Some(vec![turn]);

    let archive = test_archive(session);
    let files = MarkdownRenderer.render(&archive).unwrap();
    let text = files[0].as_text().unwrap();

    // Summary table: uses agent_display_name + enriched summary
    assert!(text.contains("🤖 Explore Agent"));
    assert!(text.contains("Find all TODO markers"));
    assert!(text.contains("claude-haiku-4.5"));
    assert!(text.contains("1240 tok"));
    assert!(text.contains("8 calls"));

    // Detail block: richer heading + stats
    assert!(text.contains("#### 🤖 Explore Agent"));
    assert!(text.contains("1240 tokens"));
    assert!(text.contains("8 tool calls"));
    assert!(text.contains("Fast agent for codebase exploration"));
    assert!(text.contains("Found 3 TODOs"));
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

#[test]
fn renders_rewind_snapshots() {
    use tracepilot_core::parsing::rewind_snapshots::{RewindIndex, RewindSnapshot};

    let mut session = minimal_session();
    session.rewind_snapshots = Some(RewindIndex {
        version: 1,
        snapshots: vec![RewindSnapshot {
            snapshot_id: "snap0001".to_string(),
            event_id: None,
            user_message: Some("Fix the bug".to_string()),
            timestamp: Some("2025-01-01T00:00:00Z".to_string()),
            file_count: Some(3),
            git_commit: None,
            git_branch: Some("main".to_string()),
        }],
    });

    let archive = test_archive(session);
    let renderer = MarkdownRenderer;
    let files = renderer.render(&archive).unwrap();

    let text = files[0].as_text().unwrap();
    assert!(text.contains("## Rewind Snapshots"));
    assert!(text.contains("snap0001"));
}

#[test]
fn renders_custom_tables() {
    use std::collections::HashMap;

    let mut session = minimal_session();
    session.custom_tables = Some(vec![CustomTableExport {
        name: "my_data".to_string(),
        columns: vec!["key".to_string(), "value".to_string()],
        rows: vec![HashMap::from([
            ("key".to_string(), serde_json::Value::String("foo".to_string())),
            ("value".to_string(), serde_json::Value::String("bar".to_string())),
        ])],
    }]);

    let archive = test_archive(session);
    let renderer = MarkdownRenderer;
    let files = renderer.render(&archive).unwrap();

    let text = files[0].as_text().unwrap();
    assert!(text.contains("## Custom Tables"));
    assert!(text.contains("my_data"));
    assert!(text.contains("foo"));
    assert!(text.contains("bar"));
}

#[test]
fn renders_todos_with_dep_list() {
    let mut session = minimal_session();
    session.todos = Some(TodoExport {
        items: vec![
            TodoItemExport {
                id: "setup".to_string(),
                title: "Project setup".to_string(),
                description: None,
                status: "done".to_string(),
                created_at: None,
                updated_at: None,
            },
            TodoItemExport {
                id: "impl".to_string(),
                title: "Implementation".to_string(),
                description: None,
                status: "in_progress".to_string(),
                created_at: None,
                updated_at: None,
            },
        ],
        deps: vec![
            TodoDepExport { todo_id: "impl".to_string(), depends_on: "setup".to_string() },
        ],
    });

    let archive = test_archive(session);
    let files = MarkdownRenderer.render(&archive).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("**Dependencies:**"));
    assert!(text.contains("impl → setup"));
}
