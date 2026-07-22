use super::MAX_CAPTURE_STORAGE_BYTES;
use super::snapshot::{set_private_dir_permissions, set_private_file_permissions};
use crate::error::{OrchestratorError, Result};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::Path;
use tracepilot_core::context_capture::{
    CaptureProtocol, ContextCaptureManifest, ContextCaptureSnapshot, ContextCaptureStorageStats,
    ContextCaptureSummary, parse_context_request,
};
use tracepilot_core::paths::TracePilotPaths;
use walkdir::WalkDir;

const MANIFEST_FILE: &str = "manifest.json";
const REQUEST_FILE: &str = "request.json";

pub fn save_capture(
    tracepilot_home: &Path,
    snapshot: &ContextCaptureSnapshot,
) -> Result<ContextCaptureSnapshot> {
    validate_uuid(&snapshot.manifest.source_session_id, "session")?;
    validate_uuid(&snapshot.manifest.capture_id, "capture")?;
    let paths = TracePilotPaths::from_root(tracepilot_home);
    let captures_root = paths.context_captures_dir();
    let session_dir = paths.context_capture_session_dir(&snapshot.manifest.source_session_id);
    let capture_dir = paths.context_capture_dir(
        &snapshot.manifest.source_session_id,
        &snapshot.manifest.capture_id,
    );
    if capture_dir.exists() {
        return Err(OrchestratorError::ContextCapture(
            "A capture with this ID already exists.".into(),
        ));
    }
    let existing_bytes = storage_stats(tracepilot_home)?.total_bytes;
    let projected_bytes = existing_bytes
        .saturating_add(snapshot.raw_body.len() as u64)
        .saturating_add(64 * 1024);
    if projected_bytes > MAX_CAPTURE_STORAGE_BYTES {
        return Err(OrchestratorError::ContextCapture(format!(
            "Saving this snapshot would exceed the {} MiB context-capture storage budget. Delete saved snapshots or use View once.",
            MAX_CAPTURE_STORAGE_BYTES / 1024 / 1024
        )));
    }
    fs::create_dir_all(&session_dir)?;
    set_private_dir_permissions(&captures_root)?;
    set_private_dir_permissions(&session_dir)?;

    // Publish the capture as one directory rename so readers can never observe
    // request.json without its matching manifest (or vice versa).
    let staging_dir = session_dir.join(format!(
        ".{}.{}.tmp",
        snapshot.manifest.capture_id,
        uuid::Uuid::new_v4()
    ));
    fs::create_dir(&staging_dir)?;
    set_private_dir_permissions(&staging_dir)?;

    let mut saved = snapshot.clone();
    saved.manifest.saved = true;
    let publish_result = (|| -> Result<()> {
        atomic_write(&staging_dir.join(REQUEST_FILE), saved.raw_body.as_bytes())?;

        // Parsed content is intentionally not duplicated in manifest.json. It is
        // regenerated from the immutable request bytes whenever a capture is read.
        let mut metadata = serde_json::to_value(&saved.manifest)?;
        if let Some(object) = metadata.as_object_mut() {
            object.remove("parsed");
        }
        let manifest_bytes = serde_json::to_vec_pretty(&metadata)?;
        atomic_write(&staging_dir.join(MANIFEST_FILE), &manifest_bytes)?;
        fs::rename(&staging_dir, &capture_dir)?;
        Ok(())
    })();
    if let Err(error) = publish_result {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(error);
    }
    Ok(saved)
}

