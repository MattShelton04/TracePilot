//! When a process started, so a pid file can be checked against the process
//! that now holds its pid.

use std::collections::HashMap;

/// When the process `pid` started, in the format Claude Code records as
/// `procStart`. `None` when no such process exists, it has exited, or its
/// time cannot be read (for example access is denied).
///
/// - Windows: its creation FILETIME (100 ns ticks since 1601, UTC) as a
///   decimal string, from two Win32 calls on an open handle (microseconds).
/// - Linux: `starttime` from `/proc/<pid>/stat` (clock ticks since boot).
/// - macOS: `ps -o lstart=` in the C locale and UTC, trimmed (for example
///   `Sat Oct 10 02:37:47 2026`). This spawns `ps`, so to check several
///   pids use [`process_start_times`], which spawns it once.
pub fn process_start_time(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        win32::creation_filetime(pid).map(|ticks| ticks.to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        parse_proc_stat_start(&stat)
    }
    #[cfg(target_os = "macos")]
    {
        ps_start_times_within(&[pid], PS_TIMEOUT_SECS).remove(&pid)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        None
    }
}

/// [`process_start_time`] for each of `pids`, keyed by pid. A pid with no
/// process, or whose time cannot be read, is absent. On macOS this is one
/// `ps` for every pid; elsewhere each pid is read as [`process_start_time`]
/// reads it.
pub fn process_start_times(pids: &[u32]) -> HashMap<u32, String> {
    #[cfg(target_os = "macos")]
    {
        // No macOS process has a larger pid, and `ps` rejects the whole list
        // over one, so leave such pids out rather than ask each pid alone.
        let pids: Vec<u32> = pids
            .iter()
            .copied()
            .filter(|&pid| pid <= MACOS_PID_MAX)
            .collect();
        ps_start_times_within(&pids, PS_TIMEOUT_SECS)
    }
    #[cfg(not(target_os = "macos"))]
    {
        pids.iter()
            .filter_map(|&pid| Some((pid, process_start_time(pid)?)))
            .collect()
    }
}

#[cfg(target_os = "macos")]
const PS_TIMEOUT_SECS: u64 = 10;

/// The largest pid macOS hands out (xnu's `PID_MAX`).
#[cfg(target_os = "macos")]
const MACOS_PID_MAX: u32 = 99_999;

/// `starttime`, field 22 of a `/proc/<pid>/stat` line. The command name in
/// field 2 may contain spaces and parentheses, so fields are counted from the
/// last `)`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn parse_proc_stat_start(stat: &str) -> Option<String> {
    let after_comm = stat.get(stat.rfind(')')? + 1..)?;
    // Field 3 (state) is the first after the command name.
    let start = after_comm.split_whitespace().nth(22 - 3)?;
    start
        .bytes()
        .all(|b| b.is_ascii_digit())
        .then(|| start.to_owned())
}

/// The start times of `pids` from one `ps -o pid= -o lstart=`, as `ps` prints
/// `lstart` in the C locale and UTC, which is what Claude Code records on
/// macOS. Built for every unix so Linux CI exercises the macOS lookup.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn ps_start_times_within(pids: &[u32], timeout_secs: u64) -> HashMap<u32, String> {
    let Some((stdout, stderr, success)) = run_ps(pids, timeout_secs) else {
        return HashMap::new();
    };
    // `ps` exits non-zero, silently, when no listed pid has a process. It
    // writes to stderr when it rejects the whole list (a pid out of its
    // range), so then each pid is asked alone.
    if !success && !stderr.trim().is_empty() && pids.len() > 1 {
        return pids
            .iter()
            .filter_map(|&pid| {
                Some((
                    pid,
                    ps_start_times_within(&[pid], timeout_secs).remove(&pid)?,
                ))
            })
            .collect();
    }
    parse_ps_start_times(&stdout, pids)
}

