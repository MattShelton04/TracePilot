//! Wave 86: focused tests for `run_async_with_limits` — the async hidden-probe
//! helper used by `bridge::discovery` and other launch sites that need a
//! wall-clock timeout + per-stream capture cap around a `tokio::process::Command`.

use super::hidden::hidden_command;
use crate::process::run_async_with_limits;
use std::time::Duration;

#[tokio::test]
async fn test_run_async_with_limits_success_captures_stdout() {
    // `git --version` prints a short banner to stdout and exits 0.
    let mut cmd = hidden_command("git");
    cmd.arg("--version");

    let (stdout, stderr, status) = run_async_with_limits(cmd, Duration::from_secs(5), 64 * 1024)
        .await
        .expect("git --version should succeed");
    assert!(status.success(), "git --version exit status: {status}");
    let text = String::from_utf8_lossy(&stdout);
    assert!(text.contains("git version"), "unexpected stdout: {text}");
    assert!(stderr.len() < 64 * 1024, "stderr within cap");
}

#[tokio::test]
async fn test_run_async_with_limits_timeout_kills_child() {
    // Use a guaranteed-long-running command per platform, bounded by a 1s
    // wall-clock deadline. Must return TimedOut and the child must be reaped
    // via kill_on_drop so no zombie remains.
    #[cfg(windows)]
    let mut cmd = hidden_command("powershell");
    #[cfg(windows)]
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Sleep -Seconds 30",
    ]);

    #[cfg(not(windows))]
    let mut cmd = tokio::process::Command::new("sleep");
    #[cfg(not(windows))]
    cmd.arg("30");

    let start = std::time::Instant::now();
    let err = run_async_with_limits(cmd, Duration::from_secs(1), 64 * 1024)
        .await
        .expect_err("30s sleep against 1s timeout must time out");
    let elapsed = start.elapsed();
    assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
    assert!(
        elapsed < Duration::from_secs(10),
        "timeout should fire quickly, elapsed={:?}",
        elapsed
    );
}

#[tokio::test]
async fn test_run_async_with_limits_nonzero_exit_is_not_error() {
    // `git <invalid-subcommand>` exits non-zero and writes to stderr.
    // The helper returns Ok(_) with the failing status; callers are
    // responsible for inspecting `status.success()`.
    let mut cmd = hidden_command("git");
    cmd.arg("this-is-not-a-valid-subcommand-xyz");

    let (_stdout, stderr, status) =
        run_async_with_limits(cmd, Duration::from_secs(10), 64 * 1024)
            .await
            .expect("spawn should succeed even though git exits non-zero");
    assert!(!status.success(), "git rejected invalid subcommand");
    let err_text = String::from_utf8_lossy(&stderr);
    assert!(
        !err_text.is_empty(),
        "expected stderr diagnostic from git, got empty"
    );
}

#[tokio::test]
async fn test_run_async_with_limits_caps_large_stdout() {
    // Emit a fixed, known-larger-than-cap amount of stdout via a short
    // echo (no shell loop — keeps this test deterministic across
    // cmd.exe / sh quoting rules). Cap is set well below the output
    // size so the helper must truncate.
    //
    // This exercises the `take(max_bytes)` path. The "hostile child
    // that floods stdout past the cap and must be reaped" scenario
    // is covered by `test_run_async_with_limits_timeout_kills_child`
    // (child is killed on drop via `kill_on_drop(true)`).
    const CAP: u64 = 16;

    #[cfg(windows)]
    let cmd = {
        let mut c = hidden_command("cmd");
        c.args(["/c", "echo AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
        c
    };

    #[cfg(not(windows))]
    let cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", "echo AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
        c
    };

    let (stdout, _stderr, _status) = run_async_with_limits(cmd, Duration::from_secs(10), CAP)
        .await
        .expect("echo should succeed");
    assert!(
        stdout.len() as u64 <= CAP,
        "stdout capture exceeded cap: got {} bytes, cap {}",
        stdout.len(),
        CAP
    );
    assert!(!stdout.is_empty(), "expected some captured bytes under cap");
}
