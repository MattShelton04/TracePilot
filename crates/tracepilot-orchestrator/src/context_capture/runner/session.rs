use super::super::listener::OneShotListener;
use super::super::persistence::{hash_bytes, save_capture};
use super::super::preflight::context_capture_preflight;
use super::super::snapshot::{
    cleanup_stale_scratch, copy_session_tree, set_private_dir_permissions, source_fingerprint,
};
use super::process::{
    ProcessTreeGuard, drain_bounded, spawn_copilot, terminate_process_tree, wait_for_request,
};
use super::{
    Cancellation, CaptureProgress, CaptureStage, StartCaptureRequest, check_cancelled, emit,
};
use crate::error::{OrchestratorError, Result};
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tracepilot_core::context_capture::{
    CONTEXT_CAPTURE_SCHEMA_VERSION, CaptureScope, ContextCaptureManifest, ContextCaptureSnapshot,
    FidelityManifest, detect_protocol, parse_context_request,
};

#[allow(clippy::too_many_arguments)]
pub(super) async fn run_capture(
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
