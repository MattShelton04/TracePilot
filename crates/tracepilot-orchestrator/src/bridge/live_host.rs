//! Session hosting discovery for live attach (ADR-0016).
//!
//! A Copilot CLI process that holds a session writes `inuse.<pid>.lock` into
//! the session directory. When that process was started with `--ui-server`
//! (or `--server`), it also listens on a loopback TCP port that an SDK client
//! can join. This module turns those two facts into a [`LiveSessionHost`] per
//! session:
//!
//! - **Attachable**: a lock-holder PID is listening on a loopback port.
//! - **Running**: the session has a live lock but no listening holder, so it is
//!   a plain terminal session that cannot be attached to.
//! - **Idle**: nothing holds the session.
//!
//! Locating is read-only: it never connects to a server or writes to a
//! session. The listening-port table comes from one bounded, hidden system
//! probe (`netstat` on Windows, `lsof` elsewhere) and is cached briefly so a
//! session list can ask about many sessions at once. When that probe fails,
//! locating fails too, rather than reporting every terminal as gone.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const PROBE_MAX_BYTES: u64 = 4 * 1024 * 1024;
/// How long one listening-port probe is reused. Short enough that a freshly
/// launched `--ui-server` shows up on the next poll, long enough that a
/// session list asking about dozens of sessions triggers one probe.
const PORT_CACHE_TTL: Duration = Duration::from_secs(2);

/// How a session is currently hosted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LiveHostState {
    /// Held by a CLI server TracePilot can join over loopback TCP.
    Attachable,
    /// Held by a CLI process without a server (a plain terminal session).
    Running,
    /// Not held by any process.
    Idle,
}

/// Hosting information for one session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionHost {
    pub session_id: String,
    pub state: LiveHostState,
    /// PID of the CLI process that holds the session, when known.
    pub pid: Option<u32>,
    /// `127.0.0.1:<port>` (or `[::1]:<port>` for an IPv6-only listener) of
    /// the hosting server when attachable.
    pub address: Option<String>,
    /// Whether TracePilot is currently attached to this session.
    pub attached: bool,
}

/// PIDs named by `inuse.<pid>.lock` files in a session directory.
pub fn lock_holder_pids(session_dir: &Path) -> Vec<u32> {
    let Ok(entries) = std::fs::read_dir(session_dir) else {
        return Vec::new();
    };
    let mut pids: Vec<u32> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| parse_lock_pid(&e.file_name().to_string_lossy()))
        .collect();
    pids.sort_unstable();
    pids.dedup();
    pids
}

pub(crate) fn parse_lock_pid(file_name: &str) -> Option<u32> {
    file_name
        .strip_prefix("inuse.")?
        .strip_suffix(".lock")?
        .parse()
        .ok()
}

/// Classify one session from its lock-holder PIDs and the listening-port table.
///
/// `alive` is the set of running PIDs when it could be probed. A lock whose
/// holder is not alive is stale (the CLI crashed), so the session is idle.
pub(crate) fn classify(
    session_id: &str,
    holder_pids: &[u32],
    has_live_lock: bool,
    listening: &PortMap,
    alive: Option<&HashSet<u32>>,
) -> LiveSessionHost {
    // A stale lock, or a holder that has exited, never makes a session
    // attachable: its PID may since have been reused by an unrelated
    // listener.
    let is_live_holder = |pid: &u32| has_live_lock && alive.is_none_or(|alive| alive.contains(pid));
    for pid in holder_pids.iter().filter(|pid| is_live_holder(pid)) {
        if let Some(address) = listening.get(pid).and_then(|addresses| addresses.first()) {
            return LiveSessionHost {
                session_id: session_id.to_string(),
                state: LiveHostState::Attachable,
                pid: Some(*pid),
                address: Some(address.clone()),
                attached: false,
            };
        }
    }
    let holder_alive = match alive {
        Some(alive) => holder_pids.iter().any(|pid| alive.contains(pid)),
        None => !holder_pids.is_empty(),
    };
    let running = has_live_lock && holder_alive;
    LiveSessionHost {
        session_id: session_id.to_string(),
        state: if running {
            LiveHostState::Running
        } else {
            LiveHostState::Idle
        },
        pid: if running {
            holder_pids
                .iter()
                .find(|pid| alive.is_none_or(|alive| alive.contains(pid)))
                .copied()
        } else {
            None
        },
        address: None,
        attached: false,
    }
}

/// The listening-socket probe failed, so hosting state is unknown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocateError;

impl std::fmt::Display for LocateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("could not list listening ports to find live terminals")
    }
}

