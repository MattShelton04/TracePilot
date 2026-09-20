use super::*;

#[test]
fn correlated_invocation_does_not_hide_a_second_call_without_an_event() {
    let invocations = extract(vec![
        skill_call("00:00:02", "tc-1", "frontend-design"),
        call_complete("00:00:03", "tc-1"),
        parented(
            invoked(
                "00:00:04",
                json!({"name": "frontend-design", "content": SKILL_BODY}),
            ),
            "tool.execution_complete-00:00:03",
        ),
        skill_call("00:00:05", "tc-2", "frontend-design"),
        call_complete("00:00:06", "tc-2"),
    ]);
    assert_eq!(invocations.len(), 2);
    assert_eq!(invocations[0].origin, SkillInvocationOrigin::Event);
    assert_eq!(
        invocations[1].origin,
        SkillInvocationOrigin::ToolCallFallback
    );
    assert_eq!(invocations[1].tool_call_id.as_deref(), Some("tc-2"));
}

#[test]
fn uncorrelated_invocation_covers_only_one_call() {
    let invocations = extract(vec![
        skill_call("00:00:02", "tc-1", "frontend-design"),
        call_complete("00:00:03", "tc-1"),
        invoked(
            "00:00:04",
            json!({"name": "frontend-design", "content": SKILL_BODY}),
        ),
        skill_call("00:00:05", "tc-2", "frontend-design"),
        call_complete("00:00:06", "tc-2"),
    ]);
    assert_eq!(invocations.len(), 2);
    assert_eq!(
        invocations[1].origin,
        SkillInvocationOrigin::ToolCallFallback
    );
}
