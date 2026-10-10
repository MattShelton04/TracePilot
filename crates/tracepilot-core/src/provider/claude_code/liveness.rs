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
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::Value;

use crate::provider::{Liveness, RunStatus};

/// The start times of the running processes among the given pids, in
/// `procStart`'s format (on Windows, the creation FILETIME as a decimal
/// string). A pid with no process is absent. Each liveness pass makes at
/// most one call, with every pid it needs, so a lookup that spawns a
/// process (`ps` on macOS) can spawn one for them all.
pub type ProcessStart = Arc<dyn Fn(&[u32]) -> HashMap<u32, String> + Send + Sync>;

/// Pid files proven stale: their pid now belongs to a process that started
/// at another time, so the process a file names has exited for good and the
/// file never needs another lookup. A pid with no process at all is not
/// remembered, since a failed lookup looks the same.
#[derive(Default)]
pub struct StalePidFiles(Mutex<HashSet<(u32, String)>>);

/// Bounds the memory leftover files can take; past it the set starts over.
const MAX_STALE_PID_FILES: usize = 1024;

impl StalePidFiles {
    fn contains(&self, pid: u32, started: &str) -> bool {
        self.0
            .lock()
            .is_ok_and(|stale| stale.contains(&(pid, started.to_string())))
    }

    fn insert(&self, pid: u32, started: String) {
        if let Ok(mut stale) = self.0.lock() {
            if stale.len() >= MAX_STALE_PID_FILES {
                stale.clear();
            }
            stale.insert((pid, started));
        }
    }
}

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
    stale: &StalePidFiles,
) -> Liveness {
    liveness_many(sessions_dir, [session_id], process_start, stale)
        .pop()
        .unwrap_or(Liveness::Unknown)
}

/// [`liveness`] for many sessions, reading `sessions_dir` once. Only a pid
/// file naming one of the sessions costs a process lookup, and every pid is
/// looked up in one call.
pub(super) fn liveness_many<'a>(
    sessions_dir: &Path,
    session_ids: impl IntoIterator<Item = &'a str>,
    process_start: Option<&ProcessStart>,
    stale: &StalePidFiles,
) -> Vec<Liveness> {
    let ids: Vec<&str> = session_ids.into_iter().collect();
    let Some(files) = read_pid_files(sessions_dir) else {
        return vec![Liveness::Unknown; ids.len()];
    };
    let starts = process_start.map(|lookup| look_up_all(&files, &ids, lookup, stale));
    let known = |pid: u32| starts.as_ref()?.get(&pid).cloned();
    let lookup = starts.is_some().then_some(&known as Lookup);
    ids.iter()
        .map(|id| liveness_in(&files, id, lookup, stale))
        .collect()
}

/// The start time of every running pid that a file naming one of `ids`
/// records, except files already proven stale. No such pid, no lookup.
fn look_up_all(
    files: &[PidFile],
    ids: &[&str],
    lookup: &ProcessStart,
    stale: &StalePidFiles,
) -> HashMap<u32, String> {
    let wanted: HashSet<&str> = ids.iter().copied().collect();
    let pids: Vec<u32> = files
        .iter()
        .filter(|file| {
            file.session_id
                .as_deref()
                .is_some_and(|id| wanted.contains(id))
        })
        .filter_map(|file| Some((file.pid?, file.started()?)))
        .filter(|(pid, started)| !stale.contains(*pid, started))
        .map(|(pid, _)| pid)
        .collect::<BTreeSet<u32>>()
        .into_iter()
        .collect();
    if pids.is_empty() {
        return HashMap::new();
    }
    lookup(&pids)
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

fn liveness_in(
    files: &[PidFile],
    session_id: &str,
    process_start: Option<Lookup>,
    stale: &StalePidFiles,
) -> Liveness {
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
        if stale.contains(pid, &started) {
            continue;
        }
        let actual = process_start(pid);
        if actual.as_deref() != Some(started.as_str()) {
            if actual.is_some() {
                stale.insert(pid, started);
            }
            continue;
        }
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
    if unverified {
        Liveness::Unknown
    } else {
        Liveness::Idle
    }
}
