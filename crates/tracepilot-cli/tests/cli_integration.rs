//! CLI integration tests — verify export and import commands work end-to-end.

use std::fs;
use std::path::Path;
use std::process::Command;

fn cli_binary() -> Command {
    Command::new(env!("CARGO_BIN_EXE_tracepilot-export"))
}

fn full_workspace_yaml() -> &'static str {
    r#"id: cli-test-session
cwd: /home/user/projects/myapp
repository: user/repo
branch: main
summary: "CLI test session"
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
}

fn sample_events_jsonl() -> &'static str {
    concat!(
        r#"{"type":"session.start","data":{"sessionId":"cli-test-session","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main","repository":"user/repo","hostType":"cli"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
        "\n",
        r#"{"type":"user.message","data":{"content":"Hello","interactionId":"int-1","attachments":[]},"id":"evt-2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"evt-1"}"#,
        "\n",
        r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"Hi!","interactionId":"int-1"},"id":"evt-3","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-2"}"#,
        "\n",
        r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":1,"totalApiDurationMs":1000,"sessionStartTime":1773270552854,"currentModel":"claude-opus-4.6","codeChanges":{"linesAdded":0,"linesRemoved":0,"filesModified":[]},"modelMetrics":{"claude-opus-4.6":{"requests":{"count":1,"cost":0},"usage":{"inputTokens":100,"outputTokens":50,"cacheReadTokens":0,"cacheWriteTokens":0}}}},"id":"evt-4","timestamp":"2026-03-10T07:15:00.000Z","parentId":null}"#,
        "\n",
    )
}

fn create_session(dir: &Path) {
    fs::write(dir.join("workspace.yaml"), full_workspace_yaml()).unwrap();
    fs::write(dir.join("events.jsonl"), sample_events_jsonl()).unwrap();
    fs::write(dir.join("plan.md"), "# Plan\n\n- Build core\n").unwrap();
}

// ── Export Tests ─────────────────────────────────────────────────────────────

#[test]
fn export_json_to_file() {
    let dir = tempfile::tempdir().unwrap();
    create_session(dir.path());

    let output_path = dir.path().join("out.tpx.json");
    let status = cli_binary()
        .args([
            "export",
            &dir.path().to_string_lossy(),
            "-f", "json",
            "-o", &output_path.to_string_lossy(),
        ])
        .status()
        .expect("failed to run CLI");

    assert!(status.success(), "export command failed");
    assert!(output_path.exists(), "output file not created");

    let content = fs::read_to_string(&output_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert!(parsed["header"]["schemaVersion"]["major"].as_u64().is_some());
    assert!(parsed["sessions"].as_array().unwrap().len() > 0);
}

#[test]
fn export_markdown_preview() {
    let dir = tempfile::tempdir().unwrap();
    create_session(dir.path());

    let output = cli_binary()
        .args([
            "export",
            &dir.path().to_string_lossy(),
            "-f", "markdown",
            "--preview",
        ])
        .output()
        .expect("failed to run CLI");

    assert!(output.status.success(), "export preview failed");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("# Session:"), "missing session header");
    assert!(stdout.contains("## Plan"), "missing plan section");
}

#[test]
fn export_csv_creates_files() {
    let dir = tempfile::tempdir().unwrap();
    create_session(dir.path());

    let output_path = dir.path().join("events.csv");
    let status = cli_binary()
        .args([
            "export",
            &dir.path().to_string_lossy(),
            "-f", "csv",
            "-o", &output_path.to_string_lossy(),
        ])
        .status()
        .expect("failed to run CLI");

    assert!(status.success(), "csv export failed");
    assert!(output_path.exists(), "csv file not created");
}

#[test]
fn export_section_filtering() {
    let dir = tempfile::tempdir().unwrap();
    create_session(dir.path());

    let output = cli_binary()
        .args([
            "export",
            &dir.path().to_string_lossy(),
            "-f", "json",
            "--preview",
            "-s", "plan",
        ])
        .output()
        .expect("failed to run CLI");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let session = &parsed["sessions"][0];
    assert!(session["plan"].is_string(), "plan should be included");
    assert!(session["conversation"].is_null(), "conversation should be excluded");
}

#[test]
fn export_with_redaction() {
    let dir = tempfile::tempdir().unwrap();
    create_session(dir.path());

    let output = cli_binary()
        .args([
            "export",
            &dir.path().to_string_lossy(),
            "-f", "json",
            "--preview",
            "--redact-paths",
        ])
        .output()
        .expect("failed to run CLI");

    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let cwd = parsed["sessions"][0]["metadata"]["cwd"]
        .as_str()
        .unwrap_or("");
    assert!(
        cwd.contains("REDACTED") || cwd.is_empty(),
        "path should be redacted, got: {cwd}",
    );
}

// ── Help / Arg Validation Tests ────────────────────────────────────────────

#[test]
fn help_flag_exits_zero() {
    let status = cli_binary()
        .arg("--help")
        .status()
        .expect("failed to run CLI");
    assert!(status.success());
}

#[test]
fn export_help_flag_exits_zero() {
    let status = cli_binary()
        .args(["export", "--help"])
        .status()
        .expect("failed to run CLI");
    assert!(status.success());
}

#[test]
fn import_help_flag_exits_zero() {
    let status = cli_binary()
        .args(["import", "--help"])
        .status()
        .expect("failed to run CLI");
    assert!(status.success());
}

#[test]
fn invalid_format_fails() {
    let dir = tempfile::tempdir().unwrap();
    create_session(dir.path());

    let status = cli_binary()
        .args([
            "export",
            &dir.path().to_string_lossy(),
            "-f", "docx",
            "--preview",
        ])
        .status()
        .expect("failed to run CLI");

    assert!(!status.success(), "should fail on invalid format");
}

#[test]
fn invalid_section_fails() {
    let dir = tempfile::tempdir().unwrap();
    create_session(dir.path());

    let status = cli_binary()
        .args([
            "export",
            &dir.path().to_string_lossy(),
            "--preview",
            "-s", "nonexistent",
        ])
        .status()
        .expect("failed to run CLI");

    assert!(!status.success(), "should fail on invalid section");
}
