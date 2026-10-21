//! Redaction of loaded skills, which carry a SKILL.md path, description and body.

use crate::options::RedactionOptions;
use crate::redaction::apply_redaction;
use crate::render::ExportRenderer;
use crate::render::json::JsonRenderer;
use crate::test_helpers::{minimal_session, simple_tool_call, simple_turn, test_archive};
use tracepilot_core::models::conversation::{
    SessionEventSeverity, SkillInvocationEvent, TurnSessionEvent,
};

fn test_options_all() -> RedactionOptions {
    RedactionOptions {
        anonymize_paths: true,
        strip_secrets: true,
        strip_pii: true,
    }
}

fn leaky_skill() -> SkillInvocationEvent {
    SkillInvocationEvent {
        id: Some("ev-skill".into()),
        name: Some("deploy".into()),
        path: Some(r"C:\Users\alice\.copilot\skills\deploy\SKILL.md".into()),
        description: Some("Deploys from /home/alice/infra".into()),
        content_length: Some(64),
        content: Some("Run with API_KEY=sk_live_abcdef123456 and mail ops@example.com".into()),
        context_length: None,
        context_folded: false,
    }
}

fn assert_skill_redacted(skill: &SkillInvocationEvent) {
    assert!(!skill.path.as_ref().unwrap().contains("alice"));
    assert!(!skill.description.as_ref().unwrap().contains("alice"));
    let content = skill.content.as_ref().unwrap();
    assert!(!content.contains("sk_live_abcdef123456"), "got: {content}");
    assert!(!content.contains("ops@example.com"), "got: {content}");
    assert_eq!(skill.name.as_deref(), Some("deploy"));
    assert_eq!(skill.id.as_deref(), Some("ev-skill"));
}

#[test]
fn redacts_skill_invocations_on_tool_calls_and_events() {
    let mut turn = simple_turn(0, "Use the deploy skill", "Done", None);
    let mut tc = simple_tool_call("skill", Some(true), false);
    tc.skill_invocation = Some(leaky_skill());
    turn.tool_calls = vec![tc];
    turn.session_events = vec![TurnSessionEvent {
        event_type: "skill.invoked".into(),
        timestamp: None,
        severity: SessionEventSeverity::Info,
        summary: "Skill invoked: deploy".into(),
        checkpoint_number: None,
        request_id: None,
        tool_call_id: None,
        prompt_kind: None,
        result_kind: None,
        resolved_by_hook: None,
        skill_invocation: Some(leaky_skill()),
    }];
    let mut session = minimal_session();
    session.conversation = Some(vec![turn]);
    let mut archive = test_archive(session);

    apply_redaction(&mut archive, &test_options_all());

    let turn = &archive.sessions[0].conversation.as_ref().unwrap()[0];
    assert_skill_redacted(turn.tool_calls[0].skill_invocation.as_ref().unwrap());
    assert_skill_redacted(turn.session_events[0].skill_invocation.as_ref().unwrap());

    // The JSON export serializes whole turns, so check the rendered file too.
    let files = JsonRenderer.render(&archive).unwrap();
    let json = files[0].as_text().unwrap();
    assert!(!json.contains("alice"), "rendered JSON leaks the home path");
    assert!(!json.contains("sk_live_abcdef123456"));
}

#[test]
fn skill_invocation_without_sensitive_text_is_unchanged() {
    let mut turn = simple_turn(0, "Use the lint skill", "Done", None);
    let mut tc = simple_tool_call("skill", Some(true), false);
    tc.skill_invocation = Some(SkillInvocationEvent {
        id: None,
        name: Some("lint".into()),
        path: Some(".github/skills/lint/SKILL.md".into()),
        description: Some("Runs the linter".into()),
        content_length: Some(13),
        content: Some("Run the lint.".into()),
        context_length: None,
        context_folded: false,
    });
    turn.tool_calls = vec![tc];
    let mut session = minimal_session();
    session.conversation = Some(vec![turn]);
    let mut archive = test_archive(session);

    let stats = apply_redaction(&mut archive, &test_options_all());

    assert_eq!(stats.fields_redacted, 0);
    let tc = &archive.sessions[0].conversation.as_ref().unwrap()[0].tool_calls[0];
    let skill = tc.skill_invocation.as_ref().unwrap();
    assert_eq!(skill.path.as_deref(), Some(".github/skills/lint/SKILL.md"));
    assert_eq!(skill.description.as_deref(), Some("Runs the linter"));
    assert_eq!(skill.content.as_deref(), Some("Run the lint."));
}
