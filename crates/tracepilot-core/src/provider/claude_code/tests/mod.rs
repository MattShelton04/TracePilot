//! Parser tests over the synthetic sessions in
//! `tracepilot_test_support::claude_scenarios`.

mod accounting;
mod artifacts;
mod background;
mod model_calls;
mod provider;
mod scenarios;
mod summary;
mod tools;

use std::collections::HashSet;

use tracepilot_test_support::claude::SessionFiles;
use tracepilot_test_support::claude_scenarios as fixtures;

use super::{ClaudeParse, parse_claude_session};
use crate::models::ConversationTurn;
use crate::parsing::events::{RawEvent, events_to_jsonl, parse_typed_events};
use crate::turns::reconstruct_turns;

pub(super) fn parse(files: &SessionFiles) -> ClaudeParse {
    parse_claude_session(&files.main, &|| false).expect("parse fixture")
}

pub(super) fn user_turns(turns: &[ConversationTurn]) -> Vec<&ConversationTurn> {
    turns.iter().filter(|t| t.user_message.is_some()).collect()
}

pub(super) fn event_types(parse: &ClaudeParse) -> Vec<&str> {
    parse
        .events
        .iter()
        .map(|e| e.raw.event_type.as_str())
        .collect()
}

fn all_fixtures() -> Vec<(&'static str, SessionFiles)> {
    vec![
        ("tool_hazards", fixtures::tool_hazards()),
        ("meta_records", fixtures::meta_records(false)),
        ("meta_records_idle", fixtures::meta_records(true)),
        ("subagents", fixtures::subagents()),
        ("rewind_fork", fixtures::rewind_fork()),
        ("interrupted_and_live", fixtures::interrupted_and_live()),
        ("damaged_lines", fixtures::damaged_lines()),
        ("compaction_cycle", fixtures::compaction_cycle()),
        ("resumed_ended", fixtures::resumed(false)),
        ("resumed_running", fixtures::resumed(true)),
        ("slash_command", fixtures::slash_command()),
        ("typed_compact", fixtures::typed_compact()),
        ("commands_only", fixtures::commands_only()),
        ("tool_catalog", fixtures::tool_catalog()),
    ]
}

/// Serialize → parse → reconstruct gives the same turns as the direct path,
/// for every fixture: `raw.data` is canonical.
#[test]
fn reparsed_events_reconstruct_identical_turns() {
    for (name, files) in all_fixtures() {
        let parsed = parse(&files);
        let raws: Vec<&RawEvent> = parsed.events.iter().map(|e| &e.raw).collect();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, events_to_jsonl(&raws)).unwrap();
        let reparsed = parse_typed_events(&path).unwrap();
        assert_eq!(reparsed.diagnostics.malformed_lines, 0, "{name}");
        assert_eq!(reparsed.events.len(), parsed.events.len(), "{name}");
        for (a, b) in parsed.events.iter().zip(&reparsed.events) {
            assert_eq!(a.raw.native, b.raw.native, "{name}: native record lost");
        }
        let direct = serde_json::to_value(reconstruct_turns(&parsed.events)).unwrap();
        let again = serde_json::to_value(reconstruct_turns(&reparsed.events)).unwrap();
        assert_eq!(direct, again, "{name}: turns differ after a round trip");
    }
}

#[test]
fn ids_are_unique_stable_and_natives_align() {
    for (name, files) in all_fixtures() {
        let first = parse(&files);
        let second = parse(&files);
        assert_eq!(first.positions.len(), first.events.len(), "{name}");
        for (event, position) in first.events.iter().zip(&first.positions) {
            assert_eq!(event.raw.native.is_some(), position.is_some(), "{name}");
        }
        let ids: Vec<_> = first
            .events
            .iter()
            .map(|e| e.raw.id.clone().unwrap())
            .collect();
        let mut unique = HashSet::new();
        for id in &ids {
            assert!(unique.insert(id), "{name}: duplicate event id {id}");
        }
        let again: Vec<_> = second
            .events
            .iter()
            .map(|e| e.raw.id.clone().unwrap())
            .collect();
        assert_eq!(ids, again, "{name}: ids changed between parses");
        // Every parentId names an earlier event.
        let mut seen = HashSet::new();
        for event in &first.events {
            if let Some(parent) = &event.raw.parent_id {
                assert!(seen.contains(parent), "{name}: dangling parent {parent}");
            }
            seen.insert(event.raw.id.clone().unwrap());
        }
    }
}

#[test]
fn no_image_base64_survives_anywhere() {
    // tool_catalog adds image Reads and a shell whose stdout is an image.
    for (files, images) in [(fixtures::tool_hazards(), 2), (fixtures::tool_catalog(), 4)] {
        let parsed = parse(&files);
        assert!(parsed.diagnostics.sanitized_images >= images);
        let raws: Vec<&RawEvent> = parsed.events.iter().map(|e| &e.raw).collect();
        let natives: Vec<_> = parsed
            .events
            .iter()
            .filter_map(|e| e.raw.native.as_ref())
            .map(|n| n.data.to_string())
            .collect();
        assert!(!natives.is_empty());
        let haystacks = [
            events_to_jsonl(&raws),
            natives.join("\n"),
            format!("{:?}", parsed.diagnostics),
            format!("{:?}", parsed.events),
            format!("{:?}", reconstruct_turns(&parsed.events)),
        ];
        for haystack in haystacks {
            assert!(!haystack.contains(fixtures::IMAGE_BASE64));
        }
    }
}

#[test]
fn cancellation_mid_file_stops_with_interrupted() {
    let files = fixtures::tool_hazards();
    let calls = std::cell::Cell::new(0);
    let result = parse_claude_session(&files.main, &|| {
        calls.set(calls.get() + 1);
        calls.get() > 5
    });
    let error = result.expect_err("cancelled parse must fail");
    assert!(error.to_string().contains("cancelled"), "{error}");
}

#[test]
fn malformed_middle_line_and_partial_utf8_tail_are_counted_not_fatal() {
    let parsed = parse(&fixtures::damaged_lines());
    assert_eq!(parsed.diagnostics.malformed_lines, 1);
    assert_eq!(parsed.diagnostics.partial_tails, 1);
    assert_eq!(parsed.diagnostics.events.malformed_lines, 1);
    let turns = reconstruct_turns(&parsed.events);
    assert_eq!(user_turns(&turns).len(), 1);
    assert_eq!(turns.last().unwrap().assistant_messages[0].content, "Hi.");
}

#[test]
fn missing_main_file_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    assert!(parse_claude_session(&dir.path().join("missing.jsonl"), &|| false).is_err());
}
