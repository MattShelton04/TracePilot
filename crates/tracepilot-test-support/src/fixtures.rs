//! On-disk session fixtures (`workspace.yaml`, `events.jsonl`, `checkpoints/`)
//! shared by `tracepilot-core` and `tracepilot-export` tests.
//!
//! These helpers used to be duplicated verbatim in both crates; extracting
//! them here keeps the fixture strings in a single source of truth.

use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

/// Sample `workspace.yaml` content with all optional fields populated.
pub fn full_workspace_yaml() -> &'static str {
    r#"id: test-session-id
cwd: /test/project
repository: user/repo
branch: main
summary: "Test session"
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
}

/// Minimal `workspace.yaml` containing only the required `id` field.
pub fn minimal_workspace_yaml() -> &'static str {
    "id: minimal-session\n"
}

/// `workspace.yaml` missing repository/branch/host_type (used for enrichment tests).
pub fn sparse_workspace_yaml() -> &'static str {
    r#"id: sparse-session
cwd: /test/project
summary: "Sparse session"
"#
}

/// Sample `events.jsonl` with a full session lifecycle (start → shutdown).
pub fn sample_events_jsonl() -> &'static str {
    concat!(
        r#"{"type":"session.start","data":{"sessionId":"test-session-id","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main","repository":"user/repo","hostType":"cli"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
        "\n",
        r#"{"type":"user.message","data":{"content":"Hello world","interactionId":"int-1","attachments":[]},"id":"evt-2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"evt-1"}"#,
        "\n",
        r#"{"type":"assistant.turn_start","data":{"turnId":"turn-1","interactionId":"int-1"},"id":"evt-3","timestamp":"2026-03-10T07:14:51.100Z","parentId":"evt-2"}"#,
        "\n",
        r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"Hi there!","interactionId":"int-1"},"id":"evt-4","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-3"}"#,
        "\n",
        r#"{"type":"tool.execution_start","data":{"toolCallId":"tc-1","toolName":"read_file","arguments":{"path":"/test/foo.rs"}},"id":"evt-5","timestamp":"2026-03-10T07:14:52.100Z","parentId":"evt-4"}"#,
        "\n",
        r#"{"type":"tool.execution_complete","data":{"toolCallId":"tc-1","model":"claude-opus-4.6","interactionId":"int-1","success":true,"result":"file contents"},"id":"evt-6","timestamp":"2026-03-10T07:14:52.500Z","parentId":"evt-5"}"#,
        "\n",
        r#"{"type":"assistant.turn_end","data":{"turnId":"turn-1"},"id":"evt-7","timestamp":"2026-03-10T07:14:53.000Z","parentId":"evt-3"}"#,
        "\n",
        r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":1,"totalApiDurationMs":5000,"sessionStartTime":1773270552854,"currentModel":"claude-opus-4.6","codeChanges":{"linesAdded":10,"linesRemoved":2,"filesModified":["/test/foo.rs"]},"modelMetrics":{"claude-opus-4.6":{"requests":{"count":3,"cost":1},"usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":800,"cacheWriteTokens":0}}}},"id":"evt-8","timestamp":"2026-03-10T07:15:00.000Z","parentId":null}"#,
        "\n",
    )
}

/// Events with a `session.start` carrying context but no shutdown.
pub fn enrichment_events_jsonl() -> &'static str {
    concat!(
        r#"{"type":"session.start","data":{"sessionId":"sparse-session","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"feature-x","repository":"org/project","hostType":"vscode"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
        "\n",
        r#"{"type":"user.message","data":{"content":"Hi","interactionId":"int-1"},"id":"evt-2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"evt-1"}"#,
        "\n",
    )
}

/// Write a `checkpoints/` directory with an index and two entries into
/// `session_dir`. Used by both summary and export tests.
pub fn create_checkpoints(session_dir: &Path) {
    let cp_dir = session_dir.join("checkpoints");
    fs::create_dir_all(&cp_dir).expect("create checkpoints dir");
    let index = "| # | Title | File |\n| --- | --- | --- |\n| 1 | Initial setup | cp1.md |\n| 2 | Add auth | cp2.md |\n";
    fs::write(cp_dir.join("index.md"), index).expect("write checkpoints index");
    fs::write(
        cp_dir.join("cp1.md"),
        "# Checkpoint 1\nInitial project setup",
    )
    .expect("write cp1.md");
    fs::write(
        cp_dir.join("cp2.md"),
        "# Checkpoint 2\nAdded authentication",
    )
    .expect("write cp2.md");
}

/// Create a fresh temp directory containing a single `workspace.yaml`
/// populated with `yaml`.
///
/// Returns the `TempDir` guard (which must be kept alive for the duration
/// of the test — dropping it cleans up the directory) and the path to the
/// session directory (equal to `temp_dir.path()`).
///
/// Use this for tests that only care about workspace metadata, where
/// `events.jsonl`/`checkpoints/` would only add noise.
pub fn workspace_only_temp_dir(yaml: &str) -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("create temp dir");
    fs::write(dir.path().join("workspace.yaml"), yaml).expect("write workspace.yaml");
    let path = dir.path().to_path_buf();
    (dir, path)
}

/// Create a fresh temp directory populated by [`create_full_session`] —
/// `workspace.yaml` (full), `events.jsonl`, `plan.md`, and `checkpoints/`.
///
/// Returns the `TempDir` guard and the session path. The guard must be
/// kept alive for the duration of the test.
pub fn full_session_temp_dir() -> (TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("create temp dir");
    create_full_session(dir.path());
    let path = dir.path().to_path_buf();
    (dir, path)
}

/// Write `workspace.yaml`, `events.jsonl`, `plan.md`, and a populated
/// `checkpoints/` directory into `session_dir` — a complete fixture for
/// export pipeline tests.
pub fn create_full_session(session_dir: &Path) {
    fs::write(session_dir.join("workspace.yaml"), full_workspace_yaml())
        .expect("write workspace.yaml");
    fs::write(session_dir.join("events.jsonl"), sample_events_jsonl()).expect("write events.jsonl");
    fs::write(
        session_dir.join("plan.md"),
        "# Implementation Plan\n\n## Phase 1\n\n- [ ] Build core\n",
    )
    .expect("write plan.md");
    create_checkpoints(session_dir);
}