/// `ps -o pid= -o lstart= -p <pids>`: its stdout, stderr and whether it
/// succeeded. `None` for no pids, or when `ps` cannot run or times out.
#[cfg(unix)]
fn run_ps(pids: &[u32], timeout_secs: u64) -> Option<(String, String, bool)> {
    use super::hidden::hidden_std_command;
    use super::timeout::{execute_with_timeout, spawn_captured_child};

    if pids.is_empty() {
        return None;
    }
    let list: Vec<String> = pids.iter().map(u32::to_string).collect();
    let mut cmd = hidden_std_command("ps");
    // One `-o` per column: POSIX lets the text after `=` run to the end of
    // its argument, so `pid=,lstart=` could name only `pid`.
    cmd.args(["-o", "pid=", "-o", "lstart=", "-p", &list.join(",")])
        .env("LC_ALL", "C")
        .env("TZ", "UTC")
        .stdin(std::process::Stdio::null());
    let child = spawn_captured_child(cmd, "ps").ok()?;
    let (stdout, stderr, status) = execute_with_timeout(child, timeout_secs).ok()?;
    Some((
        String::from_utf8_lossy(&stdout).into_owned(),
        String::from_utf8_lossy(&stderr).into_owned(),
        status.success(),
    ))
}

/// The start times in `ps -o pid= -o lstart=` output, for the pids in `pids`.
/// Each line is a pid, whitespace, then the start time, whose inner spacing
/// is kept as `ps` prints it (`Sat Oct  3 ...` pads the day), since that is
/// what Claude Code records. Lines for another pid, without a start time or
/// of any other shape are skipped; the first line for a pid wins.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn parse_ps_start_times(stdout: &str, pids: &[u32]) -> HashMap<u32, String> {
    let mut starts = HashMap::new();
    for line in stdout.lines() {
        let line = line.trim();
        let digits = line.bytes().take_while(u8::is_ascii_digit).count();
        let (pid, start) = line.split_at(digits);
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        if !start.starts_with(char::is_whitespace) || !pids.contains(&pid) {
            continue;
        }
        let start = start.trim();
        if !start.is_empty() {
            starts.entry(pid).or_insert_with(|| start.to_owned());
        }
    }
    starts
}

/// The FFI behind [`super::process_start_time`]: kernel32 calls on one handle that
/// [`ProcessHandle`] owns and closes. Keep any other unsafe code out of it.
#[cfg(windows)]
#[allow(unsafe_code)]
mod win32 {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    /// An open process handle, closed on drop.
    struct ProcessHandle(HANDLE);

    impl ProcessHandle {
        /// Opens `pid` for the least access that reads its times. `None` for
        /// a pid with no process, or one this user may not query.
        fn open(pid: u32) -> Option<Self> {
            // SAFETY: OpenProcess takes no pointers. It returns either a new
            // handle, which this guard then owns, or null on failure.
            let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
            (!handle.is_null()).then_some(Self(handle))
        }

        /// Whether the process is still running. A handle can outlive its
        /// process (here, or in any other holder), so opening alone does not
        /// prove the process is alive.
        fn is_running(&self) -> bool {
            let mut code = 0u32;
            // SAFETY: `self.0` is an open handle with query access, and `code`
            // is a live u32 the call writes once.
            let ok = unsafe { GetExitCodeProcess(self.0, &mut code) } != 0;
            // A process that exited with code 259 (STILL_ACTIVE) reads as
            // running. Windows documents that ambiguity; such codes are rare.
            ok && code == STILL_ACTIVE as u32
        }

        fn creation_time(&self) -> Option<u64> {
            let zero = FILETIME {
                dwLowDateTime: 0,
                dwHighDateTime: 0,
            };
            let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
            // SAFETY: `self.0` is an open handle with query access, and each
            // pointer is a distinct live FILETIME the call writes once.
            let ok = unsafe {
                GetProcessTimes(self.0, &mut created, &mut exited, &mut kernel, &mut user)
            } != 0;
            ok.then(|| filetime_ticks(created))
        }
    }

    impl Drop for ProcessHandle {
        fn drop(&mut self) {
            // SAFETY: `self.0` came from a successful OpenProcess, is owned by
            // this guard alone and is closed exactly once, here.
            unsafe { CloseHandle(self.0) };
        }
    }

    /// `pid`'s creation time in 100 ns ticks since 1601 (UTC), while it runs.
    pub(super) fn creation_filetime(pid: u32) -> Option<u64> {
        let process = ProcessHandle::open(pid)?;
        if !process.is_running() {
            return None;
        }
        process.creation_time().filter(|ticks| *ticks > 0)
    }

    fn filetime_ticks(time: FILETIME) -> u64 {
        (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
    }
}
