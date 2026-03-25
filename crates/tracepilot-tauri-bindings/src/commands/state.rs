//! State/system Tauri commands (6 commands).

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{open_index_db, read_config};
use crate::types::{GitInfo, UpdateCheckResult};
use std::ffi::OsStr;
use std::path::Path;

#[tauri::command]
pub async fn get_db_size(state: tauri::State<'_, SharedConfig>) -> CmdResult<u64> {
    let index_path = read_config(&state).index_db_path();

    tokio::task::spawn_blocking(move || {
        Ok(std::fs::metadata(&index_path).map(|m| m.len()).unwrap_or(0))
    })
    .await?
}

/// Check if a session is currently running by looking for `inuse.*.lock` files.
#[tauri::command]
pub async fn is_session_running(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<bool> {
    let session_state_dir = read_config(&state).session_state_dir();

    tokio::task::spawn_blocking(move || {
        let path = tracepilot_core::session::discovery::resolve_session_path_in(
            &session_id,
            &session_state_dir,
        )?;
        Ok(tracepilot_core::session::discovery::has_lock_file(&path))
    })
    .await?
}

#[tauri::command]
pub async fn get_session_count(state: tauri::State<'_, SharedConfig>) -> CmdResult<usize> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();

    tokio::task::spawn_blocking(move || {
        if let Some(db) = open_index_db(&index_path) {
            if let Ok(count) = db.session_count() {
                return Ok(count);
            }
        }
        Ok(tracepilot_core::session::discovery::discover_sessions(&session_state_dir)?.len())
    })
    .await?
}

/// Returns the installation type: "source", "installed", or "portable".
#[tauri::command]
pub fn get_install_type() -> String {
    let appimage_env = std::env::var_os("APPIMAGE");
    let exe = std::env::current_exe().ok();
    detect_install_type(exe.as_deref(), appimage_env.as_deref())
        .as_str()
        .to_string()
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

#[tauri::command]
pub async fn check_for_updates() -> CmdResult<UpdateCheckResult> {
    let current_str = env!("CARGO_PKG_VERSION");
    let current = semver::Version::parse(current_str)?;

    let client = reqwest::Client::builder()
        .user_agent(format!("TracePilot/{current_str}"))
        .timeout(std::time::Duration::from_secs(8))
        .build()?;

    let response = client
        .get("https://api.github.com/repos/MattShelton04/TracePilot/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await?;

    match response.status().as_u16() {
        404 => {
            return Ok(UpdateCheckResult {
                current_version: current_str.to_string(),
                latest_version: None,
                has_update: false,
                release_url: None,
                published_at: None,
            });
        }
        429 | 403 => {
            return Err(BindingsError::Validation(
                "GitHub API rate limit reached. Try again later.".into(),
            ));
        }
        s if s >= 500 => {
            return Err(BindingsError::Validation(format!(
                "GitHub API error: HTTP {s}"
            )));
        }
        _ => {}
    }

    let release: serde_json::Value = response.json().await?;

    let latest_str = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');

    let has_update = semver::Version::parse(latest_str)
        .map(|latest| latest > current)
        .unwrap_or(false);

    Ok(UpdateCheckResult {
        current_version: current_str.to_string(),
        latest_version: Some(latest_str.to_string()),
        has_update,
        release_url: release["html_url"].as_str().map(String::from),
        published_at: release["published_at"].as_str().map(String::from),
    })
}

#[tauri::command]
pub async fn get_git_info() -> GitInfo {
    let run = |args: &[&str]| -> Option<String> {
        tracepilot_orchestrator::process::run_hidden("git", args, None)
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
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
    if let Some(dir) = exe.parent() {
        if let Ok(entries) = std::fs::read_dir(dir) {
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
        let install_type =
            detect_install_type_for(&exe, Some(OsStr::new("")), PlatformKind::Linux);
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
