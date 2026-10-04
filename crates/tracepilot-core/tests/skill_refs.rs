// Fixtures and diagnostic executables fail fast on invalid setup.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::print_stdout,
    clippy::print_stderr
)]
//! Deduplicated skill receipts as persisted by Copilot CLI 1.0.91: the first
//! invocation is inline, the repeat is `skill.invoked_ref`, and each is
//! followed by a `skill.context_delivered_ref` wrapping the shared body.

use std::path::PathBuf;
use tracepilot_core::parsing::events::{TypedEventData, parse_typed_events};
use tracepilot_core::skill_invocations::{SkillInvocationOrigin, extract_skill_invocations};
use tracepilot_core::turns::reconstruct_turns;

const BODY: &str = "# Probe notes\n\nWhen asked for the probe codeword, answer exactly: TANGERINE-42.\nDo not read any other files.\n";

fn parsed() -> tracepilot_core::parsing::events::ParsedEvents {
    parse_typed_events(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/versions/v1_0_91_skill_refs.jsonl"),
    )
    .unwrap()
}

#[test]
fn references_resolve_to_the_inline_body() {
    let parsed = parsed();
    assert!(parsed.diagnostics.unknown_event_types.is_empty());
    assert!(parsed.diagnostics.deserialization_failures.is_empty());
    let resolved: Vec<_> = parsed
        .events
        .iter()
        .filter_map(|event| match &event.typed_data {
            TypedEventData::SkillInvokedRef(data) => data.resolved_content.as_deref(),
            TypedEventData::SkillContextDeliveredRef(data) => data.resolved_content.as_deref(),
            _ => None,
        })
        .collect();
    assert_eq!(resolved, [BODY, BODY, BODY]);
}

#[test]
fn repeated_invocation_attaches_to_its_skill_tool_call() {
    let events = parsed().events;
    let wrapper = events
        .iter()
        .find_map(|event| match &event.typed_data {
            TypedEventData::SkillContextDeliveredRef(data) => data.delivered_content(),
            _ => None,
        })
        .unwrap();
    assert!(wrapper.starts_with("<skill-context name=\"probe-notes\">"));
    assert!(wrapper.ends_with(&format!("{BODY}\n</skill-context>")));
    let turns = reconstruct_turns(&events);
    let skills: Vec<_> = turns
        .iter()
        .flat_map(|turn| &turn.tool_calls)
        .filter(|call| call.tool_name == "skill")
        .map(|call| call.skill_invocation.as_ref().expect("invocation attached"))
        .collect();
    assert_eq!(skills.len(), 2);
    for skill in skills {
        assert_eq!(skill.name.as_deref(), Some("probe-notes"));
        assert_eq!(skill.content.as_deref(), Some(BODY));
        assert!(skill.context_folded);
        assert_eq!(skill.context_length, Some(wrapper.chars().count()));
    }
    assert!(
        turns
            .iter()
            .flat_map(|turn| &turn.session_events)
            .all(|event| event.skill_invocation.is_none()),
        "attached invocations must not also appear as standalone rows"
    );
}

#[test]
fn analytics_counts_both_invocations_with_their_body() {
    let events = parsed().events;
    let turns = reconstruct_turns(&events);
    let invocations = extract_skill_invocations(&events, &turns, &[]);
    assert_eq!(invocations.len(), 2);
    assert!(
        invocations
            .iter()
            .all(|i| i.origin == SkillInvocationOrigin::Event)
    );
    assert!(invocations[0].content_sha256.is_some());
    assert_eq!(invocations[0].content_sha256, invocations[1].content_sha256);
    assert_eq!(
        invocations[0].instruction_tokens,
        invocations[1].instruction_tokens
    );
    assert!(invocations[1].path.is_some());
}
