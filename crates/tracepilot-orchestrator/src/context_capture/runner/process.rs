use super::super::listener::{CapturedRequest, OneShotListener};
use super::super::{CAPTURE_TIMEOUT_SECS, MAX_PROCESS_STREAM_BYTES};
use super::Cancellation;
use super::environment::capture_process_environment;
use crate::error::{OrchestratorError, Result};
use crate::process::{hidden_command, hidden_std_command};
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tracepilot_core::context_capture::CaptureProtocol;

#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_copilot(
    executable: &str,
    session_id: Option<&str>,
    probe: &str,
    isolated_home: &Path,
    working_directory: &Path,
    base_url: &str,
    protocol: CaptureProtocol,
    model: &str,
) -> Result<tokio::process::Child> {
    let dummy_key = format!("tracepilot-capture-{}", uuid::Uuid::new_v4().simple());
    let mut command = hidden_command(executable);
    command.env_clear().envs(capture_process_environment());
    if let Some(session_id) = session_id {
        command.arg(format!("--resume={session_id}"));
    }
    command
        .arg(format!("--prompt={probe}"))
        .arg("--output-format=json")
        .arg("--allow-all-tools")
        .arg("--no-ask-user")
        .arg("--no-auto-update")
        .arg("--no-remote")
        .arg("--no-remote-export")
        .arg("--secret-env-vars=COPILOT_PROVIDER_API_KEY,OPENAI_API_KEY,ANTHROPIC_API_KEY")
        .current_dir(working_directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .env("COPILOT_HOME", isolated_home)
        .env("COPILOT_PROVIDER_BASE_URL", base_url)
        .env("COPILOT_MODEL", model)
        .env("COPILOT_PROVIDER_MODEL_ID", model)
        .env("COPILOT_PROVIDER_WIRE_MODEL", model)
        .env("COPILOT_PROVIDER_API_KEY", &dummy_key)
        .env("OPENAI_API_KEY", &dummy_key)
        .env("ANTHROPIC_API_KEY", &dummy_key)
        .env("COPILOT_OFFLINE", "true")
        .env("COPILOT_AUTO_UPDATE", "false")
        .env("NO_PROXY", "127.0.0.1,localhost,[::1]")
        .env("no_proxy", "127.0.0.1,localhost,[::1]");
    match protocol {
        CaptureProtocol::OpenAiChatCompletions => {
            command
                .env("COPILOT_PROVIDER_TYPE", "openai")
                .env("COPILOT_PROVIDER_WIRE_API", "completions");
        }
        CaptureProtocol::OpenAiResponses => {
            command
                .env("COPILOT_PROVIDER_TYPE", "openai")
                .env("COPILOT_PROVIDER_WIRE_API", "responses");
        }
        CaptureProtocol::AnthropicMessages => {
            command.env("COPILOT_PROVIDER_TYPE", "anthropic");
            command.env_remove("COPILOT_PROVIDER_WIRE_API");
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    command.spawn().map_err(|error| {
        OrchestratorError::ContextCapture(format!(
            "Failed to start the isolated Copilot CLI: {error}"
        ))
    })
}

pub(super) async fn wait_for_request(
    listener: &mut OneShotListener,
    child: &mut tokio::process::Child,
    cancellation: &Cancellation,
) -> Result<CapturedRequest> {
    let timeout = tokio::time::sleep(Duration::from_secs(CAPTURE_TIMEOUT_SECS));
    tokio::pin!(timeout);
    let mut poll = tokio::time::interval(Duration::from_millis(100));
    loop {
        if cancellation.is_cancelled() {
            return Err(OrchestratorError::ContextCapture(
                "Capture cancelled.".into(),
            ));
        }
        tokio::select! {
            packet = listener.receiver.recv() => {
                return packet.ok_or_else(|| OrchestratorError::ContextCapture("The capture listener closed before receiving a request.".into()));
            }
            _ = cancellation.notify.notified() => {
                return Err(OrchestratorError::ContextCapture("Capture cancelled.".into()));
            }
            _ = &mut timeout => {
                return Err(OrchestratorError::ContextCapture(format!("No model request arrived within {CAPTURE_TIMEOUT_SECS} seconds.")));
            }
            _ = poll.tick() => {
                if let Some(status) = child.try_wait()? {
                    if let Ok(packet) = listener.receiver.try_recv() {
                        return Ok(packet);
                    }
                    return Err(OrchestratorError::ContextCapture(format!(
                        "The isolated Copilot CLI exited before sending a model request (exit {}).",
                        status.code().unwrap_or(-1)
                    )));
                }
            }
        }
    }
}

pub(super) async fn drain_bounded<R>(reader: R)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = reader.take(MAX_PROCESS_STREAM_BYTES);
    let mut buffer = Vec::new();
    let _ = reader.read_to_end(&mut buffer).await;
    // Intentionally discard output: it can contain prompt/context content.
}

pub(super) async fn terminate_process_tree(child: &mut tokio::process::Child) {
    let Some(pid) = child.id() else {
        let _ = child.wait().await;
        return;
    };
    terminate_pid_tree(pid);
    if tokio::time::timeout(Duration::from_secs(2), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

pub(super) struct ProcessTreeGuard {
    pid: Option<u32>,
}

impl ProcessTreeGuard {
    pub(super) fn new(pid: Option<u32>) -> Self {
        Self { pid }
    }

    pub(super) fn disarm(&mut self) {
        self.pid = None;
    }
}

impl Drop for ProcessTreeGuard {
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            // Synchronous and metadata-only so cancellation/app shutdown cannot
            // orphan descendants while an async cleanup future is being dropped.
            terminate_pid_tree(pid);
        }
    }
}

fn terminate_pid_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = hidden_std_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(unix)]
    {
        let group = format!("-{pid}");
        let _ = hidden_std_command("kill")
            .args(["-TERM", "--", &group])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}
