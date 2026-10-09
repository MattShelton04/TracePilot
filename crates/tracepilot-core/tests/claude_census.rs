#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Q3 format census: the report counts drift and names it, but never repeats
//! a path, an id or any content from the transcripts it read.

use serde_json::json;
use tracepilot_core::provider::SessionProvider;
use tracepilot_core::provider::claude_code::{ClaudeCodeProvider, format_census};
use tracepilot_test_support::claude::{
    OPUS, SESSION_ID, Subagent, Transcript, Usage, subagent_meta, text, tool_use, write_session,
};

/// Strings planted in the synthetic transcripts that must never be reported.
const PRIVATE: &[&str] = &[
    SESSION_ID,
    "C:\\work\\demo",
    "C--work-demo",
    "PRIVATE-PROMPT-TEXT",
    "PRIVATE-ANSWER-TEXT",
    "PRIVATE-KEY-MATERIAL",
    "private-user",
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "agent-a1b2c3",
    "msg_private",
];

#[test]
fn census_reports_drift_without_paths_ids_or_content() {
    let mut main = Transcript::main();
    main.prompt("PRIVATE-PROMPT-TEXT in C:\\Users\\private-user\\repo");
    main.call(
        "msg_private_1",
        OPUS,
        vec![
            text("PRIVATE-ANSWER-TEXT"),
            tool_use(
                "toolu_private",
                "Agent",
                json!({"prompt": "PRIVATE-PROMPT-TEXT"}),
            ),
        ],
        Usage::new(1, 0, 0, 1),
        "tool_use",
    );
    // New record types: one named like a type, one shaped like a path, one an id.
    main.record("brand-new-record", json!({"note": "PRIVATE-PROMPT-TEXT"}));
    main.record("/home/private-user/PRIVATE-PROMPT-TEXT", json!({}));
    main.record("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", json!({}));
    // New attachment types: one named like a type, one that is content.
    main.record(
        "attachment",
        json!({"attachment": {"type": "brand_new_attachment", "content": "PRIVATE-ANSWER-TEXT"}}),
    );
    main.record(
        "attachment",
        json!({"attachment": {"type": "PRIVATE-ANSWER-TEXT and more words"}}),
    );
    // A newer Claude Code version, and one that is not a version.
    main.record(
        "system",
        json!({"subtype": "informational", "content": "x", "version": "2.2.0-beta.1"}),
    );
    main.record(
        "system",
        json!({"subtype": "informational", "content": "x", "version": "C:\\Users\\private-user"}),
    );
    let mut child = Transcript::subagent("a1b2c3", 1);
    child.prompt("PRIVATE-PROMPT-TEXT");
    child.record("subagent-only-record", json!({}));
    let files = write_session(
        &main,
        &[Subagent {
            agent_id: "a1b2c3",
            transcript: &child,
            meta: Some(subagent_meta("toolu_private", "general-purpose", 1)),
        }],
    );
    // A live-session key file the census must never read.
    let sessions = files.root.path().join("sessions");
    std::fs::create_dir_all(&sessions).unwrap();
    std::fs::write(sessions.join("4242.key"), "PRIVATE-KEY-MATERIAL").unwrap();

    let census = format_census(files.root.path()).unwrap();
    let report = census.render();

    assert_eq!(census.sessions, 1);
    for expected in [
        "| brand-new-record | 1 | 1 |",
        "| subagent-only-record | 1 | 1 |",
        "| (unrecognized name) | 1 | 2 |",
        "| brand_new_attachment | 1 | 1 |",
        "| 2.1.280 | 1 |",
        "| 2.2.0-beta.1 | 1 | 1 |",
        "| (unrecognized version) | 1 | 1 |",
    ] {
        assert!(
            report.contains(expected),
            "missing {expected:?} in:\n{report}"
        );
    }
    // The attachment that is content is counted under the placeholder too.
    assert_eq!(
        census.unmapped_attachment_types["(unrecognized name)"].records,
        1
    );
    let root = files.root.path().to_string_lossy().to_string();
    let lower = report.to_lowercase();
    for private in PRIVATE.iter().copied().chain([root.as_str()]) {
        assert!(
            !lower.contains(&private.to_lowercase()),
            "report repeats {private:?}:\n{report}"
        );
    }
    assert!(!lower.contains("private"), "report:\n{report}");
    assert!(
        !report.contains('\\') && !report.contains('/'),
        "report:\n{report}"
    );
}

#[test]
fn census_of_indexed_sessions_matches_the_snapshot_observations() {
    let mut main = Transcript::main();
    main.prompt("hello");
    main.record("brand-new-record", json!({}));
    let files = write_session(&main, &[]);
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider.discover(&|| false).unwrap().remove(0);
    let snapshot = provider.load_snapshot(&locator, true, &|| false).unwrap();
    let format = snapshot.format.expect("Claude reports format observations");
    assert_eq!(format.unmapped_record_types["brand-new-record"], 1);
    assert_eq!(format.versions["2.1.280"], 2);

    let census = format_census(files.root.path()).unwrap();
    assert_eq!(census.unmapped_record_types["brand-new-record"].records, 1);
    assert_eq!(census.versions["2.1.280"].records, 2);
}
