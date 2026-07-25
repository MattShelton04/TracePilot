use super::listener::{CapturedRequest, OneShotListener};
use super::persistence::{hash_bytes, save_capture};
use super::preflight::{benchmark_preflight, context_capture_preflight};
use super::snapshot::{
    cleanup_stale_scratch, copy_session_tree, set_private_dir_permissions, source_fingerprint,
};
use super::{CAPTURE_TIMEOUT_SECS, MAX_PROCESS_STREAM_BYTES};
use crate::error::{OrchestratorError, Result};
use crate::process::{hidden_command, hidden_std_command};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::sync::{Mutex, Notify};
use tracepilot_core::context_capture::{
    CONTEXT_CAPTURE_SCHEMA_VERSION, CaptureProtocol, CaptureScope, ContextCaptureManifest,
    ContextCaptureSnapshot, FidelityManifest, SourceEventsFingerprint, detect_protocol,
    parse_context_request,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCaptureRequest {
    pub session_id: String,
    pub protocol: CaptureProtocol,
    pub save: bool,
    #[serde(default)]
    pub allow_degraded_fidelity: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BenchmarkProfile {
    IsolatedBaseline,
    CurrentEnvironment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartBenchmarkCaptureRequest {
    pub profile: BenchmarkProfile,
    #[serde(default)]
    pub repository_path: Option<String>,
    pub model: String,
    pub protocol: CaptureProtocol,
    pub save: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureStage {
    Preflight,
    CopyingSession,
    PreparingEnvironment,
    StartingListener,
    ResumingClone,
    WaitingForRequest,
    ParsingSnapshot,
    SavingSnapshot,
    CleaningUp,
    Complete,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureProgress {
    pub capture_id: String,
    pub session_id: String,
    pub stage: CaptureStage,
    pub message: String,
    pub bytes_copied: Option<u64>,
    pub total_bytes: Option<u64>,
    pub cancellable: bool,
}

#[derive(Default)]
pub struct ContextCaptureManager {
    active: Mutex<Option<ActiveCapture>>,
}

#[derive(Clone)]
struct Cancellation {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl Cancellation {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

struct ActiveCapture {
    capture_id: String,
    session_id: String,
    cancellation: Cancellation,
}

impl ContextCaptureManager {
    pub async fn start(
        &self,
        request: StartCaptureRequest,
        session_path: PathBuf,
        cli_command: String,
        tracepilot_home: PathBuf,
        progress: Arc<dyn Fn(CaptureProgress) + Send + Sync>,
    ) -> Result<ContextCaptureSnapshot> {
        let capture_id = uuid::Uuid::new_v4().to_string();
        let cancellation = Cancellation::new();
        {
            let mut active = self.active.lock().await;
            if let Some(existing) = active.as_ref() {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Capture {} is already running for session {}.",
                    existing.capture_id, existing.session_id
                )));
            }
            *active = Some(ActiveCapture {
                capture_id: capture_id.clone(),
                session_id: request.session_id.clone(),
                cancellation: cancellation.clone(),
            });
        }

        let result = run_capture(
            &capture_id,
            &request,
            &session_path,
            &cli_command,
            &tracepilot_home,
            &cancellation,
            &progress,
        )
        .await;
        self.active.lock().await.take();
        if cancellation.is_cancelled() {
            emit(
                &progress,
                &capture_id,
                &request.session_id,
                CaptureStage::Cancelled,
                "Capture cancelled; isolated temporary state was removed.",
                None,
                None,
                false,
            );
        }
        result
    }

    pub async fn start_benchmark(
        &self,
        request: StartBenchmarkCaptureRequest,
        cli_command: String,
        copilot_home: PathBuf,
        tracepilot_home: PathBuf,
        progress: Arc<dyn Fn(CaptureProgress) + Send + Sync>,
    ) -> Result<ContextCaptureSnapshot> {
        let capture_id = uuid::Uuid::new_v4().to_string();
        let session_id = super::BENCHMARK_CAPTURE_COLLECTION_ID.to_string();
        let cancellation = Cancellation::new();
        {
            let mut active = self.active.lock().await;
            if let Some(existing) = active.as_ref() {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Capture {} is already running.",
                    existing.capture_id
                )));
            }
            *active = Some(ActiveCapture {
                capture_id: capture_id.clone(),
                session_id: session_id.clone(),
                cancellation: cancellation.clone(),
            });
        }
        let result = run_benchmark_capture(
            &capture_id,
            &session_id,
            &request,
            &cli_command,
            &copilot_home,
            &tracepilot_home,
            &cancellation,
            &progress,
        )
        .await;
        self.active.lock().await.take();
        if cancellation.is_cancelled() {
            emit(
                &progress,
                &capture_id,
                &session_id,
                CaptureStage::Cancelled,
                "Capture cancelled; temporary state was removed.",
                None,
                None,
                false,
            );
        }
        result
    }

    pub async fn cancel(&self, capture_id: Option<&str>) -> bool {
        let active = self.active.lock().await;
        let Some(active) = active.as_ref() else {
            return false;
        };
        if capture_id.is_some_and(|value| value != active.capture_id) {
            return false;
        }
        active.cancellation.cancel();
        true
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_capture(
    capture_id: &str,
    request: &StartCaptureRequest,
    session_path: &Path,
    cli_command: &str,
    tracepilot_home: &Path,
    cancellation: &Cancellation,
    progress: &Arc<dyn Fn(CaptureProgress) + Send + Sync>,
) -> Result<ContextCaptureSnapshot> {
    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::Preflight,
        "Rechecking session and CLI safety requirements…",
        None,
        None,
        true,
    );
    let preflight = context_capture_preflight(
        &request.session_id,
        session_path,
        cli_command,
        tracepilot_home,
    )?;
    if !preflight.can_capture {
        return Err(OrchestratorError::ContextCapture(
            "Preflight no longer permits capture. Close the source session or update Copilot CLI and retry.".into(),
        ));
    }
    if !preflight.working_directory_exists && !request.allow_degraded_fidelity {
        return Err(OrchestratorError::ContextCapture(
            "The original working directory is missing. Confirm degraded fidelity before capturing.".into(),
        ));
    }
    check_cancelled(cancellation)?;

    let tracepilot_paths = tracepilot_core::paths::TracePilotPaths::from_root(tracepilot_home);
    let scratch_root = tracepilot_paths.context_capture_scratch_dir();
    std::fs::create_dir_all(&scratch_root)?;
    set_private_dir_permissions(&scratch_root)?;
    let _ = cleanup_stale_scratch(&scratch_root, Duration::from_secs(24 * 60 * 60))?;
    let scratch = tempfile::Builder::new()
        .prefix("capture-")
        .tempdir_in(&scratch_root)?;
    set_private_dir_permissions(scratch.path())?;
    std::fs::write(
        scratch.path().join(".tracepilot-context-capture"),
        capture_id,
    )?;
    let isolated_home = scratch.path().join("copilot-home");
    let clone_path = isolated_home
        .join("session-state")
        .join(&request.session_id);
    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::CopyingSession,
        "Copying the inactive session into a private Copilot home…",
        Some(0),
        Some(preflight.source_size_bytes),
        true,
    );
    let (bytes_copied, _) = copy_session_tree(session_path, &clone_path)?;
    let copied_fingerprint = source_fingerprint(
        &tracepilot_core::paths::SessionPaths::from_root(session_path).events_jsonl(),
    )?;
    if copied_fingerprint != preflight.source_events_fingerprint {
        return Err(OrchestratorError::ContextCapture(
            "The source session changed while it was being copied. Wait for the session to become inactive and retry.".into(),
        ));
    }
    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::CopyingSession,
        "Session copy complete.",
        Some(bytes_copied),
        Some(preflight.source_size_bytes),
        true,
    );
    check_cancelled(cancellation)?;

    let fallback_workspace = scratch.path().join("empty-workspace");
    let (working_directory, working_directory_fallback) = if preflight.working_directory_exists {
        (PathBuf::from(&preflight.working_directory), false)
    } else {
        std::fs::create_dir_all(&fallback_workspace)?;
        set_private_dir_permissions(&fallback_workspace)?;
        (fallback_workspace, true)
    };
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let probe = format!(
        "[TracePilot context capture {nonce}]\nDo not call tools. Reply with exactly CAPTURED."
    );
    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::StartingListener,
        "Starting a loopback-only one-shot capture endpoint…",
        None,
        None,
        true,
    );
    let mut listener = OneShotListener::bind(request.protocol, &nonce).await?;
    check_cancelled(cancellation)?;

    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::ResumingClone,
        "Resuming the isolated clone with the fixed capture probe…",
        None,
        None,
        true,
    );
    let mut child = spawn_copilot(
        &preflight.cli.executable,
        Some(&request.session_id),
        &probe,
        &isolated_home,
        &working_directory,
        &listener.base_url,
        request.protocol,
        &preflight.model,
    )?;
    let mut process_tree_guard = ProcessTreeGuard::new(child.id());
    let stdout = child.stdout.take().ok_or_else(|| {
        OrchestratorError::ContextCapture("Copilot stdout was not captured.".into())
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        OrchestratorError::ContextCapture("Copilot stderr was not captured.".into())
    })?;
    let stdout_task = tokio::spawn(drain_bounded(stdout));
    let stderr_task = tokio::spawn(drain_bounded(stderr));
    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::WaitingForRequest,
        "Waiting for one model request. Nothing will be forwarded to a provider.",
        None,
        None,
        true,
    );

    let captured = wait_for_request(&mut listener, &mut child, cancellation).await;
    // Give the HTTP handler a brief opportunity to flush its intentional 400
    // before terminating the disposable CLI process tree.
    tokio::time::sleep(Duration::from_millis(75)).await;
    let retry_seen = listener.retry_seen();
    listener.shutdown().await;
    terminate_process_tree(&mut child).await;
    process_tree_guard.disarm();
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    let captured = captured?;
    if retry_seen {
        return Err(OrchestratorError::ContextCapture(
            "The installed CLI retried after TracePilot's capture-complete sentinel. This CLI/protocol combination is not safe for one-shot capture.".into(),
        ));
    }

    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::ParsingSnapshot,
        "Validating, hashing, and normalizing the captured JSON…",
        None,
        None,
        false,
    );
    let body_json: serde_json::Value = serde_json::from_slice(&captured.body)?;
    let detected = detect_protocol(&captured.path, &body_json).ok_or_else(|| {
        OrchestratorError::ContextCapture(
            "The captured request did not match a supported wire protocol.".into(),
        )
    })?;
    if detected != request.protocol {
        return Err(OrchestratorError::ContextCapture(format!(
            "The CLI posted a {} payload while {} was selected.",
            detected.label(),
            request.protocol.label()
        )));
    }
    let parsed = parse_context_request(request.protocol, &captured.body, &nonce)?;
    let raw_body = String::from_utf8(captured.body).map_err(|_| {
        OrchestratorError::ContextCapture("The captured JSON request was not valid UTF-8.".into())
    })?;
    let final_fingerprint = source_fingerprint(
        &tracepilot_core::paths::SessionPaths::from_root(session_path).events_jsonl(),
    )?;
    if final_fingerprint != preflight.source_events_fingerprint {
        return Err(OrchestratorError::ContextCapture(
            "The source session changed during capture. The captured result was discarded.".into(),
        ));
    }
    let protocol_detection_source = if request.protocol == preflight.protocol {
        preflight.protocol_detection_source.clone()
    } else {
        "user-selected protocol override".to_string()
    };
    let mut warnings = preflight.warnings.clone();
    warnings.push("A synthetic probe was appended after an isolated resume boundary.".into());
    warnings.push("Current CLI, filesystem, repository instructions, and dynamic time wrappers may differ from the original session run.".into());
    warnings.push("The raw body is exact for this capture run; it is not a historical provider-side request or an exact token ledger.".into());
    let manifest = ContextCaptureManifest {
        schema_version: CONTEXT_CAPTURE_SCHEMA_VERSION,
        capture_id: capture_id.to_string(),
        source_session_id: request.session_id.clone(),
        captured_at: Utc::now(),
        source_events_fingerprint: final_fingerprint,
        cli_version: preflight.cli.version,
        capture_profile: "isolated".into(),
        capture_scope: CaptureScope::Session,
        repository_path: None,
        capture_input_sha256: None,
        protocol: request.protocol,
        protocol_detection_source,
        request_path: captured.path,
        content_type: captured.content_type,
        raw_body_sha256: hash_bytes(raw_body.as_bytes()),
        raw_body_bytes: raw_body.len() as u64,
        raw_body_characters: raw_body.chars().count() as u64,
        estimated_tokens: (raw_body.len() as u64).div_ceil(4),
        probe_nonce: nonce,
        fidelity_manifest: FidelityManifest {
            profile: "isolated".into(),
            included_resources: preflight.included_resources,
            omitted_resources: preflight.omitted_resources,
            working_directory: working_directory.to_string_lossy().to_string(),
            working_directory_fallback,
            source_unchanged: true,
        },
        warnings,
        safe_header_names: captured.safe_header_names,
        saved: false,
        parsed,
    };
    let mut snapshot = ContextCaptureSnapshot { manifest, raw_body };
    if request.save {
        emit(
            progress,
            capture_id,
            &request.session_id,
            CaptureStage::SavingSnapshot,
            "Saving exact request bytes to local plaintext storage…",
            None,
            None,
            false,
        );
        snapshot = save_capture(tracepilot_home, &snapshot)?;
    }
    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::CleaningUp,
        "Removing the isolated Copilot home and listener…",
        None,
        None,
        false,
    );
    drop(scratch);
    emit(
        progress,
        capture_id,
        &request.session_id,
        CaptureStage::Complete,
        "Exact captured payload is ready for this capture run.",
        None,
        None,
        false,
    );
    Ok(snapshot)
}

