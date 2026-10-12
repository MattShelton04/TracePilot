// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Keep the exported wire bytes and hash stable as allocation paths change.

use serde_json::json;
use sha2::{Digest, Sha256};
use tracepilot_core::SessionId;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{SessionProvider, SessionSource};
use tracepilot_export::builder::{build_archive, build_session_archive};
use tracepilot_export::render::json::JsonRenderer;
use tracepilot_export::{
    ExportFormat, ExportInput, ExportOptions, ExportRenderer, ProviderSession,
};
use tracepilot_test_support::claude::{
    OPUS, SESSION_ID, Transcript, Usage, text, tool_use, write_session,
};
use tracepilot_test_support::fixtures::full_session_temp_dir;

#[test]
fn json_matches_original_serialization_including_hash_without_mutating_input() {
    let (dir, _) = full_session_temp_dir();
    let mut archive = build_session_archive(dir.path(), &ExportOptions::default()).unwrap();
    archive.sessions[0].extensions = Some(json!({
        "long": "quoted \"line\"\n— α \\ ".repeat(8192),
        "nested": [null, {}, [], {"float": 1.25, "boolean": true}],
    }));
    archive.sessions.push(archive.sessions[0].clone());
    archive.header.content_hash = Some("stale hash to replace only in the output".into());
    let before = serde_json::to_vec_pretty(&archive).unwrap();

    // The original renderer hashed a separate pretty sessions buffer and
    // deep-cloned the archive before replacing its header. This is the format
    // contract: object order, pretty whitespace, Unicode and escapes all count.
    let mut original = archive.clone();
    original.header.content_hash = Some(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec_pretty(&archive.sessions).unwrap())
    ));
    let expected = serde_json::to_vec_pretty(&original).unwrap();
    let rendered = JsonRenderer.render(&archive).unwrap();
    assert_eq!(rendered[0].content, expected);
    assert_eq!(serde_json::to_vec_pretty(&archive).unwrap(), before);
}

#[test]
fn provider_cached_and_reconstructed_turns_export_identically() {
    let mut transcript = Transcript::main();
    transcript.prompt("Review the synthetic module.");
    transcript.call(
        "msg_1",
        OPUS,
        vec![tool_use(
            "tool_1",
            "Read",
            json!({"file_path": "src/demo.rs"}),
        )],
        Usage::new(2, 4, 6, 8),
        "tool_use",
    );
    transcript.user(json!({"message": {"role": "user", "content": [{
        "type": "tool_result", "tool_use_id": "tool_1", "content": "code\n".repeat(1024)
    }]}}));
    transcript.call(
        "msg_2",
        OPUS,
        vec![text("Looks correct.")],
        Usage::new(2, 4, 6, 8),
        "end_turn",
    );
    let files = write_session(&transcript, &[]);
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .unwrap();
    let mut snapshot = provider.load_snapshot(&locator, false, &|| false).unwrap();
    let artifacts = provider.artifacts(&locator).unwrap();
    let build = |snapshot: &tracepilot_core::provider::ProviderSnapshot,
                 options: &ExportOptions| {
        build_archive(
            &[ExportInput::Provider(ProviderSession {
                source: SessionSource::ClaudeCode,
                snapshot,
                artifacts: &artifacts,
            })],
            options,
        )
        .unwrap()
    };
    for full_results in [false, true] {
        let mut options = ExportOptions::all(ExportFormat::Json);
        options.content_detail.include_full_tool_results = full_results;
        let cached = build(&snapshot, &options);
        let saved = snapshot.turns.take();
        let reconstructed = build(&snapshot, &options);
        snapshot.turns = saved;
        assert_eq!(
            serde_json::to_value(&cached.sessions).unwrap(),
            serde_json::to_value(&reconstructed.sessions).unwrap()
        );
    }
}
