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

use std::collections::{BTreeSet, HashMap, HashSet};
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

impl PidFile {
    /// `procStart`, which Claude Code writes as a string or a number.
    fn started(&self) -> Option<String> {
        match &self.proc_start {
            Some(Value::String(text)) => Some(text.clone()),
            Some(Value::Number(number)) => Some(number.to_string()),
            _ => None,
        }
    }
}

type Lookup<'a> = &'a dyn Fn(u32) -> Option<String>;

/// Whether a live process in `sessions_dir` owns `session_id`.
pub(super) fn liveness(
    sessions_dir: &Path,
    session_id: &str,
    process_start: Option<&ProcessStart>,
) -> Liveness {
    match read_pid_files(sessions_dir) {
        Some(files) => liveness_in(
            &files,
            session_id,
            process_start.map(|f| f.as_ref() as Lookup),
        ),
        None => Liveness::Unknown,
    }
}

/// [`liveness`] for many sessions, reading `sessions_dir` once. Only a pid
/// file naming one of the sessions costs a process lookup, and lookups run
/// concurrently, since each may spawn a process.
pub(super) fn liveness_many<'a>(
    sessions_dir: &Path,
    session_ids: impl IntoIterator<Item = &'a str>,
    process_start: Option<&ProcessStart>,
) -> Vec<Liveness> {
    let ids: Vec<&str> = session_ids.into_iter().collect();
    let Some(files) = read_pid_files(sessions_dir) else {
        return vec![Liveness::Unknown; ids.len()];
    };
    let starts = process_start.map(|lookup| look_up_all(&files, &ids, lookup));
    let known = |pid: u32| starts.as_ref()?.get(&pid).cloned().flatten();
    let lookup = starts.is_some().then_some(&known as Lookup);
    ids.iter()
        .map(|id| liveness_in(&files, id, lookup))
        .collect()
}

/// The start time of every pid that a file naming one of `ids` records.
fn look_up_all(
    files: &[PidFile],
    ids: &[&str],
    lookup: &ProcessStart,
) -> HashMap<u32, Option<String>> {
    let wanted: HashSet<&str> = ids.iter().copied().collect();
    let pids: BTreeSet<u32> = files
        .iter()
        .filter(|file| {
            file.session_id
                .as_deref()
                .is_some_and(|id| wanted.contains(id))
                && file.started().is_some()
        })
        .filter_map(|file| file.pid)
        .collect();
    std::thread::scope(|scope| {
        let pending: Vec<_> = pids
            .into_iter()
            .map(|pid| (pid, scope.spawn(move || lookup(pid))))
            .collect();
        pending
            .into_iter()
            .map(|(pid, handle)| (pid, handle.join().ok().flatten()))
            .collect()
    })
}

/// Every readable pid file in `sessions_dir`. A missing directory has none;
/// `None` means the directory could not be listed.
fn read_pid_files(sessions_dir: &Path) -> Option<Vec<PidFile>> {
    let entries = match std::fs::read_dir(sessions_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Some(Vec::new()),
        Err(_) => return None,
    };
    let files = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        // A file mid-write or of another shape belongs to no session we can name.
        .filter_map(|path| {
            std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<PidFile>(&bytes).ok())
        })
        .collect();
    Some(files)
}

fn liveness_in(files: &[PidFile], session_id: &str, process_start: Option<Lookup>) -> Liveness {
    let mut unverified = false;
    for file in files {
        if file.session_id.as_deref() != Some(session_id) {
            continue;
        }
        let (Some(pid), Some(started), Some(process_start)) =
            (file.pid, file.started(), process_start)
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
