//! Shared test helpers for constructing `SessionArchive` fixtures.
//!
//! These builders produce valid-but-minimal instances of the document types.
//! They spare each test module from spelling out every field of types like
//! `ConversationTurn` and `TurnToolCall` (which have 15+ fields each).

use chrono::Utc;

use crate::document::*;
use crate::schema;

/// Build a `SessionArchive` wrapping a single session.
pub fn test_archive(session: PortableSession) -> SessionArchive {
    test_archive_with_format(session, "test")
}

/// Build a `SessionArchive` with a specific format label.
pub fn test_archive_with_format(session: PortableSession, format: &str) -> SessionArchive {
    SessionArchive {
        header: ArchiveHeader {
            schema_version: schema::CURRENT_VERSION,
            exported_at: Utc::now(),
            exported_by: "TracePilot test".to_string(),
            source_system: None,
            content_hash: None,
            minimum_reader_version: None,
        },
        sessions: vec![session],
        export_options: ArchiveOptionsRecord {
            format: format.to_string(),
            included_sections: vec![],
            redaction_applied: false,
        },
    }
}

/// Build a minimal session with only metadata.
pub fn minimal_session() -> PortableSession {
    PortableSession {
        metadata: PortableSessionMetadata {
            id: "test-12345678".to_string(),
            summary: Some("Test session".to_string()),
            repository: Some("user/repo".to_string()),
            branch: Some("main".to_string()),
            cwd: Some("/test/project".to_string()),
            git_root: None,
            host_type: Some("cli".to_string()),
            created_at: None,
            updated_at: None,
            event_count: Some(10),
            turn_count: Some(3),
            summary_count: None,
            lineage: None,
        },
        available_sections: vec![],
        conversation: None,
        events: None,
        todos: None,
        plan: None,
        checkpoints: None,
        rewind_snapshots: None,
        shutdown_metrics: None,
        incidents: None,
        health: None,
        custom_tables: None,
        parse_diagnostics: None,
        extensions: None,
    }
}

/// Build a simple conversation turn.
pub fn simple_turn(
    index: usize,
    user_msg: &str,
    assistant_msg: &str,
    model: Option<&str>,
) -> ConversationTurn {
    ConversationTurn {
        turn_index: index,
        event_index: None,
        turn_id: None,
        interaction_id: None,
        user_message: Some(user_msg.to_string()),
        assistant_messages: vec![AttributedMessage {
            content: assistant_msg.to_string(),
            parent_tool_call_id: None,
            agent_display_name: None,
        }],
        model: model.map(|m| m.to_string()),
        timestamp: None,
        end_timestamp: None,
        tool_calls: vec![],
        duration_ms: Some(1500),
        is_complete: true,
        reasoning_texts: vec![],
        output_tokens: Some(50),
        transformed_user_message: None,
        attachments: None,
        session_events: vec![],
    }
}

/// Build a simple tool call.
pub fn simple_tool_call(name: &str, success: Option<bool>, is_subagent: bool) -> TurnToolCall {
    TurnToolCall {
        tool_call_id: None,
        parent_tool_call_id: None,
        tool_name: name.to_string(),
        event_index: None,
        arguments: None,
        success,
        error: None,
        started_at: None,
        completed_at: None,
        duration_ms: Some(200),
        mcp_server_name: None,
        mcp_tool_name: None,
        is_complete: true,
        is_subagent,
        agent_display_name: None,
        agent_description: None,
        model: None,
        intention_summary: Some(format!("Run {}", name)),
        total_tokens: None,
        total_tool_calls: None,
        result_content: None,
        args_summary: Some("test args".to_string()),
    }
}