/// Locate the hosting state of each session in `session_ids`.
///
/// Unknown or malformed session IDs resolve to [`LiveHostState::Idle`].
/// Fails only when some session has a lock holder and the listening-socket
/// probe failed: guessing then would report every live terminal as gone.
pub async fn locate_sessions(
    session_state_dir: &Path,
    session_ids: &[String],
) -> Result<Vec<LiveSessionHost>, LocateError> {
    let candidates: Vec<(String, Vec<u32>, bool)> = session_ids
        .iter()
        .map(|id| {
            if !is_plain_session_id(id) {
                return (id.clone(), Vec::new(), false);
            }
            let dir = session_state_dir.join(id);
            let pids = lock_holder_pids(&dir);
            let live = !pids.is_empty() && tracepilot_core::session::discovery::has_lock_file(&dir);
            (id.clone(), pids, live)
        })
        .collect();

    let listening = if candidates.iter().any(|(_, pids, _)| !pids.is_empty()) {
        listening_ports().await.ok_or(LocateError)?
    } else {
        HashMap::new()
    };

    // Every live lock is checked, including listening holders: a crashed
    // CLI's PID can be reused by an unrelated listener.
    let needs_liveness: Vec<(&String, &Vec<u32>)> = candidates
        .iter()
        .filter(|(_, _, live)| *live)
        .map(|(id, pids, _)| (id, pids))
        .collect();
    let alive = if needs_liveness.is_empty() {
        None
    } else {
        alive_holders(session_state_dir, &needs_liveness).await
    };

    Ok(candidates
        .iter()
        .map(|(id, pids, live)| classify(id, pids, *live, &listening, alive.as_ref()))
        .collect())
}

/// Session IDs are directory names; refuse anything that could escape the
/// session-state directory.
fn is_plain_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Connectable loopback addresses of listening sockets (`127.0.0.1:<port>`
/// first, then `[::1]:<port>`), keyed by owning PID.
pub(crate) type PortMap = HashMap<u32, Vec<String>>;

static PORT_CACHE: Mutex<Option<(Instant, PortMap)>> = Mutex::new(None);

/// Loopback TCP listeners keyed by owning PID, or `None` when the probe
/// failed. Successful probes are cached for [`PORT_CACHE_TTL`]; failures are
/// not, so the next poll tries again.
pub async fn listening_ports() -> Option<PortMap> {
    if let Ok(guard) = PORT_CACHE.lock()
        && let Some((at, map)) = guard.as_ref()
        && at.elapsed() < PORT_CACHE_TTL
    {
        return Some(map.clone());
    }
    let map = probe_listening_ports().await?;
    if let Ok(mut guard) = PORT_CACHE.lock() {
        *guard = Some((Instant::now(), map.clone()));
    }
    Some(map)
}

/// Lock-holder PIDs that are still running, or `None` when liveness cannot be
/// determined (callers then fall back to the lock-file heuristic).
///
/// Windows: a running CLI keeps `inuse.<pid>.hold` open, so an exclusive,
/// read-only open fails with a sharing violation while it lives and succeeds
/// once it has exited. This never writes to the file and spawns nothing.
/// Elsewhere: one `ps` listing.
#[cfg(windows)]
async fn alive_holders(
    session_state_dir: &Path,
    sessions: &[(&String, &Vec<u32>)],
) -> Option<HashSet<u32>> {
    let probes: Vec<(u32, std::path::PathBuf)> = sessions
        .iter()
        .flat_map(|(id, pids)| {
            pids.iter().map(move |pid| {
                (
                    *pid,
                    session_state_dir.join(id).join(format!("inuse.{pid}.hold")),
                )
            })
        })
        .collect();
    tokio::task::spawn_blocking(move || {
        let mut alive = HashSet::new();
        for (pid, hold) in probes {
            // Unknown (no hold file, or an unexpected error) counts as alive so
            // the lock-file heuristic still applies.
            if hold_file_held(&hold) != Some(false) {
                alive.insert(pid);
            }
        }
        alive
    })
    .await
    .ok()
}

/// `Some(true)` when another process holds `path` open, `Some(false)` when it
/// does not, `None` when that cannot be told.
#[cfg(windows)]
fn hold_file_held(path: &Path) -> Option<bool> {
    use std::os::windows::fs::OpenOptionsExt;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    match std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(path)
    {
        Ok(_) => Some(false),
        Err(e) if e.raw_os_error() == Some(ERROR_SHARING_VIOLATION) => Some(true),
        Err(_) => None,
    }
}

#[cfg(not(windows))]
async fn alive_holders(
    _session_state_dir: &Path,
    _sessions: &[(&String, &Vec<u32>)],
) -> Option<HashSet<u32>> {
    let mut cmd = tokio::process::Command::new("ps");
    cmd.args(["-A", "-o", "pid="]);
    let parse: fn(&str) -> HashSet<u32> = parse_ps_pids;
    cmd.kill_on_drop(true);
    match crate::process::run_async_with_limits(cmd, PROBE_TIMEOUT, PROBE_MAX_BYTES).await {
        Ok((stdout, _, status)) if status.success() => {
            let pids = parse(&String::from_utf8_lossy(&stdout));
            (!pids.is_empty()).then_some(pids)
        }
        Ok(_) => None,
        Err(e) => {
            tracing::debug!(error = %e, "process-list probe failed");
            None
        }
    }
}

/// Parse `ps -A -o pid=`: one PID per line.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn parse_ps_pids(output: &str) -> HashSet<u32> {
    output
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

/// `netstat -ano`, without `-p TCP`, which would leave out IPv6 sockets.
#[cfg(windows)]
async fn probe_listening_ports() -> Option<PortMap> {
    let mut cmd = crate::process::hidden_command("netstat");
    cmd.arg("-ano");
    match crate::process::run_async_with_limits(cmd, PROBE_TIMEOUT, PROBE_MAX_BYTES).await {
        Ok((stdout, _, status)) if status.success() => {
            Some(parse_netstat(&String::from_utf8_lossy(&stdout)))
        }
        Ok((_, _, status)) => {
            tracing::debug!(%status, "netstat probe failed");
            None
        }
        Err(e) => {
            tracing::debug!(error = %e, "netstat probe failed");
            None
        }
    }
}

/// `lsof` exits 1 when nothing is listening, which is an empty table rather
/// than a failure.
#[cfg(not(windows))]
async fn probe_listening_ports() -> Option<PortMap> {
    let mut cmd = tokio::process::Command::new("lsof");
    cmd.args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]);
    match crate::process::run_async_with_limits(cmd, PROBE_TIMEOUT, PROBE_MAX_BYTES).await {
        Ok((stdout, _, status)) if status.success() || status.code() == Some(1) => {
            Some(parse_lsof(&String::from_utf8_lossy(&stdout)))
        }
        Ok((_, _, status)) => {
            tracing::debug!(%status, "lsof probe failed");
            None
        }
        Err(e) => {
            tracing::debug!(error = %e, "lsof probe failed");
            None
        }
    }
}