pub fn list_captures(
    tracepilot_home: &Path,
    session_id: &str,
) -> Result<Vec<ContextCaptureSummary>> {
    validate_uuid(session_id, "session")?;
    let session_dir =
        TracePilotPaths::from_root(tracepilot_home).context_capture_session_dir(session_id);
    if !session_dir.exists() {
        return Ok(Vec::new());
    }
    reject_symlink(&session_dir)?;
    let mut summaries = Vec::new();
    for entry in fs::read_dir(session_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let Some(capture_id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if validate_uuid(&capture_id, "capture").is_err() {
            continue;
        }
        match get_capture(tracepilot_home, session_id, &capture_id) {
            Ok(snapshot) => summaries.push(ContextCaptureSummary::from(&snapshot.manifest)),
            Err(error) => {
                tracing::warn!(capture_id, error = %error, "Skipping unreadable context capture metadata")
            }
        }
    }
    summaries.sort_by(|left, right| right.captured_at.cmp(&left.captured_at));
    Ok(summaries)
}

pub fn get_capture(
    tracepilot_home: &Path,
    session_id: &str,
    capture_id: &str,
) -> Result<ContextCaptureSnapshot> {
    validate_uuid(session_id, "session")?;
    validate_uuid(capture_id, "capture")?;
    let capture_dir =
        TracePilotPaths::from_root(tracepilot_home).context_capture_dir(session_id, capture_id);
    reject_symlink(&capture_dir)?;
    let request_bytes = fs::read(capture_dir.join(REQUEST_FILE))?;
    let raw_body = String::from_utf8(request_bytes).map_err(|_| {
        OrchestratorError::ContextCapture("Saved request.json is not valid UTF-8.".into())
    })?;
    let mut metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(capture_dir.join(MANIFEST_FILE))?)?;
    let protocol: CaptureProtocol =
        serde_json::from_value(metadata.get("protocol").cloned().ok_or_else(|| {
            OrchestratorError::ContextCapture("Saved capture manifest has no protocol.".into())
        })?)?;
    let probe_nonce = metadata
        .get("probeNonce")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            OrchestratorError::ContextCapture("Saved capture manifest has no probe nonce.".into())
        })?;
    let parsed = parse_context_request(protocol, raw_body.as_bytes(), probe_nonce)?;
    metadata
        .as_object_mut()
        .ok_or_else(|| {
            OrchestratorError::ContextCapture("Saved capture manifest is not an object.".into())
        })?
        .insert("parsed".into(), serde_json::to_value(parsed)?);
    let manifest: ContextCaptureManifest = serde_json::from_value(metadata)?;
    if hash_bytes(raw_body.as_bytes()) != manifest.raw_body_sha256
        || raw_body.len() as u64 != manifest.raw_body_bytes
    {
        return Err(OrchestratorError::ContextCapture(
            "Saved request bytes do not match their capture manifest.".into(),
        ));
    }
    Ok(ContextCaptureSnapshot { manifest, raw_body })
}

pub fn delete_capture(tracepilot_home: &Path, session_id: &str, capture_id: &str) -> Result<()> {
    validate_uuid(session_id, "session")?;
    validate_uuid(capture_id, "capture")?;
    let paths = TracePilotPaths::from_root(tracepilot_home);
    let capture_dir = paths.context_capture_dir(session_id, capture_id);
    reject_symlink(&capture_dir)?;
    if capture_dir.exists() {
        fs::remove_dir_all(&capture_dir)?;
    }
    let session_dir = paths.context_capture_session_dir(session_id);
    if session_dir.is_dir() && fs::read_dir(&session_dir)?.next().is_none() {
        fs::remove_dir(&session_dir)?;
    }
    Ok(())
}

pub fn delete_all_captures(tracepilot_home: &Path) -> Result<u64> {
    let root = TracePilotPaths::from_root(tracepilot_home).context_captures_dir();
    if !root.exists() {
        return Ok(0);
    }
    reject_symlink(&root)?;
    let count = storage_stats(tracepilot_home)?.capture_count;
    fs::remove_dir_all(root)?;
    Ok(count)
}

