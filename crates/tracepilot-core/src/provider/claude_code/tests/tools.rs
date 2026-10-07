//! Tool normalization (mapping.md §2) over `claude_scenarios::tool_catalog`,
//! plus the polymorphic results the fixture cannot express.

use serde_json::{Value, json};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::parse;
use crate::models::{ConversationTurn, TurnToolCall};
use crate::provider::claude_code::tool_results::reshape;
use crate::turns::reconstruct_turns;

fn catalog() -> Vec<ConversationTurn> {
    reconstruct_turns(&parse(&fixtures::tool_catalog()).events)
}

fn call<'a>(turns: &'a [ConversationTurn], id: &str) -> &'a TurnToolCall {
    turns
        .iter()
        .flat_map(|t| &t.tool_calls)
        .find(|tc| tc.tool_call_id.as_deref() == Some(id))
        .unwrap_or_else(|| panic!("tool call {id}"))
}

fn args(tc: &TurnToolCall) -> &Value {
    tc.arguments.as_ref().expect("arguments")
}

#[test]
fn every_row_maps_to_its_canonical_name_and_keeps_the_native_one() {
    let turns = catalog();
    let rows = [
        ("toolu_bash_ok", "shell", "Bash"),
        ("toolu_ps", "powershell", "PowerShell"),
        ("toolu_read", "view", "Read"),
        ("toolu_edit", "edit", "Edit"),
        ("toolu_write_new", "create", "Write"),
        ("toolu_write_over", "apply_patch", "Write"),
        ("toolu_multi", "apply_patch", "MultiEdit"),
        ("toolu_grep", "grep", "Grep"),
        ("toolu_glob", "glob", "Glob"),
        ("toolu_fetch", "web_fetch", "WebFetch"),
        ("toolu_search", "web_search", "WebSearch"),
        ("toolu_ask", "ask_user", "AskUserQuestion"),
        ("toolu_send", "write_agent", "SendMessage"),
        ("toolu_stop_shell", "stop_powershell", "TaskStop"),
        ("toolu_stop_agent", "stop_agent", "TaskStop"),
        ("toolu_kill", "stop_powershell", "KillShell"),
        (
            "toolu_mcp",
            "mcp__docs__search_pages",
            "mcp__docs__search_pages",
        ),
        ("toolu_monitor", "Monitor", "Monitor"),
    ];
    for (id, canonical, native) in rows {
        let tc = call(&turns, id);
        assert_eq!(tc.tool_name, canonical, "{id}");
        assert_eq!(tc.native_tool_name.as_deref(), Some(native), "{id}");
        assert!(tc.is_complete, "{id}");
    }
    let mcp = call(&turns, "toolu_mcp");
    assert_eq!(mcp.mcp_server_name.as_deref(), Some("docs"));
    assert_eq!(mcp.mcp_tool_name.as_deref(), Some("search_pages"));
    assert_eq!(mcp.result_content.as_deref(), Some("2 pages"));
}

#[test]
fn shells_report_output_exit_codes_and_persisted_paths() {
    let turns = catalog();
    let ok = call(&turns, "toolu_bash_ok");
    assert_eq!(
        args(ok),
        &json!({"command": "cargo test", "description": "Run tests", "timeout": 60000})
    );
    assert_eq!(
        ok.result_content.as_deref(),
        Some("test result: ok\nwarning: unused")
    );
    assert_eq!(ok.exit_code, Some(0));

    let no_match = call(&turns, "toolu_bash_nomatch");
    assert_eq!(
        (no_match.success, no_match.exit_code),
        (Some(true), Some(1))
    );

    let failed = call(&turns, "toolu_bash_fail");
    assert_eq!((failed.success, failed.exit_code), (Some(false), Some(2)));
    assert!(failed.error.as_deref().unwrap().contains("no such command"));

    let background = call(&turns, "toolu_bash_bg");
    assert_eq!(args(background)["mode"], "background");
    assert_eq!(background.exit_code, None, "still running");
    assert_eq!(
        background.result_content.as_deref(),
        Some("Command running in background with ID: bg_1")
    );

    let image = call(&turns, "toolu_bash_image");
    assert_eq!(image.result_content.as_deref(), Some("[image]"));

    let ps = call(&turns, "toolu_ps");
    assert_eq!(
        (ps.result_content.as_deref(), ps.exit_code),
        (Some("Monday"), Some(0))
    );

    // The full output comes from toolUseResult; the persisted file is only named.
    let parsed = parse(&fixtures::tool_catalog());
    let big = parsed
        .events
        .iter()
        .find(|e| {
            e.raw.event_type == "tool.execution_complete"
                && e.raw.data["toolCallId"] == "toolu_bash_big"
        })
        .unwrap();
    assert_eq!(
        big.raw.data["result"],
        json!({"content": "Compiling demo\nFinished",
            "persistedOutputPath": fixtures::PERSISTED_PATH, "persistedOutputSize": 42000})
    );
    assert!(!std::path::Path::new(fixtures::PERSISTED_PATH).exists());
}