#[allow(clippy::too_many_arguments)]
async fn run_benchmark_capture(
    capture_id: &str,
    collection_id: &str,
    request: &StartBenchmarkCaptureRequest,
    cli_command: &str,
    copilot_home: &Path,
    tracepilot_home: &Path,
    cancellation: &Cancellation,
    progress: &Arc<dyn Fn(CaptureProgress) + Send + Sync>,
) -> Result<ContextCaptureSnapshot> {
    emit(
        progress,
        capture_id,
        collection_id,
        CaptureStage::Preflight,
        "Checking CLI capture support and local storage…",
        None,
        None,
        true,
    );
    let preflight = benchmark_preflight(cli_command, tracepilot_home)?;
    if !preflight.can_capture {
        return Err(OrchestratorError::ContextCapture(
            "The installed CLI or capture storage does not support this benchmark.".into(),
        ));
    }
    let model = request.model.trim();
    if model.is_empty() {
        return Err(OrchestratorError::ContextCapture(
            "A model ID is required for a CLI context benchmark.".into(),
        ));
    }
    check_cancelled(cancellation)?;

    let tracepilot_paths = tracepilot_core::paths::TracePilotPaths::from_root(tracepilot_home);
    let scratch_root = tracepilot_paths.context_capture_scratch_dir();
    std::fs::create_dir_all(&scratch_root)?;
    set_private_dir_permissions(&scratch_root)?;
    let _ = cleanup_stale_scratch(&scratch_root, Duration::from_secs(24 * 60 * 60))?;
    let scratch = tempfile::Builder::new()
        .prefix("capture-")
        .tempdir_in(&scratch_root)?;
    set_private_dir_permissions(scratch.path())?;
    std::fs::write(
        scratch.path().join(".tracepilot-context-capture"),
        capture_id,
    )?;

    let isolated_home = scratch.path().join("copilot-home");
    std::fs::create_dir_all(&isolated_home)?;
    set_private_dir_permissions(&isolated_home)?;
    let empty_workspace = scratch.path().join("empty-workspace");
    std::fs::create_dir_all(&empty_workspace)?;
    set_private_dir_permissions(&empty_workspace)?;

    emit(
        progress,
        capture_id,
        collection_id,
        CaptureStage::PreparingEnvironment,
        match request.profile {
            BenchmarkProfile::IsolatedBaseline => "Preparing an empty workspace and Copilot home…",
            BenchmarkProfile::CurrentEnvironment => {
                "Copying configured context sources into a temporary Copilot home…"
            }
        },
        None,
        None,
        true,
    );

    let (working_directory, repository_path, copied_bytes, included_resources, omitted_resources) =
        match request.profile {
            BenchmarkProfile::IsolatedBaseline => (
                empty_workspace,
                None,
                0,
                vec!["installed CLI built-ins".into()],
                vec![
                    "repository instructions and files".into(),
                    "user settings, MCP configuration, skills, prompts, and hooks".into(),
                    "authentication, credentials, logs, and session history".into(),
                ],
            ),
            BenchmarkProfile::CurrentEnvironment => {
                let selected = request.repository_path.as_deref().ok_or_else(|| {
                    OrchestratorError::ContextCapture(
                        "Select a repository for the current-environment benchmark.".into(),
                    )
                })?;
                let repository = PathBuf::from(selected).canonicalize().map_err(|error| {
                    OrchestratorError::ContextCapture(format!(
                        "Could not open the selected repository: {error}"
                    ))
                })?;
                if !repository.is_dir() {
                    return Err(OrchestratorError::ContextCapture(
                        "The selected repository path is not a directory.".into(),
                    ));
                }
                let copied = copy_environment_context(copilot_home, &isolated_home)?;
                (
                    repository.clone(),
                    Some(repository.to_string_lossy().to_string()),
                    copied,
                    vec![
                        "installed CLI built-ins".into(),
                        "selected repository instruction discovery".into(),
                        "user settings, MCP configuration, skills, prompts, and hooks copied into temporary storage".into(),
                    ],
                    vec![
                        "authentication, credentials, logs, session history, package cache, and command history".into(),
                    ],
                )
            }
        };
    let (capture_profile, capture_scope) = match request.profile {
        BenchmarkProfile::IsolatedBaseline => ("isolated-baseline", CaptureScope::CliBaseline),
        BenchmarkProfile::CurrentEnvironment => {
            ("current-environment", CaptureScope::RepositoryBenchmark)
        }
    };
    let fingerprint_seed = format!(
        "{capture_profile}\n{}\n{}\n{:?}",
        repository_path.as_deref().unwrap_or_default(),
        model,
        request.protocol
    );
    let environment_hash = fingerprint_context_tree(&isolated_home, &fingerprint_seed)?;
    check_cancelled(cancellation)?;

    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let probe = format!(
        "[TracePilot context benchmark {nonce}]\nDo not call tools. Reply with exactly CAPTURED."
    );
    emit(
        progress,
        capture_id,
        collection_id,
        CaptureStage::StartingListener,
        "Starting the one-shot capture endpoint…",
        None,
        None,
        true,
    );
    let mut listener = OneShotListener::bind(request.protocol, &nonce).await?;
    check_cancelled(cancellation)?;
    emit(
        progress,
        capture_id,
        collection_id,
        CaptureStage::ResumingClone,
        "Starting a fresh CLI session for the benchmark…",
        None,
        None,
        true,
    );
    let mut child = spawn_copilot(
        &preflight.cli.executable,
        None,
        &probe,
        &isolated_home,
        &working_directory,
        &listener.base_url,
        request.protocol,
        model,
    )?;
    let mut process_tree_guard = ProcessTreeGuard::new(child.id());
    let stdout = child.stdout.take().ok_or_else(|| {
        OrchestratorError::ContextCapture("Copilot stdout was not captured.".into())
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        OrchestratorError::ContextCapture("Copilot stderr was not captured.".into())
    })?;
    let stdout_task = tokio::spawn(drain_bounded(stdout));
    let stderr_task = tokio::spawn(drain_bounded(stderr));
    emit(
        progress,
        capture_id,
        collection_id,
        CaptureStage::WaitingForRequest,
        "Waiting for the CLI's first model request…",
        None,
        None,
        true,
    );
    let captured = wait_for_request(&mut listener, &mut child, cancellation).await;
    tokio::time::sleep(Duration::from_millis(75)).await;
    let retry_seen = listener.retry_seen();
    listener.shutdown().await;
    terminate_process_tree(&mut child).await;
    process_tree_guard.disarm();
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    let captured = captured?;
    if retry_seen {
        return Err(OrchestratorError::ContextCapture(
            "The CLI retried after the capture-complete response; this protocol cannot be captured safely.".into(),
        ));
    }

    emit(
        progress,
        capture_id,
        collection_id,
        CaptureStage::ParsingSnapshot,
        "Validating and parsing the captured request…",
        None,
        None,
        false,
    );
    let body_json: serde_json::Value = serde_json::from_slice(&captured.body)?;
    let detected = detect_protocol(&captured.path, &body_json).ok_or_else(|| {
        OrchestratorError::ContextCapture(
            "The captured request did not match a supported wire protocol.".into(),
        )
    })?;
    if detected != request.protocol {
        return Err(OrchestratorError::ContextCapture(format!(
            "The CLI posted a {} payload while {} was selected.",
            detected.label(),
            request.protocol.label()
        )));
    }
    let parsed = parse_context_request(request.protocol, &captured.body, &nonce)?;
    let raw_body = String::from_utf8(captured.body).map_err(|_| {
        OrchestratorError::ContextCapture("The captured JSON request was not valid UTF-8.".into())
    })?;
    let mut snapshot = ContextCaptureSnapshot {
        manifest: ContextCaptureManifest {
            schema_version: CONTEXT_CAPTURE_SCHEMA_VERSION,
            capture_id: capture_id.to_string(),
            source_session_id: collection_id.to_string(),
            captured_at: Utc::now(),
            source_events_fingerprint: SourceEventsFingerprint {
                bytes: copied_bytes,
                modified_unix_ms: 0,
                sha256: environment_hash.clone(),
            },
            cli_version: preflight.cli.version,
            capture_profile: capture_profile.into(),
            capture_scope,
            repository_path,
            capture_input_sha256: Some(environment_hash.clone()),
            protocol: request.protocol,
            protocol_detection_source: "benchmark selection".into(),
            request_path: captured.path,
            content_type: captured.content_type,
            raw_body_sha256: hash_bytes(raw_body.as_bytes()),
            raw_body_bytes: raw_body.len() as u64,
            raw_body_characters: raw_body.chars().count() as u64,
            estimated_tokens: (raw_body.len() as u64).div_ceil(4),
            probe_nonce: nonce,
            fidelity_manifest: FidelityManifest {
                profile: capture_profile.into(),
                included_resources,
                omitted_resources,
                working_directory: working_directory.to_string_lossy().to_string(),
                working_directory_fallback: false,
                source_unchanged: true,
            },
            warnings: vec![
                "The raw body is exact for this benchmark run; provider-side processing and tokenization are not captured.".into(),
            ],
            safe_header_names: captured.safe_header_names,
            saved: false,
            parsed,
        },
        raw_body,
    };
    if request.save {
        emit(
            progress,
            capture_id,
            collection_id,
            CaptureStage::SavingSnapshot,
            "Saving the benchmark snapshot…",
            None,
            None,
            false,
        );
        snapshot = save_capture(tracepilot_home, &snapshot)?;
    }
    emit(
        progress,
        capture_id,
        collection_id,
        CaptureStage::CleaningUp,
        "Removing temporary CLI state…",
        None,
        None,
        false,
    );
    drop(scratch);
    emit(
        progress,
        capture_id,
        collection_id,
        CaptureStage::Complete,
        "Benchmark snapshot is ready.",
        None,
        None,
        false,
    );
    Ok(snapshot)
}

