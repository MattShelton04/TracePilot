use crate::document::{CheckpointExport, CustomTableExport};
use crate::options::RedactionOptions;
use crate::redaction::apply_redaction;
use crate::test_helpers::{minimal_session, test_archive};
use tracepilot_core::models::conversation::{AttributedMessage, ConversationTurn, TurnToolCall};

fn test_options_all() -> RedactionOptions {
    RedactionOptions {
        anonymize_paths: true,
        strip_secrets: true,
        strip_pii: true,
    }
}

fn test_options_paths_only() -> RedactionOptions {
    RedactionOptions {
        anonymize_paths: true,
        strip_secrets: false,
        strip_pii: false,
    }
}

#[test]
fn noop_when_disabled() {
    let mut session = minimal_session();
    session.metadata.cwd = Some(r"C:\Users\alice\project".into());
    let mut archive = test_archive(session);

    let stats = apply_redaction(&mut archive, &RedactionOptions::default());
    assert_eq!(stats.fields_redacted, 0);
    assert!(
        archive.sessions[0]
            .metadata
            .cwd
            .as_ref()
            .unwrap()
            .contains("alice")
    );
    assert!(!archive.export_options.redaction_applied);
}

#[test]
fn redacts_metadata_paths() {
    let mut session = minimal_session();
    session.metadata.cwd = Some(r"C:\Users\alice\project".into());
    session.metadata.git_root = Some("/home/alice/repos/project".into());
    let mut archive = test_archive(session);

    let stats = apply_redaction(&mut archive, &test_options_paths_only());
    assert!(stats.fields_redacted >= 2);
    assert!(
        !archive.sessions[0]
            .metadata
            .cwd
            .as_ref()
            .unwrap()
            .contains("alice")
    );
    assert!(
        !archive.sessions[0]
            .metadata
            .git_root
            .as_ref()
            .unwrap()
            .contains("alice")
    );
    assert!(archive.export_options.redaction_applied);
}

#[test]
fn redacts_conversation_content() {
    let mut session = minimal_session();
    session.conversation = Some(vec![ConversationTurn {
        turn_index: 0,
        event_index: None,
        turn_id: None,
        interaction_id: None,
        user_message: Some("Read /home/user/secret.txt".into()),
        assistant_messages: vec![AttributedMessage {
            content: "Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij".into(),
            parent_tool_call_id: None,
            agent_display_name: None,
            event_index: None,
        }],
        model: None,
        timestamp: None,
        end_timestamp: None,
        tool_calls: vec![TurnToolCall {
            tool_call_id: Some("tc-1".into()),
            parent_tool_call_id: None,
            tool_name: "read_file".into(),
            event_index: None,
            arguments: Some(serde_json::json!({"path": "/home/user/secret.txt"})),
            success: Some(true),
            error: None,
            started_at: None,
            completed_at: None,
            duration_ms: None,
            mcp_server_name: None,
            mcp_tool_name: None,
            is_complete: true,
            is_subagent: false,
            agent_display_name: None,
            agent_description: None,
            model: None,
            requested_model: None,
            intention_summary: None,
            total_tokens: None,
            total_tool_calls: None,
            result_content: Some("email: admin@company.com".into()),
            args_summary: None,
            skill_invocation: None,
        }],
        duration_ms: None,
        is_complete: true,
        reasoning_texts: vec![],
        output_tokens: None,
        transformed_user_message: None,
        attachments: None,
        session_events: vec![],
        system_messages: vec![],
    }]);
    let mut archive = test_archive(session);

    let stats = apply_redaction(&mut archive, &test_options_all());
    let conv = archive.sessions[0].conversation.as_ref().unwrap();
    let turn = &conv[0];

    // Path in user message
    assert!(!turn.user_message.as_ref().unwrap().contains("/home/user"));
    // Token in assistant message
    assert!(!turn.assistant_messages[0].content.contains("ghp_"));
    // Path in tool arguments
    let args = turn.tool_calls[0].arguments.as_ref().unwrap();
    assert!(!args.to_string().contains("/home/user"));
    // Email in result content
    assert!(
        !turn.tool_calls[0]
            .result_content
            .as_ref()
            .unwrap()
            .contains("admin@")
    );

    assert!(stats.fields_redacted > 0);
}

#[test]
fn redacts_plan_content() {
    let mut session = minimal_session();
    session.plan = Some("Deploy to 192.168.1.100 using API_KEY=abc123".into());
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_all());

    let plan = archive.sessions[0].plan.as_ref().unwrap();
    assert!(!plan.contains("192.168.1.100"));
}

#[test]
fn redacts_todo_content() {
    let mut session = minimal_session();
    session.todos = Some(crate::document::TodoExport {
        items: vec![crate::document::TodoItemExport {
            id: "t1".into(),
            title: "Fix /home/user/bug.rs".into(),
            description: Some("Password: hunter2secret".into()),
            status: "pending".into(),
            created_at: None,
            updated_at: None,
        }],
        deps: vec![],
    });
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_all());

    let todo = &archive.sessions[0].todos.as_ref().unwrap().items[0];
    assert!(!todo.title.contains("/home/user"));
    assert!(!todo.description.as_ref().unwrap().contains("hunter2secret"));
}

#[test]
fn has_any_detects_flags() {
    assert!(!RedactionOptions::default().has_any());
    assert!(test_options_all().has_any());
    assert!(test_options_paths_only().has_any());
}

