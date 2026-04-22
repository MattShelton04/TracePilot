//! Wall-clock timeout policy for captured child processes.
//!
//! These helpers spawn a child with stdout/stderr piped, drain both pipes
//! on background threads, and either return the final [`Output`] or kill
//! the child and return [`OrchestratorError::Timeout`].

use crate::error::{OrchestratorError, Result};
use std::io::Read;
use std::process::{Child, Command, Output};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;
use tokio::io::AsyncReadExt;

/// Internal helper: spawn a command with stdout/stderr piped.
pub(super) fn spawn_captured_child(mut cmd: Command, program: &str) -> Result<Child> {
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    cmd.spawn()
        .map_err(|e| OrchestratorError::launch_ctx(format!("Failed to spawn {program}"), e))
}

fn read_pipe_to_end<R>(mut reader: R, label: &'static str) -> mpsc::Receiver<Result<Vec<u8>>>
where
    R: Read + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let result = reader
            .read_to_end(&mut buf)
            .map(|_| buf)
            .map_err(|e| OrchestratorError::launch_ctx(format!("Failed to read {label}"), e));
        // best-effort: caller may have timed out and dropped the receiver.
        let _: std::result::Result<(), std::sync::mpsc::SendError<_>> = tx.send(result);
    });
    rx
}

/// Core timeout implementation: execute a spawned child process with a wall-clock timeout.
///
/// This function handles:
/// - Async stdout/stderr reading via background threads
/// - Shared child process ownership for timeout-based kill
/// - Timeout detection via `recv_timeout()`
///
/// Returns `(stdout, stderr, status)` on success, or an error if:
/// - The child process cannot be waited on (mutex poison, wait failure)
/// - Pipe reader threads disconnect
/// - The process exceeds `timeout_secs`
///
/// On timeout, attempts to kill the child and logs any kill failures.
pub(super) fn execute_with_timeout(
    mut child: Child,
    timeout_secs: u64,
) -> std::result::Result<(Vec<u8>, Vec<u8>, std::process::ExitStatus), OrchestratorError> {
    // Take the pipe handles before wrapping the child so the thread owns them.
    // Return an error if pipes weren't configured (defensive programming - should never happen).
    let stdout_pipe = child.stdout.take().ok_or_else(|| {
        OrchestratorError::Launch("stdout not piped: process was not configured correctly".into())
    })?;
    let stderr_pipe = child.stderr.take().ok_or_else(|| {
        OrchestratorError::Launch("stderr not piped: process was not configured correctly".into())
    })?;
    let stdout_rx = read_pipe_to_end(stdout_pipe, "stdout");
    let stderr_rx = read_pipe_to_end(stderr_pipe, "stderr");

    // Wrap child in Arc<Mutex> so the main thread can kill it on timeout.
    let child_shared = Arc::new(Mutex::new(child));
    let child_for_thread = Arc::clone(&child_shared);

    let (tx, rx) = mpsc::channel::<
        std::result::Result<(Vec<u8>, Vec<u8>, std::process::ExitStatus), OrchestratorError>,
    >();

    std::thread::spawn(move || {
        let result = child_for_thread
            .lock()
            .map_err(|_| OrchestratorError::Launch("mutex poisoned".into()))
            .and_then(|mut c| {
                c.wait()
                    .map_err(|e| OrchestratorError::launch_ctx("wait failed", e))
            })
            .and_then(|status| {
                let stdout = stdout_rx.recv().map_err(|_| {
                    OrchestratorError::Launch("stdout reader thread disconnected".into())
                })??;
                let stderr = stderr_rx.recv().map_err(|_| {
                    OrchestratorError::Launch("stderr reader thread disconnected".into())
                })??;
                Ok((stdout, stderr, status))
            });
        // best-effort: if the main thread has already hit recv_timeout, the
        // receiver will be dropped and this send becomes a no-op.
        let _: std::result::Result<(), std::sync::mpsc::SendError<_>> = tx.send(result);
    });

    match rx.recv_timeout(Duration::from_secs(timeout_secs)) {
        Ok(result) => result,
        Err(_) => {
            // Timeout occurred - attempt to kill the process
            if let Ok(mut child) = child_shared.lock()
                && let Err(e) = child.kill()
            {
                tracing::warn!("Failed to kill timed-out process: {}", e);
            }
            Err(OrchestratorError::Timeout { secs: timeout_secs })
        }
    }
}

