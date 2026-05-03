//! Subagent model inference and propagation tests.

use super::super::*;

#[test]
fn infers_subagent_model_from_child_tool_calls() {
    let events = vec![
        user_msg("Run agent")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        // Subagent with children that have a model
        subagent_start("explore")
            .tool_call_id("sub-1")
            .agent_display_name("Explore Agent")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        // Child tool call under sub-1 with a known model
        tool_start("grep")
            .tool_call_id("tc-child-1")
            .parent_tool_call_id("sub-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.500Z")
            .parent("evt-2")
            .build_event(),
        tool_complete("tc-child-1")
            .parent_tool_call_id("sub-1")
            .model("claude-haiku-4.5")
            .success(true)
            .id("evt-4")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-3")
            .build_event(),
        subagent_complete("explore")
            .tool_call_id("sub-1")
            .agent_display_name("Explore Agent")
            .id("evt-5")
            .timestamp("2026-03-10T07:14:54.000Z")
            .parent("evt-2")
            .build_event(),
        // Subagent without any children (model stays None)
        subagent_start("task")
            .tool_call_id("sub-2")
            .agent_display_name("Task Agent")
            .id("evt-6")
            .timestamp("2026-03-10T07:14:55.000Z")
            .parent("evt-1")
            .build_event(),
        subagent_complete("task")
            .tool_call_id("sub-2")
            .agent_display_name("Task Agent")
            .id("evt-7")
            .timestamp("2026-03-10T07:14:56.000Z")
            .parent("evt-6")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    // sub-1 should have model inferred from its child tool call
    let sub1 = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("sub-1"))
        .expect("sub-1 not found");
    assert!(sub1.is_subagent);
    assert_eq!(sub1.model.as_deref(), Some("claude-haiku-4.5"));

    // sub-2 has no children, so model stays None
    let sub2 = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("sub-2"))
        .expect("sub-2 not found");
    assert!(sub2.is_subagent);
    assert_eq!(sub2.model, None);
}
#[test]
fn subagent_model_overrides_wrong_parent_model() {
    let events = vec![
        user_msg("Review code")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-04-01T10:00:00.000Z")
            .build_event(),
        // 1. ToolExecStart for the subagent tool call (arguments contain the real model)
        tool_start("task")
            .tool_call_id("sub-1")
            .arguments(json!({
                "agent_type": "code-review",
                "model": "gemini-3-pro-preview",
                "prompt": "Review the diff"
            }))
            .id("evt-2")
            .timestamp("2026-04-01T10:00:01.000Z")
            .parent("evt-1")
            .build_event(),
        // 2. ToolExecComplete for the subagent — model is WRONG (parent's model)
        tool_complete("sub-1")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .tool_telemetry(json!({
                "properties": {
                    "model": "gemini-3-pro-preview"
                }
            }))
            .id("evt-3")
            .timestamp("2026-04-01T10:00:02.000Z")
            .parent("evt-2")
            .build_event(),
        // 3. SubagentStarted enriches the tool call
        subagent_start("code-review")
            .tool_call_id("sub-1")
            .agent_display_name("Code Review Agent")
            .id("evt-4")
            .timestamp("2026-04-01T10:00:03.000Z")
            .parent("evt-2")
            .build_event(),
        // 4. Child ToolExecStart under the subagent
        tool_start("grep")
            .tool_call_id("tc-child-1")
            .parent_tool_call_id("sub-1")
            .id("evt-5")
            .timestamp("2026-04-01T10:00:04.000Z")
            .parent("evt-4")
            .build_event(),
        // 5. Child ToolExecComplete with the CORRECT subagent model
        tool_complete("tc-child-1")
            .parent_tool_call_id("sub-1")
            .model("gemini-3-pro-preview")
            .success(true)
            .id("evt-6")
            .timestamp("2026-04-01T10:00:05.000Z")
            .parent("evt-5")
            .build_event(),
        subagent_complete("code-review")
            .tool_call_id("sub-1")
            .agent_display_name("Code Review Agent")
            .id("evt-7")
            .timestamp("2026-04-01T10:00:06.000Z")
            .parent("evt-4")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    let sub1 = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("sub-1"))
        .expect("sub-1 not found");
    assert!(sub1.is_subagent);
    // Must be the child's model, NOT the parent's "claude-opus-4.6"
    assert_eq!(
        sub1.model.as_deref(),
        Some("gemini-3-pro-preview"),
        "subagent model should be overridden by child model, not the parent's model"
    );
}
#[test]
fn nested_subagent_model_propagation() {
    let events = vec![
        user_msg("Deep task")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-05-01T12:00:00.000Z")
            .build_event(),
        // Outer subagent: ToolExecStart
        tool_start("task")
            .tool_call_id("outer-sub")
            .arguments(json!({"agent_type": "general-purpose"}))
            .id("evt-2")
            .timestamp("2026-05-01T12:00:01.000Z")
            .parent("evt-1")
            .build_event(),
        // Outer subagent: ToolExecComplete with wrong parent model
        tool_complete("outer-sub")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .id("evt-3")
            .timestamp("2026-05-01T12:00:02.000Z")
            .parent("evt-2")
            .build_event(),
        subagent_start("general-purpose")
            .tool_call_id("outer-sub")
            .agent_display_name("General Purpose Agent")
            .id("evt-4")
            .timestamp("2026-05-01T12:00:03.000Z")
            .parent("evt-2")
            .build_event(),
        // Inner subagent (child of outer): ToolExecStart
        tool_start("task")
            .tool_call_id("inner-sub")
            .arguments(json!({"agent_type": "explore"}))
            .parent_tool_call_id("outer-sub")
            .id("evt-5")
            .timestamp("2026-05-01T12:00:04.000Z")
            .parent("evt-4")
            .build_event(),
        // Inner subagent: ToolExecComplete with outer's model (wrong for inner)
        tool_complete("inner-sub")
            .parent_tool_call_id("outer-sub")
            .model("claude-sonnet-4.5")
            .success(true)
            .id("evt-6")
            .timestamp("2026-05-01T12:00:05.000Z")
            .parent("evt-5")
            .build_event(),
        subagent_start("explore")
            .tool_call_id("inner-sub")
            .agent_display_name("Explore Agent")
            .id("evt-7")
            .timestamp("2026-05-01T12:00:06.000Z")
            .parent("evt-5")
            .build_event(),
        // Leaf tool call under inner subagent
        tool_start("view")
            .tool_call_id("leaf-tc")
            .parent_tool_call_id("inner-sub")
            .id("evt-8")
            .timestamp("2026-05-01T12:00:07.000Z")
            .parent("evt-7")
            .build_event(),
        tool_complete("leaf-tc")
            .parent_tool_call_id("inner-sub")
            .model("claude-haiku-4.5")
            .success(true)
            .id("evt-9")
            .timestamp("2026-05-01T12:00:08.000Z")
            .parent("evt-8")
            .build_event(),
        // Complete inner, then outer
        subagent_complete("explore")
            .tool_call_id("inner-sub")
            .agent_display_name("Explore Agent")
            .id("evt-10")
            .timestamp("2026-05-01T12:00:09.000Z")
            .parent("evt-7")
            .build_event(),
        subagent_complete("general-purpose")
            .tool_call_id("outer-sub")
            .agent_display_name("General Purpose Agent")
            .id("evt-11")
            .timestamp("2026-05-01T12:00:10.000Z")
            .parent("evt-4")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    // Inner subagent should get its model from the leaf tool call
    let inner = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("inner-sub"))
        .expect("inner-sub not found");
    assert!(inner.is_subagent);
    assert_eq!(
        inner.model.as_deref(),
        Some("claude-haiku-4.5"),
        "inner subagent model should come from its leaf child"
    );

    // Outer subagent should get its model from the inner subagent (after inner was resolved)
    let outer = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("outer-sub"))
        .expect("outer-sub not found");
    assert!(outer.is_subagent);
    assert_eq!(
        outer.model.as_deref(),
        Some("claude-haiku-4.5"),
        "outer subagent model should propagate from inner subagent's resolved model"
    );
}