fn copy_environment_context(source_home: &Path, destination_home: &Path) -> Result<u64> {
    const FILES: &[&str] = &["settings.json", "mcp-config.json"];
    const DIRECTORIES: &[&str] = &["skills", "prompts", "hooks", "agents", "plugins"];
    let mut copied_bytes = 0u64;
    copied_bytes = copied_bytes.saturating_add(copy_sanitized_cli_config(
        &source_home.join("config.json"),
        &destination_home.join("config.json"),
    )?);
    for name in FILES {
        let source = source_home.join(name);
        if source.is_file() {
            copied_bytes = copied_bytes
                .saturating_add(copy_context_file(&source, &destination_home.join(name))?);
        }
    }
    for name in DIRECTORIES {
        let source = source_home.join(name);
        if !source.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&source).follow_links(false) {
            let entry = entry?;
            let metadata = std::fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Configured context contains a symbolic link: {}",
                    entry.path().display()
                )));
            }
            let relative = entry.path().strip_prefix(source_home).map_err(|_| {
                OrchestratorError::ContextCapture(
                    "Configured context path escaped the Copilot home.".into(),
                )
            })?;
            let destination = destination_home.join(relative);
            if metadata.is_dir() {
                std::fs::create_dir_all(&destination)?;
                set_private_dir_permissions(&destination)?;
            } else if metadata.is_file() {
                copied_bytes =
                    copied_bytes.saturating_add(copy_context_file(entry.path(), &destination)?);
            } else {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Configured context contains a non-regular entry: {}",
                    entry.path().display()
                )));
            }
            if copied_bytes > super::MAX_SESSION_COPY_BYTES {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Configured context exceeds the {} MiB temporary-copy limit.",
                    super::MAX_SESSION_COPY_BYTES / 1024 / 1024
                )));
            }
        }
    }
    Ok(copied_bytes)
}

