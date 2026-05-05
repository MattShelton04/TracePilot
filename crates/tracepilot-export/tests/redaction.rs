//! Redaction integration tests.

use std::collections::HashSet;
use std::fs;

use tracepilot_export::document::{SectionId, SessionArchive};
use tracepilot_export::options::*;
use tracepilot_export::*;
use tracepilot_test_support::fixtures::{full_workspace_yaml, workspace_only_temp_dir};

#[test]
fn redaction_covers_system_messages() {
    let (dir, _) = workspace_only_temp_dir(full_workspace_yaml());

    let events = concat!(
        r#"{"type":"session.start","data":{"sessionId":"test-session-id","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main","repository":"user/repo","hostType":"cli"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
        "\n",
        r#"{"type":"system.message","data":{"content":"You are a coding assistant. Working directory: C:\\git\\TracePilot","role":"system"},"id":"evt-2","timestamp":"2026-03-10T07:14:50.900Z","parentId":"evt-1"}"#,
        "\n",
        r#"{"type":"user.message","data":{"content":"Hello","interactionId":"int-1","attachments":[]},"id":"evt-3","timestamp":"2026-03-10T07:14:51.000Z","parentId":"evt-2"}"#,
        "\n",
        r#"{"type":"assistant.turn_start","data":{"turnId":"turn-1","interactionId":"int-1"},"id":"evt-4","timestamp":"2026-03-10T07:14:51.100Z","parentId":"evt-3"}"#,
        "\n",
        r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"Hi!","interactionId":"int-1"},"id":"evt-5","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-4"}"#,
        "\n",
        r#"{"type":"assistant.turn_end","data":{"turnId":"turn-1"},"id":"evt-6","timestamp":"2026-03-10T07:14:53.000Z","parentId":"evt-4"}"#,
        "\n",
    );
    fs::write(dir.path().join("events.jsonl"), events).unwrap();

    let options = ExportOptions {
        format: ExportFormat::Json,
        sections: {
            let mut s = HashSet::new();
            s.insert(SectionId::Conversation);
            s
        },
        output: OutputTarget::String,
        content_detail: ContentDetailOptions::default(),
        redaction: RedactionOptions {
            anonymize_paths: true,
            strip_secrets: false,
            strip_pii: false,
        },
    };

    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    let turns = session
        .conversation
        .as_ref()
        .expect("conversation should be present");
    assert!(!turns.is_empty(), "should have at least one turn");

    let first_turn = &turns[0];
    assert!(
        !first_turn.system_messages.is_empty(),
        "system_messages should be populated"
    );
    for msg in &first_turn.system_messages {
        assert!(
            !msg.contains(r"C:\git\TracePilot"),
            "system_messages path was not redacted: {msg}"
        );
    }
    assert!(archive.export_options.redaction_applied);
}