/// Parse `netstat -ano`. The state column is localised on Windows, so a
/// listening socket is recognised by its unspecified foreign address
/// (`0.0.0.0:0` / `[::]:0`) instead of the word `LISTENING`.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_netstat(output: &str) -> PortMap {
    let mut map = PortMap::new();
    for line in output.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || !cols[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        let (local, foreign) = (cols[1], cols[2]);
        if !(foreign.ends_with(":0")) {
            continue;
        }
        let Some(address) = split_host_port(local).and_then(connect_address) else {
            continue;
        };
        let Ok(pid) = cols[cols.len() - 1].parse::<u32>() else {
            continue;
        };
        push_address(&mut map, pid, address);
    }
    map
}

/// Parse `lsof -nP -iTCP -sTCP:LISTEN -Fpn` field output.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn parse_lsof(output: &str) -> PortMap {
    let mut map = PortMap::new();
    let mut pid: Option<u32> = None;
    for line in output.lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse().ok();
        } else if let Some(name) = line.strip_prefix('n')
            && let Some(pid) = pid
            && let Some(address) = split_host_port(name).and_then(connect_address)
        {
            push_address(&mut map, pid, address);
        }
    }
    map
}

/// Add `address` once, keeping IPv4 addresses ahead of IPv6 ones.
fn push_address(map: &mut PortMap, pid: u32, address: String) {
    let addresses = map.entry(pid).or_default();
    if !addresses.contains(&address) {
        addresses.push(address);
        addresses.sort_by_key(|a| a.starts_with('['));
    }
}

fn split_host_port(addr: &str) -> Option<(&str, u16)> {
    let (host, port) = addr.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    (port != 0).then_some((host.trim_start_matches('[').trim_end_matches(']'), port))
}

/// The loopback address to connect to for a listener on `host:port`, or
/// `None` when it does not accept loopback connections.
fn connect_address((host, port): (&str, u16)) -> Option<String> {
    match host {
        "127.0.0.1" | "0.0.0.0" | "*" | "localhost" => Some(format!("127.0.0.1:{port}")),
        "::1" | "::" => Some(format!("[::1]:{port}")),
        _ => None,
    }
}

#[cfg(test)]
#[path = "live_host_tests.rs"]
mod tests;
