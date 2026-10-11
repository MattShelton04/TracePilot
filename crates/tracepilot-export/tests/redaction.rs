// Fixtures and diagnostic executables fail fast on invalid setup.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::print_stdout,
    clippy::print_stderr
)]
//! Redaction integration tests.

use std::collections::HashSet;
use std::fs;

use serde_json::json;
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

#[test]
fn redaction_covers_subagent_descriptions_in_exports() {
    let (dir, _) = workspace_only_temp_dir(full_workspace_yaml());
    let description = concat!(
        r"Review C:\Users\synthetic\repo for synthetic-owner@example.com using ",
        "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"
    );
    let redacted_description = "Review <REDACTED_PATH> for <REDACTED_EMAIL> using <REDACTED_TOKEN>";
    let records = [
        json!({"type":"user.message","id":"user","timestamp":"2026-03-10T10:00:00Z","data":{"content":"Review the upload client"}}),
        json!({"type":"tool.execution_start","id":"start","parentId":"user","timestamp":"2026-03-10T10:00:01Z","data":{"toolCallId":"agent-call","toolName":"task","arguments":{"description":description,"prompt":"Review the client","agent_type":"explore"}}}),
        json!({"type":"subagent.started","id":"agent","parentId":"start","timestamp":"2026-03-10T10:00:01Z","data":{"toolCallId":"agent-call","agentName":"Explore","agentDisplayName":"Explore","agentDescription":description}}),
        json!({"type":"tool.execution_complete","id":"complete","parentId":"agent","timestamp":"2026-03-10T10:00:02Z","data":{"toolCallId":"agent-call","success":true,"result":{"content":"Reviewed."}}}),
        json!({"type":"assistant.message","id":"assistant","parentId":"complete","timestamp":"2026-03-10T10:00:03Z","data":{"content":"Review complete."}}),
    ];
    let events = records
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(dir.path().join("events.jsonl"), events).unwrap();

    let mut leaks = Vec::new();
    for redact in [false, true] {
        let expected = if redact {
            redacted_description
        } else {
            description
        };
        for format in [ExportFormat::Json, ExportFormat::Markdown] {
            let mut options = ExportOptions::all(format);
            options.redaction = RedactionOptions {
                anonymize_paths: redact,
                strip_secrets: redact,
                strip_pii: redact,
            };
            let files = export_session(dir.path(), &options).unwrap();
            let output = files[0].as_text().unwrap();
            let description_matches = if format == ExportFormat::Json {
                let archive: SessionArchive = serde_json::from_str(output).unwrap();
                let tool = &archive.sessions[0].conversation.as_ref().unwrap()[0].tool_calls[0];
                assert_eq!(tool.arguments.as_ref().unwrap()["description"], expected);
                assert_eq!(archive.export_options.redaction_applied, redact);
                tool.agent_description.as_deref() == Some(expected)
            } else {
                output.contains(&format!("\n{expected}\n"))
            };
            if redact {
                if !description_matches
                    || output.contains("synthetic-owner@example.com")
                    || output.contains("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij")
                {
                    leaks.push(format);
                }
            } else {
                assert!(description_matches, "{format:?}: description changed");
            }
        }
    }
    assert!(
        leaks.is_empty(),
        "Description redaction failed in {leaks:?}"
    );
}
