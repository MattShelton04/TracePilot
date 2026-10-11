//! `load_events_strict` skips the summary but loads and refuses exactly what a
//! strict `load_snapshot` does.

use std::fs::OpenOptions;
use std::io::Write;

use tracepilot_test_support::claude::{OPUS, SessionFiles, Transcript, Usage, text, write_session};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::super::ClaudeCodeProvider;
use super::super::reader::MAX_LINE_BYTES;
use crate::parsing::events::events_to_jsonl;
use crate::provider::SessionProvider;

fn assert_same_as_strict_snapshot(files: &SessionFiles) {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    let snapshot = provider.load_snapshot(&session, true, &|| false).unwrap();
    let loaded = provider.load_events_strict(&session, &|| false).unwrap();
    let raw = |events: &Option<Vec<crate::parsing::events::TypedEvent>>| {
        let events = events.as_ref().expect("events");
        let raw: Vec<_> = events.iter().map(|event| &event.raw).collect();
        (events.len(), events_to_jsonl(&raw))
    };
    assert_eq!(raw(&loaded.events), raw(&snapshot.events));
    assert_eq!(loaded.fingerprint, snapshot.fingerprint);
}

#[test]
fn events_and_fingerprint_match_a_strict_snapshot() {
    for files in [
        fixtures::tool_hazards(),
        fixtures::subagents(),
        fixtures::compaction_cycle(),
        fixtures::rewind_fork(),
        fixtures::notification_wake(),
        fixtures::agent_follow_ups(),
    ] {
        assert_same_as_strict_snapshot(&files);
    }
}

#[test]
fn refuses_damaged_and_oversized_transcripts() {
    let files = fixtures::damaged_lines();
    let provider = ClaudeCodeProvider::new(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    assert!(provider.load_snapshot(&session, true, &|| false).is_err());
    assert!(provider.load_events_strict(&session, &|| false).is_err());

    let mut t = Transcript::main();
    t.prompt(&"x".repeat(MAX_LINE_BYTES));
    t.call(
        "msg_o1",
        OPUS,
        vec![text("Done.")],
        Usage::new(1, 0, 0, 1),
        "end_turn",
    );
    let files = write_session(&t, &[]);
    let provider = ClaudeCodeProvider::new(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    assert!(provider.load_events_strict(&session, &|| false).is_err());
}

#[test]
fn refuses_a_partial_last_line() {
    let files = fixtures::tool_hazards();
    let mut file = OpenOptions::new().append(true).open(&files.main).unwrap();
    file.write_all(br#"{"type":"user","uuid":"#).unwrap();
    drop(file);
    let provider = ClaudeCodeProvider::new(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    assert!(provider.load_snapshot(&session, true, &|| false).is_err());
    assert!(provider.load_events_strict(&session, &|| false).is_err());
}

#[test]
fn stops_when_cancelled() {
    let files = fixtures::subagents();
    let provider = ClaudeCodeProvider::new(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    assert!(provider.load_events_strict(&session, &|| true).is_err());
}

#[test]
fn refuses_a_transcript_that_changes_while_it_is_read() {
    let files = fixtures::tool_hazards();
    let provider = ClaudeCodeProvider::new(files.root.path());
    let session = provider.discover(&|| false).unwrap().remove(0);
    // The first poll precedes the fingerprint; later ones run while reading.
    let polls = std::cell::Cell::new(0);
    let result = provider.load_events_strict(&session, &|| {
        polls.set(polls.get() + 1);
        if polls.get() == 2 {
            let mut file = OpenOptions::new().append(true).open(&files.main).unwrap();
            file.write_all(b"{\"type\":\"system\",\"subtype\":\"note\"}\n")
                .unwrap();
        }
        false
    });
    let Err(error) = result else {
        panic!("a changed source must be refused");
    };
    let error = error.to_string();
    assert!(error.contains("changed while reading"), "{error}");
}
