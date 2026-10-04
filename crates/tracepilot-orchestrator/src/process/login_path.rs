//! Restore the login-shell `PATH` for a macOS app opened from Finder.
//!
//! launchd starts Finder- and Dock-launched apps with a minimal `PATH`
//! (`/usr/bin:/bin:/usr/sbin:/sbin`), so a `copilot` installed through
//! Homebrew, npm, nvm and similar tools is invisible, along with the `node`
//! its launcher needs. Discovery, dependency probes and the SDK all read the
//! process `PATH`, so it is fixed once, first thing in `main`: ask the user's
//! login shell for its `PATH` and re-exec with it. Re-exec keeps the process
//! id and avoids `std::env::set_var`, which is `unsafe` and forbidden in this
//! workspace.

use std::collections::HashSet;

const START_MARKER: &str = "__TRACEPILOT_PATH_START__";
const END_MARKER: &str = "__TRACEPILOT_PATH_END__";

/// On macOS, re-exec the current binary with the login shell's `PATH` when
/// it adds entries the process lacks. Call before anything else in `main`.
/// Returns when nothing needs changing or the restore fails; a no-op on
/// other platforms.
pub fn restore_login_shell_path() {
    #[cfg(target_os = "macos")]
    macos::restore();
}

/// The `PATH` printed between the markers, ignoring any profile output
/// around it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn extract_marked_path(stdout: &str) -> Option<&str> {
    let start = stdout.find(START_MARKER)? + START_MARKER.len();
    let rest = &stdout[start..];
    let path = rest[..rest.find(END_MARKER)?].trim();
    path.split(':')
        .any(|entry| entry.starts_with('/'))
        .then_some(path)
}

/// Login-shell entries first, then current entries it lacks. `None` when the
/// current `PATH` already contains every login-shell entry.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn merge_path(login: &str, current: &str) -> Option<String> {
    let present: HashSet<&str> = current.split(':').collect();
    if login
        .split(':')
        .all(|entry| entry.is_empty() || present.contains(entry))
    {
        return None;
    }
    let mut seen = HashSet::new();
    let merged: Vec<&str> = login
        .split(':')
        .chain(current.split(':'))
        .filter(|entry| !entry.is_empty() && seen.insert(*entry))
        .collect();
    Some(merged.join(":"))
}

#[cfg(target_os = "macos")]
mod macos {
    use std::os::unix::process::CommandExt;
    use std::process::Command;

    use super::*;

    /// Set on the re-exec so the restore runs at most once per launch.
    const RESTORED_ENV: &str = "TRACEPILOT_LOGIN_PATH_RESTORED";
    /// A slow or interactive shell profile must not stall startup for long.
    const SHELL_TIMEOUT_SECS: u64 = 5;

    // Logging is not initialized this early in startup.
    #[allow(clippy::print_stderr)]
    pub(super) fn restore() {
        if std::env::var_os(RESTORED_ENV).is_some() {
            return;
        }
        let current = std::env::var("PATH").unwrap_or_default();
        let Some(merged) = login_shell_path().and_then(|login| merge_path(&login, &current)) else {
            return;
        };
        let Ok(exe) = std::env::current_exe() else {
            return;
        };
        let error = Command::new(exe)
            .args(std::env::args_os().skip(1))
            .env("PATH", merged)
            .env(RESTORED_ENV, "1")
            .exec();
        // `exec` only returns on failure; continue with the original PATH.
        eprintln!("warning: could not restore the login shell PATH: {error}");
    }

    fn login_shell_path() -> Option<String> {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| shell.starts_with('/'))
            .unwrap_or_else(|| "/bin/zsh".to_string());
        // Interactive login, like Terminal: Homebrew is usually set up in
        // .zprofile and nvm/fnm in .zshrc. fish joins quoted `$PATH` with ':'.
        let script = format!("printf '%s%s%s' '{START_MARKER}' \"$PATH\" '{END_MARKER}'");
        let output = crate::process::run_hidden(
            &shell,
            &["-ilc", script.as_str()],
            None,
            Some(SHELL_TIMEOUT_SECS),
        )
        .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        extract_marked_path(&stdout).map(str::to_owned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_path_between_markers_despite_profile_noise() {
        let stdout = format!("Welcome!\n{START_MARKER}/opt/homebrew/bin:/usr/bin{END_MARKER}\nbye");
        assert_eq!(
            extract_marked_path(&stdout),
            Some("/opt/homebrew/bin:/usr/bin")
        );
    }

    #[test]
    fn rejects_missing_markers_or_unusable_paths() {
        assert_eq!(extract_marked_path("/usr/bin"), None);
        assert_eq!(
            extract_marked_path(&format!("{START_MARKER}/usr/bin")),
            None
        );
        assert_eq!(
            extract_marked_path(&format!("{START_MARKER}{END_MARKER}")),
            None
        );
        assert_eq!(
            extract_marked_path(&format!("{START_MARKER}relative{END_MARKER}")),
            None
        );
    }

    #[test]
    fn prepends_login_entries_and_keeps_current_ones() {
        assert_eq!(
            merge_path(
                "/opt/homebrew/bin:/usr/bin:/bin",
                "/usr/bin:/bin:/usr/sbin:/sbin"
            )
            .as_deref(),
            Some("/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        );
    }

    #[test]
    fn skips_when_current_path_already_has_every_login_entry() {
        assert_eq!(
            merge_path(
                "/usr/bin:/opt/homebrew/bin",
                "/opt/homebrew/bin:/usr/bin:/sbin"
            ),
            None
        );
        assert_eq!(merge_path("", "/usr/bin"), None);
    }

    #[test]
    fn drops_empty_and_duplicate_entries() {
        assert_eq!(
            merge_path("/a::/a:/b", "/b::/c").as_deref(),
            Some("/a:/b:/c")
        );
    }
}
