//! Liveness from `sessions/<pid>.json`, which Claude Code writes while a
//! process runs (record-shapes.md, "Liveness").
//!
//! Only `*.json` files are read. The sibling `<pid>.<hash>.key` file is a
//! secret and is never opened.
//!
//! A pid file can outlive its process after a crash, and pids are reused, so
//! a file proves nothing alone: the process must still exist with the start
//! time the file recorded (`procStart`). Core has no OS process API, so the
//! caller supplies that lookup; without one a matching file is `Unknown`.

use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;

use crate::provider::{Liveness, RunStatus};

/// The start time of a running process in `procStart`'s format (on Windows,
/// the creation FILETIME as a decimal string), or `None` when no process has
/// that pid.
pub type ProcessStart = Arc<dyn Fn(u32) -> Option<String> + Send + Sync>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PidFile {
    pid: Option<u32>,
    session_id: Option<String>,
    proc_start: Option<Value>,
    status: Option<String>,
}

/// Whether a live process in `sessions_dir` owns `session_id`.
pub(super) fn liveness(
    sessions_dir: &Path,
    session_id: &str,
    process_start: Option<&ProcessStart>,
) -> Liveness {
    let entries = match std::fs::read_dir(sessions_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Liveness::Idle,
        Err(_) => return Liveness::Unknown,
    };
    let mut unverified = false;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|ext| ext != "json") {
            continue;
        }
        // A file mid-write or of another shape belongs to no session we can name.
        let Some(file) = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<PidFile>(&bytes).ok())
        else {
            continue;
        };
        if file.session_id.as_deref() != Some(session_id) {
            continue;
        }
        let started = match &file.proc_start {
            Some(Value::String(text)) => Some(text.clone()),
            Some(Value::Number(number)) => Some(number.to_string()),
            _ => None,
        };
        let (Some(pid), Some(started), Some(process_start)) = (file.pid, started, process_start)
        else {
            unverified = true;
            continue;
        };
        if process_start(pid).as_deref() == Some(started.as_str()) {
            let status = match file.status.as_deref() {
                Some("busy") => Some(RunStatus::Busy),
                Some("idle") => Some(RunStatus::Waiting),
                _ => None,
            };
            return Liveness::Running {
                pid: Some(pid),
                status,
            };
        }
    }
    if unverified {
        Liveness::Unknown
    } else {
        Liveness::Idle
    }
}
