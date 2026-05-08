//! App-info service: install-type detection and git info.
//!
//! Pure logic + a single blocking-friendly entry point. The
//! `commands::state::get_install_type` / `get_git_info` shells delegate here.

use std::ffi::OsStr;
use std::path::Path;

use tracing::warn;

use crate::types::GitInfo;

/// Returns the installation type as a stable string (`"source"`,
/// `"installed"`, or `"portable"`) for the current process.
pub(crate) fn get_install_type_string() -> String {
    let appimage_env = std::env::var_os("APPIMAGE");
    let exe = std::env::current_exe().ok();
    detect_install_type(exe.as_deref(), appimage_env.as_deref())
        .as_str()
        .to_string()
}

/// Collect short commit hash + branch for the current repo on a blocking
/// worker, with a 5-second timeout per `git` invocation so a hung git binary
/// (e.g. waiting for credentials) cannot stall the UI.
pub(crate) async fn get_git_info() -> GitInfo {
    match tokio::task::spawn_blocking(|| collect_git_info_with_timeout(5)).await {
        Ok(info) => info,
        Err(e) => {
            warn!(error = %e, "get_git_info worker task failed");
            GitInfo {
                commit_hash: None,
                branch: None,
            }
        }
    }
}

fn detect_install_type(exe: Option<&Path>, appimage_env: Option<&OsStr>) -> InstallType {
    if cfg!(debug_assertions) {
        return InstallType::Source;
    }
    match exe {
        Some(exe) => detect_install_type_for(exe, appimage_env, PlatformKind::current()),
        None => InstallType::Portable,
    }
}

pub(crate) fn collect_git_info_with_timeout(timeout_secs: u64) -> GitInfo {
    git_info_from_runner(|args| {
        tracepilot_orchestrator::process::run_hidden(
            tracepilot_core::constants::DEFAULT_GIT_COMMAND,
            args,
            None,
            Some(timeout_secs),
        )
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    })
}

