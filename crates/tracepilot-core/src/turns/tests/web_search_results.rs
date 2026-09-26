//! Web search results must remain complete for JSON decoding in rich renderers.

use super::*;

#[test]
fn preserves_complete_web_search_envelopes_in_ipc_turns() {
    let body = format!(
        "{}\n\n[Final source](https://example.com/final)",
        "Search evidence with Unicode: café. ".repeat(200)
    );
    let envelope = json!({ "text": { "value": body } }).to_string();
    assert!(envelope.len() > 1024);

    for result in [
        json!(envelope),
        json!({ "content": envelope }),
        json!({ "content": "", "detailedContent": envelope }),
    ] {
        let events = vec![
            user_msg("Search for references").build_event(),
            tool_start("web_search")
                .tool_call_id("search-1")
                .arguments(json!({ "query": "synthetic reference" }))
                .build_event(),
            tool_complete("search-1")
                .success(true)
                .result(result)
                .build_event(),
        ];
        let mut turns = reconstruct_turns(&events);
        prepare_turns_for_ipc(&mut turns);
        let ipc = serde_json::to_value(&turns).unwrap();
        let content = ipc[0]["toolCalls"][0]["resultContent"].as_str().unwrap();
        assert_eq!(content, envelope);
        let decoded: Value = serde_json::from_str(content).unwrap();
        assert_eq!(decoded["text"]["value"], body);
        assert!(!content.contains("…[truncated]"));
    }
}
