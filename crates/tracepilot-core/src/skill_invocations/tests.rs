//! Extraction tests, shaped by the invocation variants a real corpus holds:
//! 1.0.2 events with no description, 1.0.49 events with a trigger, 1.0.83
//! events owned by a subagent, tool calls with no event at all, a skill whose
//! name and directory disagree, and an SDK skill with an empty path.

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::*;
use crate::agent_runs::{AgentRun, extract_agent_runs};
use crate::parsing::events::TypedEvent;
use crate::testing::make_typed_event;
use crate::turns::reconstruct_turns;

fn at(time: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&format!("2026-09-12T{time}Z"))
        .unwrap()
        .with_timezone(&Utc)
}

fn event(event_type: &str, time: &str, data: Value) -> TypedEvent {
    let mut event = make_typed_event(event_type, data);
    event.raw.timestamp = Some(at(time));
    event.raw.id = Some(format!("{event_type}-{time}"));
    event
}

fn owned(mut event: TypedEvent, agent_id: &str) -> TypedEvent {
    event.raw.agent_id = Some(agent_id.to_string());
    event
}

fn parented(mut event: TypedEvent, parent: &str) -> TypedEvent {
    event.raw.parent_id = Some(parent.to_string());
    event
}

const SKILL_BODY: &str =
    "---\nname: frontend-design\ndescription: Design work\n---\n\nUse the tokens.";

fn skill_call(time: &str, call: &str, name: &str) -> TypedEvent {
    event(
        "tool.execution_start",
        time,
        json!({"toolCallId": call, "toolName": "skill", "arguments": {"skill": name}}),
    )
}

fn call_complete(time: &str, call: &str) -> TypedEvent {
    event(
        "tool.execution_complete",
        time,
        json!({"toolCallId": call, "success": true}),
    )
}

fn invoked(time: &str, data: Value) -> TypedEvent {
    event("skill.invoked", time, data)
}

/// The whole pipeline the indexer runs: reconstruct, extract agent runs, then
/// extract skill invocations from both.
fn extract(events: Vec<TypedEvent>) -> Vec<SkillInvocation> {
    let mut all = vec![
        event(
            "session.start",
            "00:00:00",
            json!({"copilotVersion": "1.0.83"}),
        ),
        event("user.message", "00:00:01", json!({"content": "go"})),
    ];
    all.extend(events);
    let turns = reconstruct_turns(&all);
    let runs = extract_agent_runs(&all, &turns);
    extract_skill_invocations(&all, &turns, &runs.runs)
}

#[test]
fn event_invocation_records_identity_path_and_cost() {
    let invocations = extract(vec![
        skill_call("00:00:02", "tc-1", "frontend-design"),
        call_complete("00:00:03", "tc-1"),
        parented(
            invoked(
                "00:00:04",
                json!({"name": "Frontend-Design",
                       "path": r"C:\Users\a\.copilot\skills\frontend-design\SKILL.md",
                       "content": SKILL_BODY, "description": "Design work"}),
            ),
            "tool.execution_complete-00:00:03",
        ),
    ]);

    assert_eq!(invocations.len(), 1);
    let invocation = &invocations[0];
    assert_eq!(invocation.name, "Frontend-Design");
    assert_eq!(invocation.normalized_name, "frontend-design");
    assert_eq!(
        invocation.normalized_directory.as_deref(),
        Some("c:/users/a/.copilot/skills/frontend-design")
    );
    assert_eq!(invocation.origin, SkillInvocationOrigin::Event);
    assert_eq!(invocation.tool_call_id.as_deref(), Some("tc-1"));
    assert_eq!(invocation.turn_index, 0);
    assert_eq!(invocation.description.as_deref(), Some("Design work"));
    assert!(invocation.content_sha256.is_some());
    // Frontmatter and instructions are estimated separately: the first is the
    // per-turn listing cost, the pair is what an invocation injects.
    assert!(invocation.frontmatter_tokens.unwrap() > 0);
    assert!(invocation.instruction_tokens.unwrap() > 0);
    assert_eq!(
        invocation.content_tokens(),
        Some(invocation.frontmatter_tokens.unwrap() + invocation.instruction_tokens.unwrap())
    );
}