fn git_info_from_runner<F>(mut run: F) -> GitInfo
where
    F: FnMut(&[&str]) -> Option<String>,
{
    GitInfo {
        commit_hash: run(&["rev-parse", "--short", "HEAD"]),
        branch: run(&["rev-parse", "--abbrev-ref", "HEAD"]),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InstallType {
    Source,
    Installed,
    Portable,
}

impl InstallType {
    fn as_str(self) -> &'static str {
        match self {
            InstallType::Source => "source",
            InstallType::Installed => "installed",
            InstallType::Portable => "portable",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PlatformKind {
    Windows,
    Mac,
    Linux,
    Other,
}

impl PlatformKind {
    fn current() -> Self {
        if cfg!(target_os = "windows") {
            PlatformKind::Windows
        } else if cfg!(target_os = "macos") {
            PlatformKind::Mac
        } else if cfg!(target_os = "linux") {
            PlatformKind::Linux
        } else {
            PlatformKind::Other
        }
    }
}

fn detect_install_type_for(
    exe: &Path,
    appimage_env: Option<&OsStr>,
    platform: PlatformKind,
) -> InstallType {
    match platform {
        PlatformKind::Windows => {
            if is_windows_installed(exe) {
                InstallType::Installed
            } else {
                InstallType::Portable
            }
        }
        PlatformKind::Mac => {
            if is_macos_app_bundle(exe) {
                InstallType::Installed
            } else {
                InstallType::Portable
            }
        }
        PlatformKind::Linux => {
            if is_linux_appimage(exe, appimage_env) {
                InstallType::Portable
            } else if is_linux_system_install(exe) {
                InstallType::Installed
            } else {
                InstallType::Portable
            }
        }
        PlatformKind::Other => InstallType::Portable,
    }
}

fn normalize_path(exe: &Path) -> String {
    exe.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn is_windows_installed(exe: &Path) -> bool {
    let path_str = normalize_path(exe);
    let looks_like_program_files =
        path_str.contains("/program files/") || path_str.contains("/program files (x86)/");
    let looks_like_local_programs = path_str.contains("/appdata/local/programs/")
        || path_str.contains("/appdata/local/dev.tracepilot.app/");

    if looks_like_program_files || looks_like_local_programs {
        return true;
    }

    // NSIS leaves an uninstaller (unins*.exe) beside the app when installed.
    // Heuristic: may false-positive if a portable exe sits in a directory that
    // happens to contain another app's uninstaller. Acceptable for v1 since
    // the path-based checks above cover the standard install locations.
    if let Some(dir) = exe.parent()
        && let Ok(entries) = std::fs::read_dir(dir)
    {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy().to_lowercase();
            if name.starts_with("unins")
                && entry
                    .path()
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
            {
                return true;
            }
        }
    }

    false
}

fn is_macos_app_bundle(exe: &Path) -> bool {
    exe.ancestors().any(|ancestor| {
        ancestor
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|name| name.ends_with(".app"))
    })
}

fn is_linux_appimage(exe: &Path, appimage_env: Option<&OsStr>) -> bool {
    appimage_env.is_some_and(|v| !v.is_empty())
        || exe
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("appimage"))
}

fn is_linux_system_install(exe: &Path) -> bool {
    let path_str = normalize_path(exe);
    path_str.starts_with("/usr/") || path_str.starts_with("/opt/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn git_info_from_runner_uses_runner_values() {
        let mut calls = Vec::new();
        let info = git_info_from_runner(|args| {
            calls.push(args.join(" "));
            if args.contains(&"--abbrev-ref") {
                Some("main".to_string())
            } else {
                Some("abc123".to_string())
            }
        });

        assert_eq!(info.commit_hash.as_deref(), Some("abc123"));
        assert_eq!(info.branch.as_deref(), Some("main"));
        assert_eq!(
            calls,
            vec!["rev-parse --short HEAD", "rev-parse --abbrev-ref HEAD"]
        );
    }

    #[test]
    fn git_info_from_runner_allows_missing_values() {
        let info = git_info_from_runner(|_| None);
        assert!(info.commit_hash.is_none());
        assert!(info.branch.is_none());
    }

    #[test]
    fn windows_program_files_counts_as_installed() {
        let exe = PathBuf::from("C:\\Program Files\\TracePilot\\tracepilot.exe");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Windows);
        assert_eq!(install_type, InstallType::Installed);
    }

    #[test]
    fn windows_uninstaller_flagged_as_installed() {
        let dir = tempdir().unwrap();
        let exe = dir.path().join("TracePilot.exe");
        File::create(&exe).unwrap();
        let mut unins = File::create(dir.path().join("unins000.exe")).unwrap();
        writeln!(unins, "dummy").unwrap();

        let install_type = detect_install_type_for(&exe, None, PlatformKind::Windows);
        assert_eq!(install_type, InstallType::Installed);
    }

    #[test]
    fn windows_downloads_counts_as_portable() {
        let exe = PathBuf::from("C:\\Users\\me\\Downloads\\TracePilot.exe");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Windows);
        assert_eq!(install_type, InstallType::Portable);
    }

    #[test]
    fn macos_app_bundle_counts_as_installed() {
        let exe = PathBuf::from("/Applications/TracePilot.app/Contents/MacOS/TracePilot");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Mac);
        assert_eq!(install_type, InstallType::Installed);
    }

    #[test]
    fn macos_loose_binary_is_portable() {
        let exe = PathBuf::from("/Users/me/Downloads/TracePilot");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Mac);
        assert_eq!(install_type, InstallType::Portable);
    }

    #[test]
    fn linux_appimage_is_portable() {
        let exe = PathBuf::from("/home/me/TracePilot.AppImage");
        let install_type = detect_install_type_for(
            &exe,
            Some(OsStr::new("/home/me/TracePilot.AppImage")),
            PlatformKind::Linux,
        );
        assert_eq!(install_type, InstallType::Portable);
    }

    #[test]
    fn linux_usr_install_is_installed() {
        let exe = PathBuf::from("/usr/lib/tracepilot/tracepilot");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Linux);
        assert_eq!(install_type, InstallType::Installed);
    }

    #[test]
    fn linux_opt_install_is_installed() {
        let exe = PathBuf::from("/opt/tracepilot/tracepilot");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Linux);
        assert_eq!(install_type, InstallType::Installed);
    }

    #[test]
    fn linux_appimage_extension_only_is_portable() {
        let exe = PathBuf::from("/home/me/TracePilot.AppImage");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Linux);
        assert_eq!(install_type, InstallType::Portable);
    }

    #[test]
    fn linux_home_binary_is_portable() {
        let exe = PathBuf::from("/home/me/bin/tracepilot");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Linux);
        assert_eq!(install_type, InstallType::Portable);
    }

    #[test]
    fn empty_appimage_env_not_treated_as_appimage() {
        let exe = PathBuf::from("/home/me/tracepilot");
        let install_type = detect_install_type_for(&exe, Some(OsStr::new("")), PlatformKind::Linux);
        assert_eq!(install_type, InstallType::Portable);
    }

    #[test]
    fn windows_appdata_local_programs_is_installed() {
        let exe =
            PathBuf::from("C:\\Users\\me\\AppData\\Local\\Programs\\TracePilot\\tracepilot.exe");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Windows);
        assert_eq!(install_type, InstallType::Installed);
    }

    #[test]
    fn windows_program_files_x86_is_installed() {
        let exe = PathBuf::from("C:\\Program Files (x86)\\TracePilot\\tracepilot.exe");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Windows);
        assert_eq!(install_type, InstallType::Installed);
    }

    #[test]
    fn other_platform_is_portable() {
        let exe = PathBuf::from("/some/path/tracepilot");
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Other);
        assert_eq!(install_type, InstallType::Portable);
    }

    #[test]
    fn macos_nested_app_bundle_is_installed() {
        let exe = PathBuf::from(
            "/Users/me/MyApps/Wrapper.app/Contents/Helpers/TracePilot.app/Contents/MacOS/tp",
        );
        let install_type = detect_install_type_for(&exe, None, PlatformKind::Mac);
        assert_eq!(install_type, InstallType::Installed);
    }
}