#[test]
fn redaction_stats_populated() {
    let mut session = minimal_session();
    session.metadata.cwd = Some(r"C:\Users\alice\project".into());
    session.plan = Some("Contact admin@test.com at 10.0.0.1".into());
    let mut archive = test_archive(session);

    let stats = apply_redaction(&mut archive, &test_options_all());
    assert!(stats.fields_redacted >= 2);
    // total_replacements should be >= fields_redacted (plan has 2 matches)
    assert!(stats.total_replacements >= stats.fields_redacted);
}

#[test]
fn redacts_attachments() {
    let mut session = minimal_session();
    session.conversation = Some(vec![ConversationTurn {
        turn_index: 0,
        event_index: None,
        turn_id: None,
        interaction_id: None,
        user_message: None,
        assistant_messages: vec![],
        model: None,
        timestamp: None,
        end_timestamp: None,
        tool_calls: vec![],
        duration_ms: None,
        is_complete: true,
        reasoning_texts: vec![],
        output_tokens: None,
        transformed_user_message: None,
        attachments: Some(vec![serde_json::json!({
            "type": "file",
            "path": "/home/alice/secrets.txt",
            "content": "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"
        })]),
        session_events: vec![],
        system_messages: vec![],
    }]);
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_all());

    let att = &archive.sessions[0].conversation.as_ref().unwrap()[0]
        .attachments
        .as_ref()
        .unwrap()[0];
    let att_str = att.to_string();
    assert!(
        !att_str.contains("/home/alice"),
        "Path should be redacted in attachment"
    );
    assert!(
        !att_str.contains("ghp_"),
        "Token should be redacted in attachment"
    );
}

#[test]
fn redacts_rewind_snapshots() {
    let mut session = minimal_session();
    session.rewind_snapshots = Some(tracepilot_core::parsing::rewind_snapshots::RewindIndex {
        version: 1,
        snapshots: vec![tracepilot_core::parsing::rewind_snapshots::RewindSnapshot {
            snapshot_id: "snap-1".into(),
            event_id: None,
            user_message: Some("Edit /home/bob/code.rs".into()),
            timestamp: None,
            file_count: None,
            git_commit: None,
            git_branch: Some("feature/bob-secret".into()),
        }],
    });
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_paths_only());

    let snap = &archive.sessions[0]
        .rewind_snapshots
        .as_ref()
        .unwrap()
        .snapshots[0];
    assert!(
        !snap.user_message.as_ref().unwrap().contains("/home/bob"),
        "Rewind snapshot user_message should be redacted"
    );
}

#[test]
fn redacts_checkpoint_title_and_filename() {
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "Saved /home/alice/project state".into(),
        filename: "/home/alice/project/checkpoint.md".into(),
        content: Some("Token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij".into()),
    }]);
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_all());

    let cp = &archive.sessions[0].checkpoints.as_ref().unwrap()[0];
    assert!(
        !cp.title.contains("/home/alice"),
        "Checkpoint title should be redacted"
    );
    assert!(
        !cp.filename.contains("/home/alice"),
        "Checkpoint filename should be redacted"
    );
    assert!(
        !cp.content.as_ref().unwrap().contains("ghp_"),
        "Checkpoint content should be redacted"
    );
}

#[test]
fn redacts_extensions_json() {
    let mut session = minimal_session();
    session.extensions = Some(serde_json::json!({
        "custom_field": "deploy to 10.0.0.1",
        "nested": {
            "email": "admin@corp.com"
        }
    }));
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_all());

    let ext = archive.sessions[0].extensions.as_ref().unwrap();
    let ext_str = ext.to_string();
    assert!(
        !ext_str.contains("10.0.0.1"),
        "Extension IP should be redacted"
    );
    assert!(
        !ext_str.contains("admin@corp.com"),
        "Extension email should be redacted"
    );
}

#[test]
fn redacts_custom_table_name_and_columns() {
    let mut session = minimal_session();
    session.custom_tables = Some(vec![CustomTableExport {
        name: "/home/alice/data".into(),
        columns: vec!["path".into(), "/home/alice/col".into()],
        rows: vec![{
            let mut row = std::collections::HashMap::new();
            row.insert("path".into(), serde_json::json!("/home/alice/file.txt"));
            row
        }],
    }]);
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_paths_only());

    let table = &archive.sessions[0].custom_tables.as_ref().unwrap()[0];
    assert!(
        !table.name.contains("/home/alice"),
        "Custom table name should be redacted"
    );
    assert!(
        !table.columns[1].contains("/home/alice"),
        "Custom table column should be redacted"
    );
}

#[test]
fn total_replacements_counts_all_matches() {
    let mut session = minimal_session();
    session.plan = Some("Contact a@test.com and b@test.com and c@test.com".into());
    let mut archive = test_archive(session);

    let stats = apply_redaction(&mut archive, &test_options_all());
    // 3 email matches in one field = fields_redacted=1, total_replacements=3
    assert_eq!(stats.fields_redacted, 1);
    assert_eq!(stats.total_replacements, 3);
}

#[test]
fn env_var_assign_handles_quoted_values() {
    let mut session = minimal_session();
    session.plan = Some(r#"export PASSWORD="my secret pass""#.into());
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_all());

    let plan = archive.sessions[0].plan.as_ref().unwrap();
    assert!(
        !plan.contains("my secret pass"),
        "Quoted env var value should be fully redacted, got: {}",
        plan
    );
}