pub(super) fn run_with_timeout(
    cmd: Command,
    program: &str,
    args: &[&str],
    timeout_secs: u64,
) -> Result<Output> {
    let child = spawn_captured_child(cmd, program)?;

    match execute_with_timeout(child, timeout_secs) {
        Ok((stdout, stderr, status)) => Ok(Output {
            status,
            stdout,
            stderr,
        }),
        Err(e) => {
            // Enhance timeout error with command context
            if let OrchestratorError::Timeout { secs } = &e {
                let cmd_display = if args.is_empty() {
                    program.to_string()
                } else {
                    format!("{} {}", program, args.join(" "))
                };
                Err(OrchestratorError::Launch(format!(
                    "Command timed out after {secs}s: {cmd_display}. \
                     Check system resources and try again."
                )))
            } else {
                Err(e)
            }
        }
    }
}

/// Async variant: spawn a [`tokio::process::Command`] with a wall-clock
/// timeout and per-stream capture caps. Designed for async "hidden" probe
/// launch sites (e.g. `bridge::discovery`) where the probed process may
/// misbehave (hang, flood stdout) and must not be allowed to hang the
/// caller nor exhaust memory.
///
/// Policy:
/// - stdout/stderr are piped with `std::process::Stdio::piped()`.
/// - Each stream is drained with an `AsyncReadExt::take(max_bytes)` limit,
///   so a hostile child that writes unbounded output cannot OOM us —
///   excess bytes remain buffered in the kernel pipe until the child is
///   reaped (or killed on drop).
/// - `kill_on_drop(true)` is set so that if the timeout fires (or the
///   caller's task is cancelled) the spawned child is terminated rather
///   than orphaned.
/// - The returned error is `ErrorKind::TimedOut` when the wall-clock
///   deadline expires; other errors propagate from spawn / IO.
pub(crate) async fn run_async_with_limits(
    mut cmd: tokio::process::Command,
    timeout: Duration,
    max_bytes: u64,
) -> std::io::Result<(Vec<u8>, Vec<u8>, std::process::ExitStatus)> {
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let fut = async move {
        let mut child = cmd.spawn()?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| std::io::Error::other("stdout not piped"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| std::io::Error::other("stderr not piped"))?;

        // Drain both pipes concurrently with per-stream caps. The inner
        // block owns the `Take`-wrapped readers; when the cap fires (or
        // the child closes the pipes), the block exits and drops those
        // readers, which drops the underlying `ChildStdout`/`ChildStderr`
        // and closes our read ends of the pipes. Any child wedged trying
        // to write past the cap then unblocks with EPIPE / ERROR_BROKEN_PIPE
        // and exits, allowing `child.wait()` below to complete promptly.
        let mut out_buf: Vec<u8> = Vec::new();
        let mut err_buf: Vec<u8> = Vec::new();
        let (o_res, e_res) = {
            let mut stdout_capped = stdout.take(max_bytes);
            let mut stderr_capped = stderr.take(max_bytes);
            tokio::join!(
                stdout_capped.read_to_end(&mut out_buf),
                stderr_capped.read_to_end(&mut err_buf),
            )
        };
        o_res?;
        e_res?;
        let status = child.wait().await?;
        std::io::Result::Ok((out_buf, err_buf, status))
    };

    match tokio::time::timeout(timeout, fut).await {
        Ok(r) => r,
        Err(_) => Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            format!("command timed out after {:?}", timeout),
        )),
    }
}
