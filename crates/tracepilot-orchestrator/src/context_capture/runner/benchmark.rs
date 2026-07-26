use super::super::listener::OneShotListener;
use super::super::persistence::{hash_bytes, save_capture};
use super::super::preflight::benchmark_preflight;
use super::super::snapshot::{cleanup_stale_scratch, set_private_dir_permissions};
use super::environment::{
    canonicalize_repository, copy_environment_context, fingerprint_context_tree,
};
use super::process::{
    ProcessTreeGuard, drain_bounded, spawn_copilot, terminate_process_tree, wait_for_request,
};
use super::{
    BenchmarkProfile, Cancellation, CaptureProgress, CaptureStage, StartBenchmarkCaptureRequest,
    check_cancelled, emit,
};
use crate::error::{OrchestratorError, Result};
use chrono::Utc;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tracepilot_core::context_capture::{
    CONTEXT_CAPTURE_SCHEMA_VERSION, CaptureScope, ContextCaptureManifest, ContextCaptureSnapshot,
    FidelityManifest, SourceEventsFingerprint, detect_protocol, parse_context_request,
};

#[allow(clippy::too_many_arguments)]
pub(super) async fn run_benchmark_capture(
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
                    "authentication, credentials, non-allowlisted parent process environment variables, logs, and session history".into(),
                ],
            ),
            BenchmarkProfile::CurrentEnvironment => {
                let selected = request.repository_path.as_deref().ok_or_else(|| {
                    OrchestratorError::ContextCapture(
                        "Select a repository for the current-environment benchmark.".into(),
                    )
                })?;
                let repository = canonicalize_repository(selected)?;
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
                        "authentication, credentials, non-allowlisted parent process environment variables, remote experiment assignments, IDE state, logs, session history, package cache, and command history".into(),
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
