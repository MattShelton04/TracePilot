//! Skill invocation session event tests.

use super::super::*;

fn skill_invoked(id: &str, name: &str, path: &str, content: &str) -> TypedEvent {
    skill_invoked_with_parent(id, name, path, content, "evt-u1")
}

fn skill_invoked_with_parent(
    id: &str,
    name: &str,
    path: &str,
    content: &str,
    parent: &str,
) -> TypedEvent {
    make_event(
        SessionEventType::SkillInvoked,
        TypedEventData::SkillInvoked(SkillInvokedData {
            name: Some(name.to_string()),
            path: Some(path.to_string()),
            content: Some(content.to_string()),
            allowed_tools: None,
            plugin_name: None,
            plugin_version: None,
            description: Some("Helpful skill".to_string()),
        }),
        id,
        "2026-03-10T07:00:10.000Z",
        Some(parent),
    )
}

fn skill_context(name: &str, content: &str) -> String {
    format!(
        "<skill-context name=\"{name}\">\nBase directory for this skill: C:\\skills\\{name}\n\n{content}\n</skill-context>"
    )
}

#[test]
fn skill_invocation_attaches_to_originating_skill_tool_call() {
    let skill_content = "---\nname: trace-skill\n---\nUse tracing.";
    let context = skill_context("trace-skill", skill_content);

    let events = vec![
        user_msg("Use the tracing skill")
            .id("evt-u1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        tool_start("skill")
            .tool_call_id("tc-skill")
            .arguments(json!({"skill": "trace-skill"}))
            .id("evt-tool-start")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
        tool_complete("tc-skill")
            .success(true)
            .id("evt-tool-complete")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
        skill_invoked_with_parent(
            "evt-skill",
            "trace-skill",
            "C:\\skills\\trace-skill\\SKILL.md",
            skill_content,
            "evt-tool-complete",
        ),
        user_msg(context)
            .id("evt-skill-context")
            .parent("evt-skill")
            .timestamp("2026-03-10T07:00:11.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:12.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 1);
    assert!(turns[0].session_events.is_empty());
    assert_eq!(turns[0].tool_calls.len(), 1);
    let tool_skill = turns[0].tool_calls[0].skill_invocation.as_ref().unwrap();
    assert_eq!(tool_skill.id.as_deref(), Some("evt-skill"));
    assert_eq!(tool_skill.name.as_deref(), Some("trace-skill"));
    assert!(tool_skill.context_folded);
}

#[test]
fn skill_invocation_parented_to_non_skill_tool_renders_as_session_event() {
    let skill_content = "---\nname: trace-skill\n---\nUse tracing.";

    let events = vec![
        user_msg("Inspect the file")
            .id("evt-u1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        tool_start("view")
            .tool_call_id("tc-view")
            .id("evt-tool-start")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
        tool_complete("tc-view")
            .success(true)
            .id("evt-tool-complete")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
        skill_invoked_with_parent(
            "evt-skill",
            "trace-skill",
            "C:\\skills\\trace-skill\\SKILL.md",
            skill_content,
            "evt-tool-complete",
        ),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:12.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].tool_calls.len(), 1);
    assert!(turns[0].tool_calls[0].skill_invocation.is_none());
    assert_eq!(turns[0].session_events.len(), 1);
    let skill = turns[0].session_events[0]
        .skill_invocation
        .as_ref()
        .unwrap();
    assert_eq!(skill.id.as_deref(), Some("evt-skill"));
    assert_eq!(skill.name.as_deref(), Some("trace-skill"));
}

#[test]
fn skill_invocation_content_is_truncated_without_changing_reported_length() {
    let max_content_chars = 16_384;
    let skill_content = format!("{}tail", "é".repeat(max_content_chars));

    let events = vec![
        user_msg("Use the large skill").id("evt-u1").build_event(),
        skill_invoked(
            "evt-skill",
            "large-skill",
            "C:\\skills\\large-skill\\SKILL.md",
            &skill_content,
        ),
    ];

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 1);
    let skill = turns[0].session_events[0]
        .skill_invocation
        .as_ref()
        .unwrap();
    let captured = skill.content.as_deref().unwrap();
    assert_eq!(skill.content_length, Some(skill_content.chars().count()));
    assert_eq!(captured.chars().count(), max_content_chars);
    assert_eq!(captured.chars().last(), Some('é'));
    assert!(!captured.contains("tail"));
}

#[test]
fn multiple_pending_skill_context_messages_are_folded_by_parent_id() {
    let content_a = "---\nname: skill-a\n---\nUse A.";
    let content_b = "---\nname: skill-b\n---\nUse B.";

    let events = vec![
        user_msg("Use two skills")
            .id("evt-u1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        skill_invoked(
            "evt-skill-a",
            "skill-a",
            "C:\\skills\\skill-a\\SKILL.md",
            content_a,
        ),
        skill_invoked(
            "evt-skill-b",
            "skill-b",
            "C:\\skills\\skill-b\\SKILL.md",
            content_b,
        ),
        user_msg(skill_context("skill-a", content_a))
            .id("evt-skill-context-a")
            .parent("evt-skill-a")
            .timestamp("2026-03-10T07:00:11.000Z")
            .build_event(),
        user_msg(skill_context("skill-b", content_b))
            .id("evt-skill-context-b")
            .parent("evt-skill-b")
            .timestamp("2026-03-10T07:00:12.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:13.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].session_events.len(), 2);
    assert!(
        turns[0].session_events.iter().all(|event| event
            .skill_invocation
            .as_ref()
            .unwrap()
            .context_folded)
    );
}

#[test]
fn verified_skill_context_user_message_is_folded_into_invocation() {
    let skill_content = "---\nname: trace-skill\n---\nUse tracing.";
    let context = skill_context("trace-skill", skill_content);
    let context_len = context.chars().count();

    let events = vec![
        user_msg("Use the tracing skill")
            .id("evt-u1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        skill_invoked(
            "evt-skill",
            "trace-skill",
            "C:\\skills\\trace-skill\\SKILL.md",
            skill_content,
        ),
        user_msg(context)
            .id("evt-skill-context")
            .parent("evt-skill")
            .timestamp("2026-03-10T07:00:11.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:12.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].user_message.as_deref(),
        Some("Use the tracing skill")
    );
    assert_eq!(turns[0].session_events.len(), 1);
    let skill_event = &turns[0].session_events[0];
    assert_eq!(skill_event.event_type, "skill.invoked");
    assert_eq!(skill_event.summary, "Skill invoked: trace-skill");
    let skill = skill_event.skill_invocation.as_ref().unwrap();
    assert_eq!(skill.id.as_deref(), Some("evt-skill"));
    assert_eq!(skill.name.as_deref(), Some("trace-skill"));
    assert_eq!(
        skill.path.as_deref(),
        Some("C:\\skills\\trace-skill\\SKILL.md")
    );
    assert_eq!(skill.description.as_deref(), Some("Helpful skill"));
    assert_eq!(skill.content_length, Some(skill_content.chars().count()));
    assert_eq!(skill.context_length, Some(context_len));
    assert!(skill.context_folded);
}

#[test]
fn skill_context_message_with_wrong_parent_is_not_folded() {
    let skill_content = "---\nname: trace-skill\n---\nUse tracing.";

    let events = vec![
        user_msg("Use the tracing skill").id("evt-u1").build_event(),
        skill_invoked(
            "evt-skill",
            "trace-skill",
            "C:\\skills\\trace-skill\\SKILL.md",
            skill_content,
        ),
        user_msg(skill_context("trace-skill", skill_content))
            .id("evt-user")
            .parent("evt-other")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].session_events.len(), 1);
    assert!(
        !turns[0].session_events[0]
            .skill_invocation
            .as_ref()
            .unwrap()
            .context_folded
    );
    assert!(
        turns[1]
            .user_message
            .as_deref()
            .is_some_and(|message| message.starts_with("<skill-context"))
    );
}

#[test]
fn skill_context_message_without_invoked_content_is_not_folded() {
    let skill_content = "---\nname: trace-skill\n---\nUse tracing.";

    let events = vec![
        user_msg("Use the tracing skill").id("evt-u1").build_event(),
        skill_invoked(
            "evt-skill",
            "trace-skill",
            "C:\\skills\\trace-skill\\SKILL.md",
            skill_content,
        ),
        user_msg(skill_context("trace-skill", "different content"))
            .id("evt-user")
            .parent("evt-skill")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].session_events.len(), 1);
    assert!(
        !turns[0].session_events[0]
            .skill_invocation
            .as_ref()
            .unwrap()
            .context_folded
    );
    assert!(
        turns[1]
            .user_message
            .as_deref()
            .is_some_and(|message| message.contains("different content"))
    );
}

#[test]
fn skill_context_message_with_wrong_name_is_not_folded() {
    let skill_content = "---\nname: trace-skill\n---\nUse tracing.";

    let events = vec![
        user_msg("Use the tracing skill").id("evt-u1").build_event(),
        skill_invoked(
            "evt-skill",
            "trace-skill",
            "C:\\skills\\trace-skill\\SKILL.md",
            skill_content,
        ),
        user_msg(skill_context("other-skill", skill_content))
            .id("evt-user")
            .parent("evt-skill")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].session_events.len(), 1);
    assert!(
        !turns[0].session_events[0]
            .skill_invocation
            .as_ref()
            .unwrap()
            .context_folded
    );
    assert!(
        turns[1]
            .user_message
            .as_deref()
            .is_some_and(|message| message.contains("other-skill"))
    );
}