#[test]
fn missing_trigger_and_description_stay_absent() {
    // A 1.0.2 event carries only name, path and content.
    let invocations = extract(vec![invoked(
        "00:00:04",
        json!({"name": "pdf", "path": "/home/a/.copilot/skills/pdf/SKILL.md",
               "content": SKILL_BODY}),
    )]);

    let invocation = &invocations[0];
    assert_eq!(invocation.trigger, None);
    assert_eq!(invocation.source, None);
    assert_eq!(invocation.description, None);
    assert_eq!(invocation.plugin_name, None);
}

#[test]
fn trigger_and_source_are_kept_when_recorded() {
    let invocations = extract(vec![invoked(
        "00:00:04",
        json!({"name": "pdf", "path": "/home/a/.copilot/skills/pdf/SKILL.md",
               "content": SKILL_BODY, "trigger": "agent-invoked",
               "source": "personal-copilot", "model": "gpt-5.6-luna"}),
    )]);

    let invocation = &invocations[0];
    assert_eq!(invocation.trigger.as_deref(), Some("agent-invoked"));
    assert_eq!(invocation.source.as_deref(), Some("personal-copilot"));
    assert_eq!(invocation.model.as_deref(), Some("gpt-5.6-luna"));
}

#[test]
fn subagent_invocation_resolves_the_agent_name() {
    let invocations = extract(vec![
        event(
            "tool.execution_start",
            "00:00:02",
            json!({"toolCallId": "tc-task", "toolName": "task",
                   "arguments": {"agent_type": "explore", "name": "Explore"}}),
        ),
        owned(
            event(
                "subagent.started",
                "00:00:03",
                json!({"toolCallId": "tc-task", "agentName": "explore",
                       "agentType": "explore"}),
            ),
            "agent-7",
        ),
        owned(
            invoked(
                "00:00:04",
                json!({"name": "playwright-cli",
                       "path": "/home/a/.copilot/skills/playwright-cli/SKILL.md",
                       "content": SKILL_BODY}),
            ),
            "agent-7",
        ),
    ]);

    let invocation = invocations
        .iter()
        .find(|invocation| invocation.normalized_name == "playwright-cli")
        .expect("skill invocation");
    assert_eq!(invocation.agent_id.as_deref(), Some("agent-7"));
    assert_eq!(invocation.agent_name.as_deref(), Some("explore"));
}

#[test]
fn main_agent_invocation_has_no_agent_attribution() {
    let invocations = extract(vec![invoked(
        "00:00:04",
        json!({"name": "pdf", "path": "/home/a/.copilot/skills/pdf/SKILL.md",
               "content": SKILL_BODY}),
    )]);

    assert_eq!(invocations[0].agent_id, None);
    assert_eq!(invocations[0].agent_name, None);
}

#[test]
fn tool_call_without_an_event_becomes_a_fallback_row() {
    let invocations = extract(vec![
        skill_call("00:00:02", "tc-1", "code-reviewer"),
        call_complete("00:00:03", "tc-1"),
    ]);

    assert_eq!(invocations.len(), 1);
    let invocation = &invocations[0];
    assert_eq!(invocation.name, "code-reviewer");
    assert_eq!(invocation.origin, SkillInvocationOrigin::ToolCallFallback);
    assert_eq!(invocation.path, None);
    assert_eq!(invocation.content_sha256, None);
    assert_eq!(invocation.content_tokens(), None);
    assert_eq!(invocation.tool_call_id.as_deref(), Some("tc-1"));
}

