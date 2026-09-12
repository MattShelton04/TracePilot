use super::*;

#[test]
fn aggregates_and_ranks_tool_contributions() {
    let (calls, types) = finish_tool_contributions(vec![
        ToolCallDraft {
            turn: 1,
            tool_call_id: Some("a".into()),
            tool_name: "shell".into(),
            argument_tokens: 10,
            result_tokens: 90,
            success: Some(true),
            arguments_preview: None,
            result_preview: None,
        },
        ToolCallDraft {
            turn: 2,
            tool_call_id: Some("b".into()),
            tool_name: "shell".into(),
            argument_tokens: 5,
            result_tokens: 20,
            success: Some(false),
            arguments_preview: None,
            result_preview: None,
        },
        ToolCallDraft {
            turn: 3,
            tool_call_id: Some("c".into()),
            tool_name: "view".into(),
            argument_tokens: 5,
            result_tokens: 45,
            success: Some(true),
            arguments_preview: None,
            result_preview: None,
        },
    ]);

    assert_eq!(calls[0].tool_call_id.as_deref(), Some("a"));
    assert_eq!(types[0].tool_name, "shell");
    assert_eq!(types[0].call_count, 2);
    assert_eq!(types[0].error_count, 1);
    assert_eq!(types[0].total_tokens, 125);
    assert!((types[0].percentage - 71.428).abs() < 0.01);
}

#[test]
fn tool_result_estimate_uses_primary_content_instead_of_the_result_wrapper() {
    let result = serde_json::json!({
        "content": "fn main() {}",
        "detailedContent": "diff --git a/main.rs b/main.rs"
    });

    assert_eq!(context_result_content(&result), "fn main() {}");
}
