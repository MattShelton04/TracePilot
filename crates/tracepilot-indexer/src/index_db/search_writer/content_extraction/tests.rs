use super::builder::SearchContentRowBuilder;
use super::limits::{SKIP_RESULT_ONLY_TOOLS, SKIP_TOOLS};

#[test]
fn test_skip_tools_list() {
    // Verify read_powershell is NOT in skip list (we want async output indexed)
    assert!(!SKIP_TOOLS.contains(&"read_powershell"));
    // These should be skipped
    assert!(SKIP_TOOLS.contains(&"list_agents"));
    assert!(SKIP_TOOLS.contains(&"list_powershell"));
    assert!(SKIP_TOOLS.contains(&"stop_powershell"));
    assert!(SKIP_TOOLS.contains(&"write_powershell"));
    assert!(SKIP_TOOLS.contains(&"read_agent"));
    assert!(SKIP_TOOLS.contains(&"fetch_copilot_cli_documentation"));
}

#[test]
fn test_skip_result_only_tools() {
    assert!(SKIP_RESULT_ONLY_TOOLS.contains(&"store_memory"));
    assert!(SKIP_RESULT_ONLY_TOOLS.contains(&"report_intent"));
    assert!(SKIP_RESULT_ONLY_TOOLS.contains(&"task"));
}

#[test]
fn builder_constructs_row_with_content_only() {
    let builder = SearchContentRowBuilder::new("sess-1", Some(0), 5, Some(123456789));
    let row = builder.with_content("user_message", "Hello".to_string());

    assert_eq!(row.session_id, "sess-1");
    assert_eq!(row.content_type, "user_message");
    assert_eq!(row.turn_number, Some(0));
    assert_eq!(row.event_index, 5);
    assert_eq!(row.timestamp_unix, Some(123456789));
    assert_eq!(row.tool_name, None);
    assert_eq!(row.content, "Hello");
    assert_eq!(row.metadata_json, None);
}

#[test]
fn builder_constructs_row_with_tool_content() {
    let builder = SearchContentRowBuilder::new("sess-2", Some(1), 10, None);
    let row =
        builder.with_tool_content("tool_call", Some("view".to_string()), "file.rs".to_string());

    assert_eq!(row.session_id, "sess-2");
    assert_eq!(row.content_type, "tool_call");
    assert_eq!(row.turn_number, Some(1));
    assert_eq!(row.event_index, 10);
    assert_eq!(row.timestamp_unix, None);
    assert_eq!(row.tool_name, Some("view".to_string()));
    assert_eq!(row.content, "file.rs");
    assert_eq!(row.metadata_json, None);
}

#[test]
fn builder_constructs_row_with_metadata() {
    let builder = SearchContentRowBuilder::new("sess-3", None, 15, Some(987654321));
    let row = builder.with_metadata(
        "compaction_summary",
        "Compacted 50 messages".to_string(),
        Some(r#"{"checkpoint":3}"#.to_string()),
    );

    assert_eq!(row.session_id, "sess-3");
    assert_eq!(row.content_type, "compaction_summary");
    assert_eq!(row.turn_number, None);
    assert_eq!(row.event_index, 15);
    assert_eq!(row.timestamp_unix, Some(987654321));
    assert_eq!(row.tool_name, None);
    assert_eq!(row.content, "Compacted 50 messages");
    assert_eq!(row.metadata_json, Some(r#"{"checkpoint":3}"#.to_string()));
}

#[test]
fn builder_handles_none_optional_fields() {
    let builder = SearchContentRowBuilder::new("sess-4", None, 20, None);
    let row = builder.with_tool_content("tool_error", None, "error message".to_string());

    assert_eq!(row.turn_number, None);
    assert_eq!(row.timestamp_unix, None);
    assert_eq!(row.tool_name, None);
}