#[test]
fn a_correlated_call_and_its_event_count_once() {
    let invocations = extract(vec![
        skill_call("00:00:02", "tc-1", "frontend-design"),
        call_complete("00:00:03", "tc-1"),
        parented(
            invoked(
                "00:00:04",
                json!({"name": "frontend-design",
                       "path": "/home/a/.copilot/skills/frontend-design/SKILL.md",
                       "content": SKILL_BODY}),
            ),
            "tool.execution_complete-00:00:03",
        ),
    ]);

    assert_eq!(invocations.len(), 1);
    assert_eq!(invocations[0].origin, SkillInvocationOrigin::Event);
}

#[test]
fn an_uncorrelated_event_still_suppresses_its_tool_call() {
    // The event never names its tool call, so the reconstructor renders it as
    // a session event. Both describe the same invocation.
    let invocations = extract(vec![
        skill_call("00:00:02", "tc-1", "frontend-design"),
        call_complete("00:00:03", "tc-1"),
        invoked(
            "00:00:04",
            json!({"name": "Frontend-Design",
                   "path": "/home/a/.copilot/skills/frontend-design/SKILL.md",
                   "content": SKILL_BODY}),
        ),
    ]);

    assert_eq!(invocations.len(), 1, "{invocations:#?}");
    assert_eq!(invocations[0].origin, SkillInvocationOrigin::Event);
}

#[test]
fn name_and_directory_may_disagree() {
    // Seen locally: `testing-usability` loads from a `usability-testing`
    // directory, so only the path identifies the installed skill.
    let invocations = extract(vec![invoked(
        "00:00:04",
        json!({"name": "testing-usability",
               "path": r"C:\git\portify\.github\skills\usability-testing\SKILL.md",
               "content": SKILL_BODY}),
    )]);

    assert_eq!(invocations[0].normalized_name, "testing-usability");
    assert_eq!(
        invocations[0].normalized_directory.as_deref(),
        Some("c:/git/portify/.github/skills/usability-testing")
    );
}

#[test]
fn sdk_skill_without_a_path_resolves_by_name_only() {
    let invocations = extract(vec![invoked(
        "00:00:04",
        json!({"name": "sdk-skill", "path": "", "content": "Do the thing."}),
    )]);

    assert_eq!(invocations[0].path, None);
    assert_eq!(invocations[0].normalized_directory, None);
    assert_eq!(invocations[0].normalized_name, "sdk-skill");
    // Content with no frontmatter is all instructions, never a parse failure.
    assert_eq!(invocations[0].frontmatter_tokens, Some(0));
    assert!(invocations[0].instruction_tokens.unwrap() > 0);
}

#[test]
fn nameless_events_are_dropped() {
    let invocations = extract(vec![invoked(
        "00:00:04",
        json!({"name": "  ", "path": "/x/SKILL.md", "content": SKILL_BODY}),
    )]);

    assert!(invocations.is_empty());
}

#[test]
fn the_same_content_fingerprints_identically_across_line_endings() {
    let unix = extract(vec![invoked(
        "00:00:04",
        json!({"name": "pdf", "path": "/p/SKILL.md", "content": "---\nname: pdf\n---\nBody."}),
    )]);
    let windows = extract(vec![invoked(
        "00:00:04",
        json!({"name": "pdf", "path": "/p/SKILL.md",
               "content": "---\r\nname: pdf\r\n---\r\nBody.\r\n"}),
    )]);

    assert_eq!(unix[0].content_sha256, windows[0].content_sha256);
}

#[test]
fn invocations_are_ordered_by_event_index() {
    let invocations = extract(vec![
        invoked(
            "00:00:04",
            json!({"name": "a", "path": "/a/SKILL.md", "content": SKILL_BODY}),
        ),
        skill_call("00:00:05", "tc-2", "b"),
        call_complete("00:00:06", "tc-2"),
        invoked(
            "00:00:07",
            json!({"name": "c", "path": "/c/SKILL.md", "content": SKILL_BODY}),
        ),
    ]);

    let names: Vec<&str> = invocations
        .iter()
        .map(|invocation| invocation.name.as_str())
        .collect();
    assert_eq!(names, ["a", "b", "c"]);
    assert!(
        invocations
            .windows(2)
            .all(|pair| pair[0].event_index < pair[1].event_index)
    );
}