#[test]
fn file_tools_rebuild_their_content_from_the_structured_result() {
    let turns = catalog();
    let read = call(&turns, "toolu_read");
    assert_eq!(
        args(read),
        &json!({"path": "src/lib.rs", "view_range": [10, 11]})
    );
    assert_eq!(
        read.result_content.as_deref(),
        Some("10. fn a() {}\n11. fn b() {}"),
        "numbered from startLine, without the appended reminder"
    );
    let image = call(&turns, "toolu_read_image");
    assert_eq!(
        image.result_content.as_deref(),
        Some("[image: 640×480, image/png, 2048 bytes]")
    );
    let missing = call(&turns, "toolu_read_missing");
    assert_eq!(missing.success, Some(false));
    assert!(
        missing
            .error
            .as_deref()
            .unwrap()
            .contains("File does not exist.")
    );

    let edit = call(&turns, "toolu_edit");
    assert_eq!(
        args(edit),
        &json!({"path": "src/lib.rs", "old_str": "old()", "new_str": "new()"})
    );
    let created = call(&turns, "toolu_write_new");
    assert_eq!(
        args(created),
        &json!({"path": "src/ready.rs", "file_text": "pub const READY: bool = true;\n"})
    );
    assert_eq!(
        args(call(&turns, "toolu_write_over")),
        &json!(
            "*** Begin Patch\n*** Update File: src/main.rs\n@@ -3,1 +3,1 @@\n\
             -fn main() { todo!() }\n+fn main() {}\n*** End Patch"
        )
    );
    assert_eq!(
        args(call(&turns, "toolu_multi")),
        &json!(
            "*** Begin Patch\n*** Update File: src/a.rs\n@@ -3,1 +3,1 @@\n-a\n+b\n*** End Patch"
        )
    );

    // Edit keeps the model's text and adds real line numbers.
    let parsed = parse(&fixtures::tool_catalog());
    let edit_result = parsed
        .events
        .iter()
        .find(|e| {
            e.raw.event_type == "tool.execution_complete"
                && e.raw.data["toolCallId"] == "toolu_edit"
        })
        .unwrap();
    assert_eq!(
        edit_result.raw.data["result"],
        json!({"content": "The file src/lib.rs has been updated successfully.",
            "detailedContent": "@@ -3,1 +3,1 @@\n-    old()\n+    new()"})
    );
}

#[test]
fn search_web_and_questions_take_the_renderer_shapes() {
    let turns = catalog();
    let grep = call(&turns, "toolu_grep");
    assert_eq!(args(grep)["ignore_case"], true);
    assert_eq!(
        grep.result_content.as_deref(),
        Some("src/lib.rs:10:fn a() {}")
    );
    let glob = call(&turns, "toolu_glob");
    assert_eq!(
        glob.result_content.as_deref(),
        Some("src/lib.rs\nsrc/main.rs")
    );
    let fetch = call(&turns, "toolu_fetch");
    assert_eq!(
        fetch.result_content.as_deref(),
        Some("The guide describes fixtures.")
    );

    let search = call(&turns, "toolu_search");
    let body: Value = serde_json::from_str(search.result_content.as_deref().unwrap()).unwrap();
    assert_eq!(
        body,
        json!({"text": {"value": "Caches keep the whole response envelope.", "annotations": [
            {"type": "url_citation",
             "url_citation": {"url": "https://example.com/cache", "title": "Cache guide"}}]}})
    );

    let ask = call(&turns, "toolu_ask");
    assert_eq!(args(ask)["message"], "Which viewport?");
    assert_eq!(
        args(ask)["requestedSchema"]["properties"]["q1"]["oneOf"][1],
        json!({"const": "Minimum", "title": "Minimum"})
    );
    let answers: Value = serde_json::from_str(ask.result_content.as_deref().unwrap()).unwrap();
    assert_eq!(answers, json!({"q1": "Minimum"}));
}

#[test]
fn agent_and_shell_control_tools_map_by_task_type() {
    let turns = catalog();
    let send = call(&turns, "toolu_send");
    assert_eq!(
        args(send),
        &json!({"agent_id": "reviewer", "message": "Check wrapping."})
    );
    let shell = call(&turns, "toolu_stop_shell");
    assert_eq!(args(shell), &json!({"shellId": "bg_1"}));
    assert_eq!(
        shell.result_content.as_deref(),
        Some("Successfully stopped task: bg_1 (npm run dev)")
    );
    assert_eq!(
        args(call(&turns, "toolu_stop_agent")),
        &json!({"agent_id": "a77"})
    );
    assert_eq!(
        args(call(&turns, "toolu_kill")),
        &json!({"shellId": "bg_2"})
    );
}

