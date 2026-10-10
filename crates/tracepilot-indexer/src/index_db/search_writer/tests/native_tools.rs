use super::super::extract_search_content;
use super::helpers::*;
use tracepilot_core::parsing::events::TypedEventData;

#[test]
fn tool_rows_carry_the_native_tool_name_as_metadata() {
    let mut start = tool_exec_start("shell", "c1");
    if let TypedEventData::ToolExecutionStart(data) = &mut start.typed_data {
        data.native_tool_name = Some("Bash".into());
    }
    let events = vec![
        user_message("run it"),
        assistant_turn_start(),
        start,
        tool_exec_complete("c1", "PASS"),
        tool_exec_start("view", "c2"),
        tool_exec_complete("c2", "fn main() {}"),
    ];

    let rows = extract_search_content(&sid(), &events);
    let tool_rows: Vec<_> = rows
        .iter()
        .filter(|row| row.tool_name.is_some())
        .map(|row| {
            (
                row.content_type,
                row.tool_name.as_deref().unwrap(),
                row.metadata_json.as_deref(),
            )
        })
        .collect();
    let bash = Some(r#"{"nativeToolName":"Bash"}"#);
    assert_eq!(
        tool_rows,
        [
            ("tool_call", "shell", bash),
            ("tool_result", "shell", bash),
            // Copilot-style calls with no native name keep no metadata.
            ("tool_call", "view", None),
            ("tool_result", "view", None),
        ]
    );
}
