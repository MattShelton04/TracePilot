//! A fixed corpus of synthetic Copilot session directories for golden tests.
//!
//! The corpus combines the [`crate::fixtures`] builders with the synthetic
//! version fixtures in `tracepilot-core/tests/fixtures/versions`, so golden
//! snapshots cover subagents, prompt-cache telemetry, skills and every
//! persistable event type. Directory names are fixed UUIDs, and each
//! `workspace.yaml` id matches its directory, so snapshots are deterministic.

// This module constructs test fixtures; an I/O failure must fail the test at setup.
#![allow(clippy::expect_used)]

use std::fs;
use std::path::{Path, PathBuf};

use crate::fixtures;

/// One session directory in the corpus.
pub struct CorpusSession {
    /// Stable name used for golden file names.
    pub name: &'static str,
    /// Directory name and session id.
    pub id: &'static str,
    /// `workspace.yaml` content, or `None` for a legacy session without one.
    pub workspace_yaml: Option<String>,
    /// `events.jsonl` content, or `None` for a session with no event log yet.
    pub events_jsonl: Option<&'static str>,
    /// Whether to write `plan.md` and a populated `checkpoints/` directory.
    pub artifacts: bool,
}

macro_rules! version_fixture {
    ($file:literal) => {
        include_str!(concat!(
            "../../tracepilot-core/tests/fixtures/versions/",
            $file
        ))
    };
}

fn workspace_for(id: &str, name: &str) -> String {
    format!(
        r#"id: {id}
cwd: /golden/{name}
repository: golden/{name}
branch: main
summary: "Golden {name}"
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
    )
}

/// Every session in the corpus, in a fixed order.
pub fn copilot_corpus() -> Vec<CorpusSession> {
    let versioned = |name, id, events| CorpusSession {
        name,
        id,
        workspace_yaml: Some(workspace_for(id, name)),
        events_jsonl: Some(events),
        artifacts: false,
    };
    vec![
        CorpusSession {
            name: "full",
            id: "00000000-0000-4000-8000-000000000001",
            workspace_yaml: Some(
                fixtures::full_workspace_yaml()
                    .replace("test-session-id", "00000000-0000-4000-8000-000000000001"),
            ),
            events_jsonl: Some(fixtures::sample_events_jsonl()),
            artifacts: true,
        },
        CorpusSession {
            name: "minimal",
            id: "00000000-0000-4000-8000-000000000002",
            workspace_yaml: Some(
                fixtures::minimal_workspace_yaml()
                    .replace("minimal-session", "00000000-0000-4000-8000-000000000002"),
            ),
            events_jsonl: None,
            artifacts: false,
        },
        CorpusSession {
            name: "sparse",
            id: "00000000-0000-4000-8000-000000000003",
            workspace_yaml: Some(
                fixtures::sparse_workspace_yaml()
                    .replace("sparse-session", "00000000-0000-4000-8000-000000000003"),
            ),
            events_jsonl: Some(fixtures::enrichment_events_jsonl()),
            artifacts: false,
        },
        CorpusSession {
            name: "legacy-no-workspace",
            id: "00000000-0000-4000-8000-000000000004",
            workspace_yaml: None,
            events_jsonl: Some(version_fixture!("v1_0_2.jsonl")),
            artifacts: false,
        },
        versioned(
            "v1-0-24",
            "00000000-0000-4000-8000-000000000005",
            version_fixture!("v1_0_24.jsonl"),
        ),
        versioned(
            "agents",
            "00000000-0000-4000-8000-000000000006",
            version_fixture!("v1_0_83_agents.jsonl"),
        ),
        versioned(
            "multiturn",
            "00000000-0000-4000-8000-000000000007",
            version_fixture!("v1_0_83_multiturn.jsonl"),
        ),
        versioned(
            "prompt-cache",
            "00000000-0000-4000-8000-000000000008",
            version_fixture!("v1_0_83_prompt_cache.jsonl"),
        ),
        versioned(
            "agent-messaging",
            "00000000-0000-4000-8000-000000000009",
            version_fixture!("v1_0_88_agent_messaging.jsonl"),
        ),
        versioned(
            "skill-refs",
            "00000000-0000-4000-8000-00000000000a",
            version_fixture!("v1_0_91_skill_refs.jsonl"),
        ),
        versioned(
            "schema-v1-0-91",
            "00000000-0000-4000-8000-00000000000b",
            version_fixture!("schema_v1_0_91.jsonl"),
        ),
    ]
}

/// Write one corpus session under `root` and return its directory.
pub fn write_corpus_session(root: &Path, session: &CorpusSession) -> PathBuf {
    let dir = root.join(session.id);
    fs::create_dir_all(&dir).expect("create corpus session dir");
    if let Some(yaml) = &session.workspace_yaml {
        fs::write(dir.join("workspace.yaml"), yaml).expect("write workspace.yaml");
    }
    if let Some(events) = session.events_jsonl {
        fs::write(dir.join("events.jsonl"), events).expect("write events.jsonl");
    }
    if session.artifacts {
        fs::write(
            dir.join("plan.md"),
            "# Implementation Plan\n\n## Phase 1\n\n- [ ] Build core\n",
        )
        .expect("write plan.md");
        fixtures::create_checkpoints(&dir);
    }
    dir
}

/// Write the whole corpus under `root`, returning each session with its directory.
pub fn write_copilot_corpus(root: &Path) -> Vec<(CorpusSession, PathBuf)> {
    copilot_corpus()
        .into_iter()
        .map(|session| {
            let dir = write_corpus_session(root, &session);
            (session, dir)
        })
        .collect()
}