#[test]
fn a_call_still_waiting_for_its_result_keeps_its_start_mapping() {
    let files = fixtures::tool_catalog();
    // Drop everything from the overwrite's result on.
    let text = std::fs::read_to_string(&files.main).unwrap();
    let cut = text.find(r#""tool_use_id":"toolu_write_over""#).unwrap();
    let keep = text[..cut].rfind('\n').unwrap() + 1;
    std::fs::write(&files.main, &text[..keep]).unwrap();
    let turns = reconstruct_turns(&parse(&files).events);
    let pending = call(&turns, "toolu_write_over");
    assert_eq!(
        pending.tool_name, "create",
        "overwrite is only known from the result"
    );
    assert!(!pending.is_complete);
}

#[test]
fn polymorphic_and_unstructured_results_fall_back_to_the_text() {
    // Error: toolUseResult is the error string; no structured fields are read.
    let error = reshape(
        "Bash",
        &json!({}),
        Some(&json!("Error: Exit code 7\nx")),
        "Exit code 7\nx".into(),
        true,
    );
    assert_eq!(error.result, None);
    assert_eq!(error.error, Some(json!({"message": "Exit code 7\nx"})));
    assert_eq!(error.shell_execution, Some(json!({"exitCode": 7})));
    // A failure without an exit code (denied, timed out) has none.
    let denied = reshape(
        "Bash",
        &json!({}),
        Some(&json!("denied")),
        "The user denied it".into(),
        true,
    );
    assert_eq!(denied.shell_execution, None);
    // Interrupted or timed out: still unknown.
    for extra in [
        json!({"interrupted": true}),
        json!({"timedOutAfterMs": 1000}),
    ] {
        let mut tur = json!({"stdout": "partial", "stderr": "", "interrupted": false});
        tur.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let outcome = reshape("Bash", &json!({}), Some(&tur), "partial".into(), false);
        assert_eq!(outcome.shell_execution, None);
        assert_eq!(outcome.result, Some(json!({"content": "partial"})));
    }
    // No toolUseResult, a non-object one, or a result without a start: the text.
    for (native, tur) in [
        ("Read", None),
        ("Read", Some(json!(["text"]))),
        ("Glob", Some(json!({"filenames": []}))),
        (
            "Read",
            Some(json!({"type": "notebook", "file": {"cells": []}})),
        ),
        (
            "Read",
            Some(json!({"type": "text", "file": {"content": ""}})),
        ),
        ("WebFetch", Some(json!({"result": 5}))),
        ("AskUserQuestion", Some(json!({"answers": "?"}))),
        ("", Some(json!({"stdout": "x"}))),
    ] {
        let outcome = reshape(native, &Value::Null, tur.as_ref(), "plain".into(), false);
        assert_eq!(
            outcome.result,
            Some(json!({"content": "plain"})),
            "{native} {tur:?}"
        );
        assert!(outcome.restart.is_none());
    }
    // A Write without a patch, or a failed one, stays `create`.
    let create = json!({"type": "update", "filePath": "a"});
    assert!(
        reshape("Write", &json!({}), Some(&create), "ok".into(), false)
            .restart
            .is_none()
    );
    assert!(
        reshape("Write", &json!({}), Some(&json!("e")), "e".into(), true)
            .restart
            .is_none()
    );
    // An empty search keeps the query as its body.
    let search = reshape(
        "WebSearch",
        &json!({}),
        Some(&json!({"query": "q", "results": []})),
        "t".into(),
        false,
    );
    let body: Value =
        serde_json::from_str(search.result.unwrap()["content"].as_str().unwrap()).unwrap();
    assert_eq!(
        body,
        json!({"text": {"value": "Web search results for query: \"q\"", "annotations": []}})
    );
}

#[test]
fn a_record_with_several_results_ignores_its_shared_structured_result() {
    use tracepilot_test_support::claude::{OPUS, Transcript, Usage, tool_use, write_session};
    let mut t = Transcript::main();
    t.prompt("Two reads.");
    t.call(
        "msg_two",
        OPUS,
        vec![
            tool_use("toolu_r1", "Read", json!({"file_path": "a"})),
            tool_use("toolu_r2", "Read", json!({"file_path": "b"})),
        ],
        Usage::new(1, 0, 0, 1),
        "tool_use",
    );
    t.user(json!({
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_r1", "content": "     1\talpha"},
            {"type": "tool_result", "tool_use_id": "toolu_r2", "content": "     1\tbeta"},
        ]},
        "toolUseResult": {"type": "text", "file": {"content": "alpha", "startLine": 1}},
    }));
    let turns = reconstruct_turns(&parse(&write_session(&t, &[])).events);
    assert_eq!(
        call(&turns, "toolu_r1").result_content.as_deref(),
        Some("     1\talpha")
    );
    assert_eq!(
        call(&turns, "toolu_r2").result_content.as_deref(),
        Some("     1\tbeta")
    );
}
