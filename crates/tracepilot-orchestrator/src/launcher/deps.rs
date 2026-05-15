//! Dependency probing (`git`, copilot CLI) and version parsing.

use crate::error::{OrchestratorError, Result};
use crate::types::SystemDependencies;
use once_cell::sync::Lazy;
use regex::Regex;

/// Matches a three-segment dotted version like `1.2.3`, anchored with word
/// boundaries so it doesn't latch onto the leading digit of a longer run
/// or the trailing `.4` in `1.2.3.4`.
static VERSION_RE: Lazy<Regex> = Lazy::new(|| {
    // unwrap_used is denied workspace-wide; this regex is a compile-time
    // constant and only fails if the pattern is malformed, which would be
    // a programmer error caught immediately by the unit tests below.
    #[allow(clippy::unwrap_used)]
    {
        Regex::new(r"\b(\d+)\.(\d+)\.(\d+)\b").unwrap()
    }
});

/// Resolve the copilot home directory.
pub fn copilot_home() -> Result<std::path::PathBuf> {
    tracepilot_core::paths::default_copilot_home_opt()
        .filter(|p| p.exists())
        .ok_or_else(|| OrchestratorError::Launch("Copilot home directory not found".into()))
}

/// Check system dependencies (git, copilot CLI).
pub fn check_dependencies(copilot_cmd: Option<&str>) -> SystemDependencies {
    let git = check_tool(
        tracepilot_core::constants::DEFAULT_GIT_COMMAND,
        &["--version"],
    );
    let cmd = copilot_cmd.unwrap_or(tracepilot_core::constants::DEFAULT_CLI_COMMAND);
    let copilot = check_tool(cmd, &["--version"]);
    let copilot_home_exists = tracepilot_core::paths::default_copilot_home_opt()
        .map(|p| p.exists())
        .unwrap_or(false);

    SystemDependencies {
        git_available: git.0,
        git_version: git.1,
        copilot_available: copilot.0,
        copilot_version: copilot.1,
        copilot_home_exists,
    }
}

pub(super) fn check_tool(name: &str, args: &[&str]) -> (bool, Option<String>) {
    // Try raw first, fallback to shell on Windows to catch aliases/functions/batch files
    // Use 5s timeout for version checks (should be instant)
    let output = match crate::process::run_hidden(name, args, None, Some(5)) {
        Ok(out) if out.status.success() => Some(out),
        _ => {
            #[cfg(windows)]
            {
                // On Windows, some tools are batch files / PowerShell shims /
                // aliases that `CreateProcess` can't find directly. Fall back
                // to resolving them through `cmd.exe /c` — but pass the args
                // as separate argv elements so nothing is re-tokenised as a
                // shell metacharacter. See Phase 1A.4.
                crate::process::run_hidden_via_cmd(name, args, None, Some(5)).ok()
            }
            #[cfg(not(windows))]
            None
        }
    };

    match output {
        Some(out) => {
            let out_str = String::from_utf8_lossy(&out.stdout);
            let err_str = String::from_utf8_lossy(&out.stderr);
            // Search both streams for a version pattern; fallback to stdout if none found
            let version = extract_version(&out_str)
                .or_else(|| extract_version(&err_str))
                .unwrap_or_else(|| out_str.trim().to_string());
            (true, Some(version))
        }
        None => (false, None),
    }
}

/// Extract a semver-like `MAJOR.MINOR.PATCH` version from a free-form string.
///
/// Returns the first match found. Uses the `regex` crate rather than a hand-
/// rolled byte scanner (see tech-debt audit finding #3).
fn extract_version(s: &str) -> Option<String> {
    let caps = VERSION_RE.captures(s)?;
    Some(format!("{}.{}.{}", &caps[1], &caps[2], &caps[3]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_home_dir_returns_something() {
        // Should always return Some on developer machines
        assert!(tracepilot_core::utils::home_dir_opt().is_some());
    }

    #[test]
    fn test_extract_version_positive_cases() {
        assert_eq!(
            extract_version("GitHub Copilot CLI 1.0.9. Run 'copilot update' to check for updates."),
            Some("1.0.9".to_string())
        );
        assert_eq!(
            extract_version("git version 2.45.1.windows.1"),
            Some("2.45.1".to_string())
        );
        assert_eq!(extract_version("1.0.8"), Some("1.0.8".to_string()));
        assert_eq!(
            extract_version("version 10.12.3 (build abc)"),
            Some("10.12.3".to_string())
        );
    }

    #[test]
    fn test_extract_version_negative() {
        assert_eq!(extract_version("unknown"), None);
        assert_eq!(extract_version("no version here"), None);
        assert_eq!(extract_version("just 1.2 dots"), None);
    }

    #[test]
    fn test_extract_version_first_match_wins() {
        assert_eq!(
            extract_version("foo 1.2.3 bar 4.5.6"),
            Some("1.2.3".to_string())
        );
    }
}
