//! Where Claude Code keeps per-session scratch files outside its config
//! folder.

use std::path::PathBuf;

/// Claude Code's own override for the parent of its temp folder.
pub const CLAUDE_CODE_TMPDIR_ENV: &str = "CLAUDE_CODE_TMPDIR";

/// The temp folder Claude Code writes per-session scratch files to
/// (`<project>/<session>/scratchpad/`, background task output, pasted
/// images): `claude-tmp` under the isolation root when one is set, else
/// `CLAUDE_CODE_TMPDIR` or the system temp folder (`/tmp` on macOS, as
/// Claude Code does), joined with `claude` on Windows or `claude-<uid>`
/// elsewhere.
///
/// Only this process's environment is seen: a `CLAUDE_CODE_TMPDIR` set in
/// Claude Code's own settings is not.
pub fn default_claude_temp_dir_opt() -> Option<PathBuf> {
    match super::isolated_data_root() {
        Ok(Some(root)) => Some(root.join("claude-tmp")),
        Ok(None) => {
            let parent = std::env::var_os(CLAUDE_CODE_TMPDIR_ENV)
                .map(PathBuf::from)
                .filter(|path| !path.as_os_str().is_empty())
                .unwrap_or_else(system_temp_dir);
            claude_temp_dir_name().map(|name| parent.join(name))
        }
        Err(_) => None,
    }
}

fn system_temp_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        PathBuf::from("/tmp")
    } else {
        std::env::temp_dir()
    }
}

#[cfg(windows)]
fn claude_temp_dir_name() -> Option<String> {
    Some("claude".into())
}

/// `claude-<uid>`. The uid is read from the home folder's owner, which is
/// the current user's without needing `getuid` (unsafe code is denied).
#[cfg(unix)]
fn claude_temp_dir_name() -> Option<String> {
    use std::os::unix::fs::MetadataExt as _;
    let home = crate::utils::home_dir_opt()?;
    let uid = std::fs::metadata(home).ok()?.uid();
    Some(format!("claude-{uid}"))
}

#[cfg(not(any(windows, unix)))]
fn claude_temp_dir_name() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_is_named_as_claude_code_names_it() {
        let name = claude_temp_dir_name().unwrap();
        if cfg!(windows) {
            assert_eq!(name, "claude");
        } else {
            let uid = name.strip_prefix("claude-").unwrap();
            assert!(uid.parse::<u32>().is_ok(), "{name}");
        }
    }
}