#[test]
fn an_empty_session_extracts_nothing() {
    let no_runs: Vec<AgentRun> = Vec::new();
    assert!(extract_skill_invocations(&[], &[], &no_runs).is_empty());
}

/// Locks the payload the newest CLI writes, captured from a real 2026-09-20
/// session. Every field the extractor reads is present, and the unread
/// `allowedTools` is carried along to prove an added field is ignored rather
/// than fatal. A future CLI that renames one of these should fail here.
#[test]
fn the_current_cli_payload_is_read_in_full() {
    let invocations = extract(vec![invoked(
        "00:00:04",
        json!({
            "name": "hyperframes-animation",
            "path": "C:\\Users\\a\\.copilot\\skills\\hyperframes-animation\\SKILL.md",
            "content": SKILL_BODY,
            "allowedTools": [],
            "source": "personal-copilot",
            "pluginName": null,
            "pluginVersion": null,
            "description": "All animation knowledge for HyperFrames",
            "trigger": "agent-invoked",
            "model": "mai-code-1.1-flash"
        }),
    )]);

    assert_eq!(invocations.len(), 1);
    let invocation = &invocations[0];
    assert_eq!(invocation.name, "hyperframes-animation");
    assert_eq!(invocation.trigger.as_deref(), Some("agent-invoked"));
    assert_eq!(invocation.source.as_deref(), Some("personal-copilot"));
    assert_eq!(
        invocation.description.as_deref(),
        Some("All animation knowledge for HyperFrames")
    );
    assert_eq!(invocation.model.as_deref(), Some("mai-code-1.1-flash"));
    assert_eq!(invocation.plugin_name, None);
    assert_eq!(
        invocation.normalized_directory.as_deref(),
        Some("c:/users/a/.copilot/skills/hyperframes-animation")
    );
    assert!(
        invocation
            .instruction_tokens
            .is_some_and(|tokens| tokens > 0)
    );
}

/// The oldest payload in the local corpus carries only a name, a path and
/// content. It must still produce a row, with the absent fields absent rather
/// than guessed.
#[test]
fn an_older_cli_payload_still_produces_a_row() {
    let invocations = extract(vec![invoked(
        "00:00:04",
        json!({
            "name": "frontend-design",
            "path": "/skills/frontend-design/SKILL.md",
            "content": SKILL_BODY
        }),
    )]);

    assert_eq!(invocations.len(), 1);
    let invocation = &invocations[0];
    assert_eq!(invocation.name, "frontend-design");
    assert_eq!(invocation.trigger, None, "never inferred as user-invoked");
    assert_eq!(invocation.model, None);
    assert_eq!(invocation.source, None);
    assert!(invocation.content_sha256.is_some(), "content still hashed");
}

/// The newest CLI also emits `skill.context_delivered_ref` beside
/// `skill.invoked`. It describes the same delivery, so counting it would
/// double every modern invocation.
#[test]
fn a_context_delivered_ref_is_not_a_second_invocation() {
    let invocations = extract(vec![
        invoked(
            "00:00:04",
            json!({"name": "pdf", "path": "/p/SKILL.md", "content": SKILL_BODY}),
        ),
        event(
            "skill.context_delivered_ref",
            "00:00:05",
            json!({
                "interactionId": "abc",
                "source": "skill-pdf",
                "contentId": "sha256:deadbeef",
                "prefix": "<skill-context name='pdf'>",
                "suffix": "</skill-context>"
            }),
        ),
    ]);

    assert_eq!(invocations.len(), 1);
    assert_eq!(invocations[0].name, "pdf");
}