fn copy_sanitized_cli_config(source: &Path, destination: &Path) -> Result<u64> {
    if !source.is_file() {
        return Ok(0);
    }
    let value = crate::config_injector::read_copilot_json_file(source)
        .map_err(|error| {
            OrchestratorError::ContextCapture(format!(
                "Could not read Copilot's temporary setup state: {error}"
            ))
        })?
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
    let source_object = value.as_object().ok_or_else(|| {
        OrchestratorError::ContextCapture(format!(
            "Copilot setup state is not a JSON object: {}",
            source.display()
        ))
    })?;
    let mut sanitized = serde_json::Map::new();
    for key in [
        "trustedFolders",
        "askedSetupTerminals",
        "reasoningSummariesCleanupDone",
    ] {
        if let Some(value) = source_object.get(key) {
            sanitized.insert(key.into(), value.clone());
        }
    }
    let bytes = serde_json::to_vec_pretty(&sanitized)?;
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
        set_private_dir_permissions(parent)?;
    }
    std::fs::write(destination, &bytes)?;
    super::snapshot::set_private_file_permissions(destination)?;
    Ok(bytes.len() as u64)
}

fn fingerprint_context_tree(root: &Path, seed: &str) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    if !root.is_dir() {
        return Ok(format!("{:x}", hasher.finalize()));
    }
    for entry in walkdir::WalkDir::new(root)
        .sort_by_file_name()
        .follow_links(false)
    {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry.path().strip_prefix(root).map_err(|_| {
            OrchestratorError::ContextCapture(
                "Configured context fingerprint path escaped its root.".into(),
            )
        })?;
        hasher.update(relative.to_string_lossy().as_bytes());
        let mut file = std::fs::File::open(entry.path())?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn copy_context_file(source: &Path, destination: &Path) -> Result<u64> {
    let metadata = std::fs::symlink_metadata(source)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(OrchestratorError::ContextCapture(format!(
            "Configured context file is not a regular file: {}",
            source.display()
        )));
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
        set_private_dir_permissions(parent)?;
    }
    std::fs::copy(source, destination)?;
    super::snapshot::set_private_file_permissions(destination)?;
    Ok(metadata.len())
}

