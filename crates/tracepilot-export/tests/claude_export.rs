// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Claude Code export: sessions load through the provider, carry their
//! source, lose the private record fields of data-comparison.md §5, and are
//! refused by import.

use serde_json::json;
use tracepilot_core::SessionId;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{SessionProvider, SessionSource};
use tracepilot_export::document::SessionArchive;
use tracepilot_export::import::{ImportOptions, import_sessions, preview_import};
use tracepilot_export::options::{ExportFormat, ExportOptions, RedactionOptions};
use tracepilot_export::{ExportInput, ProviderSession, export_inputs, preview_export_input};
use tracepilot_test_support::claude::{
    OPUS, SESSION_ID, SessionFiles, Transcript, Usage, text, tool_use, write_session,
};
use tracepilot_test_support::fixtures::full_session_temp_dir;

/// Every private value below contains this marker.
const PRIVATE: &str = "PRIVATE";
const EMAIL: &str = "private-user@example.com";
/// A secret in tool output, which only the user's secret redaction removes.
const TOKEN: &str = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB";

/// A session holding one of each private record kind, beside ordinary content.
fn session_with_private_records() -> SessionFiles {
    let mut t = Transcript::main();
    t.record(
        "attachment",
        json!({
            "attachment": {"type": "session_context", "context": {"userEmail": EMAIL}},
            "rendered": [format!("{PRIVATE} context for {EMAIL}")],
        }),
    );
    t.record(
        "attachment",
        json!({"attachment": {"type": "credential_org", "organizationUuid": "PRIVATE-org"}}),
    );
    t.record(
        "attachment",
        json!({"attachment": {"type": "prompt_snapshot", "systemPrompt": "PRIVATE system prompt",
            "tools": ["PRIVATE tool list"]}}),
    );
    t.record(
        "attachment",
        json!({"attachment": {"type": "nested_memory", "path": "C:\\work\\demo\\CLAUDE.md",
            "content": "PRIVATE instructions"}}),
    );
    t.bookkeeping(
        json!({"type": "bridge-session", "ownerAccountUuid": "PRIVATE-account",
        "ownerOrgUuid": "PRIVATE-org-2"}),
    );
    t.bookkeeping(json!({"type": "frame-link", "frameUrl": "https://remote.example/PRIVATE"}));
    t.bookkeeping(json!({"type": "artifact-autoreact-ledger", "accountUuid": "PRIVATE-ledger"}));
    t.system(
        "bridge_status",
        json!({"url": "https://remote.example/PRIVATE-bridge",
            "content": "Remote control at https://remote.example/PRIVATE-bridge"}),
    );

    t.prompt("Add a retry to the upload client.");
    let usage = Usage::new(10, 1000, 200, 50);
    t.call(
        "msg_01",
        OPUS,
        vec![tool_use("toolu_01", "Bash", json!({"command": "npm test"}))],
        usage,
        "tool_use",
    );
    t.user(json!({
        "message": {"role": "user", "content": [{"type": "tool_result",
            "tool_use_id": "toolu_01", "is_error": false, "content": format!("ok {TOKEN}")}]},
        "toolUseResult": {"stdout": format!("ok {TOKEN}\n"), "stderr": "", "interrupted": false,
            "isImage": false},
        "wireToolInputs": {"command": "PRIVATE duplicate input"},
        "bashEditDiff": "PRIVATE duplicate diff",
    }));
    t.record(
        "assistant",
        json!({"isApiErrorMessage": true, "error": "rate_limit", "apiErrorStatus": 429,
            "quotaLimits": {"plan": "PRIVATE-plan"},
            "message": {"id": "msg_err", "model": "<synthetic>", "role": "assistant",
                "stop_reason": "stop_sequence",
                "content": [{"type": "text", "text": "You've hit your session limit"}],
                "usage": {"input_tokens": 0, "output_tokens": 0,
                    "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}}),
    );
    t.call(
        "msg_02",
        OPUS,
        vec![text("Added the retry.")],
        usage,
        "end_turn",
    );
    t.cost_state(&[(OPUS, usage, 0.25)]);
    write_session(&t, &[])
}

/// Export the fixture session through the Claude Code provider.
fn export_claude(files: &SessionFiles, format: ExportFormat) -> String {
    export_claude_with(files, &ExportOptions::all(format))
}

fn export_claude_with(files: &SessionFiles, options: &ExportOptions) -> String {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .expect("fixture session resolves");
    let snapshot = provider.load_snapshot(&locator, false, &|| false).unwrap();
    let artifacts = provider.artifacts(&locator).unwrap();

    // The private values reach the snapshot; export must drop them.
    let records = serde_json::to_string(
        &snapshot
            .events
            .as_ref()
            .unwrap()
            .iter()
            .map(|e| &e.raw)
            .collect::<Vec<_>>(),
    )
    .unwrap();
    assert!(records.contains(PRIVATE) && records.contains(EMAIL));

    let input = ExportInput::Provider(ProviderSession {
        source: locator.source,
        snapshot: &snapshot,
        artifacts: &artifacts,
    });
    let preview = preview_export_input(&input, options, None).unwrap();
    let files = export_inputs(std::slice::from_ref(&input), options).unwrap();
    let output = files[0].as_text().unwrap().to_string();
    assert!(!preview.contains(PRIVATE) && !preview.contains(EMAIL));
    output
}

#[test]
fn json_export_carries_the_source_and_drops_private_fields() {
    let files = session_with_private_records();
    let output = export_claude(&files, ExportFormat::Json);

    assert!(!output.contains(PRIVATE), "a private value leaked");
    assert!(!output.contains(EMAIL), "the email leaked");
    assert!(output.contains("[redacted by TracePilot]"));
    assert!(output.contains(r#""source": "claudeCode""#));

    let archive: SessionArchive = serde_json::from_str(&output).unwrap();
    let session = &archive.sessions[0];
    assert_eq!(session.metadata.id, SESSION_ID);
    assert_eq!(session.metadata.source, SessionSource::ClaudeCode);

    // Ordinary content survives.
    let turns = session.conversation.as_ref().unwrap();
    assert_eq!(
        turns[0].user_message.as_deref(),
        Some("Add a retry to the upload client.")
    );
    assert!(output.contains("npm test"));
    // Unmapped records stay as Events-tab records, with their bodies redacted.
    let events = session.events.as_ref().unwrap();
    let prompt = events
        .iter()
        .find(|e| e.event_type == "attachment:prompt_snapshot")
        .expect("prompt snapshot record kept");
    assert_eq!(prompt.data["attachment"]["type"], "prompt_snapshot");
    assert_eq!(
        prompt.data["attachment"]["systemPrompt"],
        "[redacted by TracePilot]"
    );
    // Provider totals become the metrics section.
    let metrics = session.shutdown_metrics.as_ref().expect("metrics");
    assert_eq!(metrics.cost_amount, Some(0.25));
}

#[test]
fn user_redaction_covers_the_source_records() {
    let files = session_with_private_records();
    let mut options = ExportOptions::all(ExportFormat::Json);
    options.redaction = RedactionOptions {
        anonymize_paths: true,
        strip_secrets: true,
        strip_pii: true,
    };
    let output = export_claude_with(&files, &options);

    // Every record repeats the tool output and the working directory.
    // As JSON escapes it.
    let path = r"C:\\work\\demo";
    assert!(!output.contains(TOKEN), "the token leaked");
    assert!(!output.contains(path), "a path leaked");
    let unredacted = export_claude(&files, ExportFormat::Json);
    assert!(unredacted.contains(TOKEN) && unredacted.contains(path));
}

#[test]
fn markdown_export_names_the_source() {
    let files = session_with_private_records();
    let output = export_claude(&files, ExportFormat::Markdown);

    assert!(output.contains("| Source | Claude Code |"));
    assert!(output.contains("Add a retry to the upload client."));
    assert!(!output.contains(PRIVATE));
    assert!(!output.contains(EMAIL));
}

#[test]
fn import_refuses_claude_sessions() {
    let files = session_with_private_records();
    let output = export_claude(&files, ExportFormat::Json);
    let dir = tempfile::tempdir().unwrap();
    let archive_path = dir.path().join("claude.tpx.json");
    std::fs::write(&archive_path, output).unwrap();
    let target = dir.path().join("session-state");

    let preview = preview_import(&archive_path, Some(&target)).unwrap();
    assert!(!preview.can_import);
    assert!(
        preview
            .issues
            .iter()
            .any(|issue| issue.is_error() && issue.message.contains("Claude Code"))
    );

    let result = import_sessions(&archive_path, &target, &ImportOptions::default());
    assert!(result.is_err());
    assert!(!target.join(SESSION_ID).exists());
}

#[test]
fn mixed_batch_keeps_copilot_sessions_unlabelled() {
    let claude = session_with_private_records();
    let provider = ClaudeCodeProvider::new(claude.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .unwrap();
    let snapshot = provider.load_snapshot(&locator, false, &|| false).unwrap();
    let artifacts = provider.artifacts(&locator).unwrap();
    let (copilot, _) = full_session_temp_dir();

    let inputs = [
        ExportInput::Directory(copilot.path()),
        ExportInput::Provider(ProviderSession {
            source: SessionSource::ClaudeCode,
            snapshot: &snapshot,
            artifacts: &artifacts,
        }),
    ];
    let files = export_inputs(&inputs, &ExportOptions::all(ExportFormat::Json)).unwrap();
    let output = files[0].as_text().unwrap();

    let value: serde_json::Value = serde_json::from_str(output).unwrap();
    assert!(value["sessions"][0]["metadata"].get("source").is_none());
    assert_eq!(value["sessions"][1]["metadata"]["source"], "claudeCode");
    let archive: SessionArchive = serde_json::from_str(output).unwrap();
    assert_eq!(archive.sessions[0].metadata.source, SessionSource::Copilot);
    assert_eq!(
        archive.sessions[1].metadata.source,
        SessionSource::ClaudeCode
    );
}

/// A session with a plan, a file-history backup, a persisted tool result and
/// a subagent folder. Only the backup and tool-result files hold their
/// markers; the transcript never does.
fn session_with_side_files() -> SessionFiles {
    let mut t = Transcript::main();
    let prompt = t.prompt("Plan the retry.");
    let backup = |name: &str| {
        json!({"backupFileName": name, "version": 1,
            "backupTime": "2026-09-20T10:00:00.000Z", "realParentDir": "C:\\work\\demo\\src"})
    };
    t.bookkeeping(json!({"type": "file-history-snapshot", "messageId": prompt,
        "isSnapshotUpdate": false, "snapshot": {"messageId": prompt,
            "timestamp": "2026-09-20T10:00:00.000Z",
            "trackedFileBackups": {"src/upload.ts": backup("0123456789abcdef@v1")}}}));
    t.bookkeeping(json!({"type": "file-history-delta",
        "messageId": "00000000-0000-4000-8000-00000000d001", "snapshotMessageId": prompt,
        "trackingPath": "src/retry.ts", "backup": backup("fedcba9876543210@v1"),
        "timestamp": "2026-09-20T10:00:05.000Z"}));
    let usage = Usage::new(10, 1000, 200, 50);
    let plan = format!("# Plan\n\n1. Retry uploads.\n2. Rotate {TOKEN}.");
    t.call(
        "msg_plan",
        OPUS,
        vec![tool_use(
            "toolu_plan",
            "ExitPlanMode",
            json!({"plan": plan}),
        )],
        usage,
        "tool_use",
    );
    t.tool_result(
        "toolu_plan",
        json!("User approved the plan."),
        json!({"plan": plan, "isAgent": false}),
        false,
    );
    t.call("msg_done", OPUS, vec![text("Planned.")], usage, "end_turn");
    let files = write_session(&t, &[]);
    let config = files.root.path();
    let history = config.join("file-history").join(SESSION_ID);
    std::fs::create_dir_all(&history).unwrap();
    std::fs::write(history.join("0123456789abcdef@v1"), "BACKUP-CONTENT\n").unwrap();
    std::fs::write(
        history.join("fedcba9876543210@v1"),
        "DELTA-BACKUP-CONTENT\n",
    )
    .unwrap();
    let results = files.main.with_extension("").join("tool-results");
    std::fs::create_dir_all(&results).unwrap();
    std::fs::write(results.join("toolu_big.txt"), "TOOL-RESULT-CONTENT\n").unwrap();
    files
}

/// The plan exports like Copilot's `plan.md`, under the user's redaction;
/// file-history backups and Explorer files never leave the machine.
#[test]
fn side_files_stay_out_of_export_and_the_plan_is_redacted() {
    let files = session_with_side_files();
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .unwrap();
    let snapshot = provider.load_snapshot(&locator, false, &|| false).unwrap();
    let artifacts = provider.artifacts(&locator).unwrap();
    let history = artifacts.file_history.as_ref().expect("file history");
    assert!(history.contains("0123456789abcdef@v1") && history.contains("fedcba9876543210@v1"));
    assert_eq!(artifacts.file_roots.len(), 2);
    let input = ExportInput::Provider(ProviderSession {
        source: SessionSource::ClaudeCode,
        snapshot: &snapshot,
        artifacts: &artifacts,
    });
    let export = |options: &ExportOptions| {
        let files = export_inputs(std::slice::from_ref(&input), options).unwrap();
        files[0].as_text().unwrap().to_string()
    };

    for format in [ExportFormat::Json, ExportFormat::Markdown] {
        let output = export(&ExportOptions::all(format));
        assert!(
            output.contains("Retry uploads."),
            "{format:?}: the plan is exported"
        );
        assert!(
            !output.contains("BACKUP-CONTENT"),
            "{format:?}: a backup leaked"
        );
        assert!(
            !output.contains("TOOL-RESULT-CONTENT"),
            "{format:?}: a tool result leaked"
        );
    }
    let archive: SessionArchive =
        serde_json::from_str(&export(&ExportOptions::all(ExportFormat::Json))).unwrap();
    assert!(archive.sessions[0].checkpoints.is_none());

    let mut options = ExportOptions::all(ExportFormat::Json);
    options.redaction.strip_secrets = true;
    let archive: SessionArchive = serde_json::from_str(&export(&options)).unwrap();
    let plan = archive.sessions[0].plan.as_deref().expect("plan section");
    assert!(
        plan.contains("Retry uploads.") && !plan.contains(TOKEN),
        "{plan}"
    );
}

/// A plan recorded in the transcript is capped like the plan view.
#[test]
fn inline_plans_are_capped_in_export() {
    let mut t = Transcript::main();
    t.prompt("Plan it.");
    let plan = format!("# Plan\n\n{}", "x".repeat(80 * 1024));
    t.call(
        "msg_plan",
        OPUS,
        vec![tool_use(
            "toolu_plan",
            "ExitPlanMode",
            json!({"plan": plan}),
        )],
        Usage::new(1, 1, 1, 1),
        "tool_use",
    );
    let files = write_session(&t, &[]);
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .unwrap();
    let snapshot = provider.load_snapshot(&locator, false, &|| false).unwrap();
    let artifacts = provider.artifacts(&locator).unwrap();
    let input = ExportInput::Provider(ProviderSession {
        source: SessionSource::ClaudeCode,
        snapshot: &snapshot,
        artifacts: &artifacts,
    });
    let files = export_inputs(&[input], &ExportOptions::all(ExportFormat::Json)).unwrap();
    let archive: SessionArchive = serde_json::from_str(files[0].as_text().unwrap()).unwrap();
    let exported = archive.sessions[0].plan.as_deref().expect("plan section");
    assert!(exported.starts_with("# Plan") && exported.len() == 50 * 1024);
}