pub fn storage_stats(tracepilot_home: &Path) -> Result<ContextCaptureStorageStats> {
    let root = TracePilotPaths::from_root(tracepilot_home).context_captures_dir();
    if !root.exists() {
        return Ok(ContextCaptureStorageStats::default());
    }
    reject_symlink(&root)?;
    let mut stats = ContextCaptureStorageStats::default();
    for entry in WalkDir::new(&root).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_symlink() {
            return Err(OrchestratorError::ContextCapture(
                "Capture storage contains an unsupported symbolic link.".into(),
            ));
        }
        if entry.file_type().is_file() {
            stats.total_bytes = stats.total_bytes.saturating_add(entry.metadata()?.len());
            if entry.file_name() == MANIFEST_FILE {
                stats.capture_count += 1;
            }
        }
    }
    Ok(stats)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("capture");
    let temp = path.with_file_name(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    set_private_file_permissions(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp, path)?;
    Ok(())
}

fn validate_uuid(value: &str, kind: &str) -> Result<()> {
    uuid::Uuid::parse_str(value).map_err(|_| {
        OrchestratorError::ContextCapture(format!("Invalid {kind} ID for capture storage."))
    })?;
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<()> {
    if path.exists() && fs::symlink_metadata(path)?.file_type().is_symlink() {
        return Err(OrchestratorError::ContextCapture(
            "Capture storage path must not be a symbolic link.".into(),
        ));
    }
    Ok(())
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tracepilot_core::context_capture::{
        CONTEXT_CAPTURE_SCHEMA_VERSION, FidelityManifest, SourceEventsFingerprint,
    };

    #[test]
    fn saved_capture_roundtrips_from_immutable_request() {
        let root = tempfile::tempdir().expect("root");
        let session_id = uuid::Uuid::new_v4().to_string();
        let capture_id = uuid::Uuid::new_v4().to_string();
        let nonce = "nonce".to_string();
        let raw_body = r#"{"model":"gpt-4.1","messages":[{"role":"system","content":"rules"},{"role":"user","content":"nonce"}],"tools":[]}"#.to_string();
        let parsed = parse_context_request(
            CaptureProtocol::OpenAiChatCompletions,
            raw_body.as_bytes(),
            &nonce,
        )
        .expect("parse");
        let snapshot = ContextCaptureSnapshot {
            manifest: ContextCaptureManifest {
                schema_version: CONTEXT_CAPTURE_SCHEMA_VERSION,
                capture_id: capture_id.clone(),
                source_session_id: session_id.clone(),
                captured_at: Utc::now(),
                source_events_fingerprint: SourceEventsFingerprint {
                    bytes: 1,
                    modified_unix_ms: 1,
                    sha256: "a".into(),
                },
                cli_version: "1.0.74".into(),
                capture_profile: "isolated".into(),
                protocol: CaptureProtocol::OpenAiChatCompletions,
                protocol_detection_source: "test".into(),
                request_path: "/nonce/v1/chat/completions".into(),
                content_type: "application/json".into(),
                raw_body_sha256: hash_bytes(raw_body.as_bytes()),
                raw_body_bytes: raw_body.len() as u64,
                raw_body_characters: raw_body.chars().count() as u64,
                estimated_tokens: 1,
                probe_nonce: nonce,
                fidelity_manifest: FidelityManifest {
                    profile: "isolated".into(),
                    included_resources: vec![],
                    omitted_resources: vec![],
                    working_directory: "x".into(),
                    working_directory_fallback: false,
                    source_unchanged: true,
                },
                warnings: vec![],
                safe_header_names: vec!["content-type".into()],
                saved: false,
                parsed,
            },
            raw_body,
        };
        save_capture(root.path(), &snapshot).expect("save");
        let manifest_text = fs::read_to_string(
            TracePilotPaths::from_root(root.path())
                .context_capture_dir(&session_id, &capture_id)
                .join(MANIFEST_FILE),
        )
        .expect("manifest");
        assert!(!manifest_text.contains("messages"));
        let loaded = get_capture(root.path(), &session_id, &capture_id).expect("load");
        assert_eq!(loaded.raw_body, snapshot.raw_body);
        assert!(loaded.manifest.saved);
    }
}
