// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Markdown exports of Claude Code sessions say what the app's conversation
//! says: a rate limit is a warning labelled "Rate limit", and a finished
//! subagent keeps the description it was launched with.

use tracepilot_core::SessionId;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{SessionProvider, SessionSource};
use tracepilot_export::options::{ExportFormat, ExportOptions};
use tracepilot_export::{ExportInput, ProviderSession, export_inputs};
use tracepilot_test_support::claude::{SESSION_ID, SessionFiles};
use tracepilot_test_support::claude_scenarios::{compaction_cycle, subagents};

fn export_markdown(files: &SessionFiles) -> String {
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
    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_inputs(&[input], &options).unwrap();
    files[0].as_text().unwrap().to_string()
}

/// A usage limit is waited out, so it reads as a warning, as the session
/// card, Overview and Analytics count it, with its reset time kept.
#[test]
fn rate_limits_read_as_warnings() {
    let output = export_markdown(&compaction_cycle());

    assert!(
        output.contains("> 🟡 **Rate limit**: You've hit your session limit · resets 8pm\n"),
        "{output}"
    );
    assert!(
        output.contains(
            "| session.error | warning | Rate limit: You've hit your session limit · resets 8pm |"
        ),
        "{output}"
    );
    assert!(!output.contains("🔴"), "{output}");
    assert!(!output.contains("| session.error | error |"), "{output}");
}

/// A subagent is renamed to its agent when it starts; its row is still
/// summarized by the description it was launched with.
#[test]
fn finished_subagents_keep_their_description() {
    let output = export_markdown(&subagents());

    let rows: Vec<&str> = output
        .lines()
        .filter(|line| line.starts_with("| 🤖 "))
        .collect();
    // The fourth agent was launched by no call, so it has nothing to show.
    assert_eq!(
        rows,
        [
            "| 🤖 Explore | ✅ | 9s | indexer · claude-opus-5-5 · 700 tok · 3 calls |",
            "| 🤖 Explore | ⏳ | — | indexer tests · claude-haiku-4-5-20251001 |",
            "| 🤖 Agent | ✅ | 9s | exporter · claude-opus-5-5 · 300 tok · 3 calls |",
            "| 🤖 subagent | ⏳ | — | — · claude-opus-5-5 |",
        ],
        "{output}"
    );
}