#[allow(clippy::too_many_arguments)]
fn spawn_copilot(
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
        .env("COPILOT_AUTO_UPDATE", "false");
    for name in [
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "COPILOT_GITHUB_TOKEN",
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_ENDPOINT",
    ] {
        command.env_remove(name);
    }
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

async fn wait_for_request(
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

async fn drain_bounded<R>(reader: R)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = reader.take(MAX_PROCESS_STREAM_BYTES);
    let mut buffer = Vec::new();
    let _ = reader.read_to_end(&mut buffer).await;
    // Intentionally discard output: it can contain prompt/context content.
}

async fn terminate_process_tree(child: &mut tokio::process::Child) {
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

struct ProcessTreeGuard {
    pid: Option<u32>,
}

impl ProcessTreeGuard {
    fn new(pid: Option<u32>) -> Self {
        Self { pid }
    }

    fn disarm(&mut self) {
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

fn check_cancelled(cancellation: &Cancellation) -> Result<()> {
    if cancellation.is_cancelled() {
        Err(OrchestratorError::ContextCapture(
            "Capture cancelled.".into(),
        ))
    } else {
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn emit(
    callback: &Arc<dyn Fn(CaptureProgress) + Send + Sync>,
    capture_id: &str,
    session_id: &str,
    stage: CaptureStage,
    message: &str,
    bytes_copied: Option<u64>,
    total_bytes: Option<u64>,
    cancellable: bool,
) {
    callback(CaptureProgress {
        capture_id: capture_id.to_string(),
        session_id: session_id.to_string(),
        stage,
        message: message.to_string(),
        bytes_copied,
        total_bytes,
        cancellable,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_copy_is_allowlisted_and_sanitizes_cli_state() {
        let root = tempfile::tempdir().expect("root");
        let source = root.path().join("source");
        let destination = root.path().join("destination");
        std::fs::create_dir_all(source.join("skills/demo")).expect("skill dir");
        std::fs::create_dir_all(source.join("session-state/session")).expect("session dir");
        std::fs::write(source.join("settings.json"), br#"{"model":"gpt-5"}"#).expect("settings");
        std::fs::write(source.join("skills/demo/SKILL.md"), b"instructions").expect("skill");
        std::fs::write(source.join("session-state/session/events.jsonl"), b"secret")
            .expect("session");
        std::fs::write(
            source.join("config.json"),
            br#"{"trustedFolders":["C:/repo"],"loggedInUsers":["private"],"lastLoggedInUser":"private"}"#,
        )
        .expect("config");

        let copied = copy_environment_context(&source, &destination).expect("copy");

        assert!(copied > 0);
        assert!(destination.join("settings.json").is_file());
        assert!(destination.join("skills/demo/SKILL.md").is_file());
        assert!(!destination.join("session-state").exists());
        let config = std::fs::read_to_string(destination.join("config.json")).expect("read");
        assert!(config.contains("trustedFolders"));
        assert!(!config.contains("loggedInUsers"));
        assert!(!config.contains("private"));
        let first_hash = fingerprint_context_tree(&destination, "profile").expect("hash");
        std::fs::write(destination.join("settings.json"), br#"{"model":"gpt-5.1"}"#)
            .expect("change settings");
        let second_hash = fingerprint_context_tree(&destination, "profile").expect("hash");
        assert_ne!(first_hash, second_hash);
    }

    #[test]
    fn environment_copy_accepts_copilot_jsonc_setup_state() {
        let root = tempfile::tempdir().expect("root");
        let source = root.path().join("source");
        let destination = root.path().join("destination");
        std::fs::create_dir_all(&source).expect("source");
        std::fs::write(
            source.join("config.json"),
            concat!(
                "// User settings belong in settings.json.\n",
                "// This file is managed by Copilot CLI.\n",
                "{\n",
                "  \"trustedFolders\": [\"C:\\\\repo\"],\n",
                "  \"loggedInUsers\": [\"private\"]\n",
                "}\n"
            ),
        )
        .expect("config");

        copy_environment_context(&source, &destination).expect("copy JSONC config");

        let copied: serde_json::Value = serde_json::from_slice(
            &std::fs::read(destination.join("config.json")).expect("read copied config"),
        )
        .expect("copied config is strict JSON");
        assert_eq!(copied["trustedFolders"], serde_json::json!(["C:\\repo"]));
        assert!(copied.get("loggedInUsers").is_none());
    }

    #[test]
    fn environment_copy_reports_config_path_for_invalid_jsonc() {
        let root = tempfile::tempdir().expect("root");
        let source = root.path().join("source");
        let destination = root.path().join("destination");
        std::fs::create_dir_all(&source).expect("source");
        std::fs::write(source.join("config.json"), "// banner\n{not-json").expect("config");

        let error = copy_environment_context(&source, &destination).expect_err("invalid config");
        let message = error.to_string();
        assert!(message.contains("Copilot's temporary setup state"));
        assert!(message.contains("config.json"));
        assert!(message.contains("line 2"));
    }
}
