use super::MAX_SESSION_COPY_BYTES;
use crate::error::{OrchestratorError, Result};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tracepilot_core::context_capture::SourceEventsFingerprint;
use walkdir::WalkDir;

pub fn inspect_session_tree(source: &Path) -> Result<(u64, u64)> {
    let mut bytes = 0u64;
    let mut files = 0u64;
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        reject_unsafe_entry(entry.path(), &metadata)?;
        if metadata.is_file() {
            bytes = bytes.checked_add(metadata.len()).ok_or_else(|| {
                OrchestratorError::ContextCapture(
                    "Session size overflowed the safety counter.".into(),
                )
            })?;
            files += 1;
            if bytes > MAX_SESSION_COPY_BYTES {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Session is larger than the {} MiB capture-copy limit.",
                    MAX_SESSION_COPY_BYTES / 1024 / 1024
                )));
            }
        }
    }
    Ok((bytes, files))
}

pub fn copy_session_tree(source: &Path, destination: &Path) -> Result<(u64, u64)> {
    fs::create_dir_all(destination)?;
    set_private_dir_permissions(destination)?;
    let mut bytes = 0u64;
    let mut files = 0u64;
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(path)?;
        reject_unsafe_entry(path, &metadata)?;
        let relative = path.strip_prefix(source).map_err(|_| {
            OrchestratorError::ContextCapture("Session copy path escaped its source root.".into())
        })?;
        if relative.as_os_str().is_empty() || is_lock_file(relative) {
            continue;
        }
        let target = destination.join(relative);
        if metadata.is_dir() {
            fs::create_dir_all(&target)?;
            set_private_dir_permissions(&target)?;
        } else if metadata.is_file() {
            bytes = bytes.checked_add(metadata.len()).ok_or_else(|| {
                OrchestratorError::ContextCapture(
                    "Session size overflowed the safety counter.".into(),
                )
            })?;
            if bytes > MAX_SESSION_COPY_BYTES {
                return Err(OrchestratorError::ContextCapture(
                    "Session changed beyond the capture-copy size limit while being copied.".into(),
                ));
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            copy_file_exact(path, &target)?;
            set_private_file_permissions(&target)?;
            files += 1;
        }
    }
    Ok((bytes, files))
}

pub fn source_fingerprint(path: &Path) -> Result<SourceEventsFingerprint> {
    let metadata = fs::metadata(path)?;
    let modified_unix_ms = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(SourceEventsFingerprint {
        bytes: metadata.len(),
        modified_unix_ms,
        sha256: format!("{:x}", hasher.finalize()),
    })
}

/// Removes only old, tool-owned scratch directories after verifying that the
/// entire tree still contains regular files and directories. Anything
/// unexpected is left alone for manual inspection.
pub fn cleanup_stale_scratch(root: &Path, minimum_age: Duration) -> Result<u64> {
    if !root.exists() {
        return Ok(0);
    }
    let canonical_root = root.canonicalize()?;
    let mut removed = 0;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with("capture-") {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            continue;
        }
        let marker = path.join(".tracepilot-context-capture");
        let Ok(marker_metadata) = fs::symlink_metadata(&marker) else {
            continue;
        };
        if !marker_metadata.is_file()
            || marker_metadata.file_type().is_symlink()
            || is_reparse_point(&marker_metadata)
        {
            continue;
        }
        let age = SystemTime::now()
            .duration_since(metadata.modified()?)
            .unwrap_or_default();
        if age < minimum_age {
            continue;
        }
        let canonical_path = path.canonicalize()?;
        if canonical_path.parent() != Some(canonical_root.as_path()) {
            continue;
        }
        let mut safe = true;
        for child in WalkDir::new(&canonical_path).follow_links(false) {
            let child = child?;
            let child_metadata = fs::symlink_metadata(child.path())?;
            if reject_unsafe_entry(child.path(), &child_metadata).is_err() {
                safe = false;
                break;
            }
        }
        if safe {
            fs::remove_dir_all(&canonical_path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

fn copy_file_exact(source: &Path, destination: &Path) -> Result<()> {
    let mut input = fs::File::open(source)?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    std::io::copy(&mut input, &mut output)?;
    output.flush()?;
    Ok(())
}

fn is_lock_file(relative: &Path) -> bool {
    relative
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("inuse.") && name.ends_with(".lock"))
}

fn reject_unsafe_entry(path: &Path, metadata: &fs::Metadata) -> Result<()> {
    if metadata.file_type().is_symlink() || is_reparse_point(metadata) {
        return Err(OrchestratorError::ContextCapture(format!(
            "Session capture rejected a symlink, junction, or reparse point: {}",
            path.display()
        )));
    }
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(OrchestratorError::ContextCapture(format!(
            "Session capture rejected a non-regular filesystem entry: {}",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

pub(crate) fn set_private_dir_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub(crate) fn set_private_file_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_omits_lock_and_preserves_regular_bytes() {
        let source = tempfile::tempdir().expect("source tempdir");
        let destination = tempfile::tempdir().expect("destination tempdir");
        fs::write(source.path().join("events.jsonl"), b"payload").expect("fixture write");
        fs::write(source.path().join("inuse.123.lock"), b"lock").expect("lock write");
        copy_session_tree(source.path(), &destination.path().join("copy")).expect("copy");
        assert_eq!(
            fs::read(destination.path().join("copy/events.jsonl")).expect("read"),
            b"payload"
        );
        assert!(!destination.path().join("copy/inuse.123.lock").exists());
    }

    #[test]
    fn scratch_cleanup_ignores_unmarked_directories() {
        let root = tempfile::tempdir().expect("root tempdir");
        let marked = root.path().join("capture-marked");
        let unmarked = root.path().join("capture-unmarked");
        fs::create_dir(&marked).expect("marked dir");
        fs::create_dir(&unmarked).expect("unmarked dir");
        fs::write(marked.join(".tracepilot-context-capture"), b"capture-id").expect("marker write");

        assert_eq!(
            cleanup_stale_scratch(root.path(), Duration::ZERO).expect("cleanup"),
            1
        );
        assert!(!marked.exists());
        assert!(unmarked.exists());
    }
}
