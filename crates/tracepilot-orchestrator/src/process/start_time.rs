//! When a process started, so a pid file can be checked against the process
//! that now holds its pid.

/// When the process `pid` started, in the format Claude Code records as
/// `procStart`: on Windows, its creation FILETIME (100 ns ticks since 1601,
/// UTC) as a decimal string. `None` when no such process exists, it has
/// exited, or its time cannot be read (for example access is denied), and
/// always on other platforms, whose format is unknown.
///
/// Two Win32 calls on an open handle, so it costs microseconds.
pub fn process_start_time(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        win32::creation_filetime(pid).map(|ticks| ticks.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        None
    }
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
