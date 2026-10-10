//! Logging Tauri commands (2 commands).

use std::path::PathBuf;

use crate::blocking_cmd;
use crate::error::{BindingsError, CmdResult};
use tauri::Manager;
use tracepilot_core::paths::DataRootError;
use tracepilot_core::utils::InfallibleWrite;

/// The folder the log plugin writes to: `<data root>/logs` for an isolated
/// instance, the platform's per-app log folder otherwise.
pub(crate) fn app_log_dir(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    log_dir_from(tracepilot_core::paths::isolated_log_dir(), || {
        Ok(app.path().app_log_dir()?)
    })
}

/// An invalid isolation root fails closed rather than falling back to the
/// shared platform folder.
fn log_dir_from(
    isolated: Result<Option<PathBuf>, DataRootError>,
    platform: impl FnOnce() -> CmdResult<PathBuf>,
) -> CmdResult<PathBuf> {
    match isolated {
        Ok(Some(dir)) => Ok(dir),
        Ok(None) => platform(),
        Err(error) => Err(BindingsError::Validation(error.to_string())),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn get_log_path(app: tauri::AppHandle) -> CmdResult<String> {
    let log_dir = app_log_dir(&app)?;
    Ok(log_dir.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn export_logs(app: tauri::AppHandle, destination: String) -> CmdResult<String> {
    let log_dir = app_log_dir(&app)?;

    blocking_cmd!({
        use std::io::Read;

        let dest = std::path::PathBuf::from(destination);

        if !dest.is_absolute() {
            return Err(BindingsError::Validation(
                "Destination path must be absolute".into(),
            ));
        }

        if !log_dir.exists() {
            return Err(BindingsError::Validation(
                "Log directory does not exist".into(),
            ));
        }

        let mut log_files: Vec<_> = std::fs::read_dir(&log_dir)?
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let path = entry.path();
                let name = path.file_name()?.to_string_lossy().to_string();
                if name.starts_with("TracePilot") && name.contains(".log") {
                    Some(path)
                } else {
                    None
                }
            })
            .collect();

        log_files.sort_by_key(|f| {
            f.metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });

        if log_files.is_empty() {
            return Err(BindingsError::Validation("No log files found".into()));
        }

        let total_size: u64 = log_files
            .iter()
            .filter_map(|f| f.metadata().ok())
            .map(|m| m.len())
            .sum();
        if total_size > 50_000_000 {
            return Err(BindingsError::Validation(format!(
                "Log files total {:.1}MB — too large to export. Clear old logs first.",
                total_size as f64 / 1_000_000.0
            )));
        }

        let mut combined = String::new();
        let mut exported_count = 0usize;
        for file in &log_files {
            let mut opts = std::fs::OpenOptions::new();
            opts.read(true);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE
                opts.share_mode(7);
            }
            match opts.open(file) {
                Ok(mut f) => {
                    let mut content = String::new();
                    if f.read_to_string(&mut content).is_ok() {
                        combined.push_fmt(format_args!(
                            "=== {} ===\n",
                            file.file_name().unwrap_or_default().to_string_lossy()
                        ));
                        combined.push_str(&content);
                        combined.push('\n');
                        exported_count += 1;
                    }
                }
                Err(_) => continue,
            }
        }

        if exported_count == 0 {
            return Err(BindingsError::Validation(
                "Could not read any log files (all locked or unreadable)".into(),
            ));
        }

        std::fs::write(&dest, &combined)?;

        let msg = if exported_count < log_files.len() {
            format!(
                "Exported {} of {} log file(s) to {} ({} skipped)",
                exported_count,
                log_files.len(),
                dest.display(),
                log_files.len() - exported_count
            )
        } else {
            format!(
                "Exported {} log file(s) to {}",
                exported_count,
                dest.display()
            )
        };
        Ok::<_, BindingsError>(msg)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unused_platform() -> CmdResult<PathBuf> {
        panic!("the platform log folder must not be consulted")
    }

    #[test]
    fn isolated_instance_reports_its_own_log_folder() {
        let dir = PathBuf::from("instance-root").join("logs");
        assert_eq!(
            log_dir_from(Ok(Some(dir.clone())), unused_platform).unwrap(),
            dir
        );
    }

    #[test]
    fn unisolated_process_reports_the_platform_log_folder() {
        let platform = PathBuf::from("platform-logs");
        let resolved = log_dir_from(Ok(None), || Ok(platform.clone())).unwrap();
        assert_eq!(resolved, platform);
    }

    #[test]
    fn invalid_isolation_root_fails_closed() {
        let error = DataRootError::Relative(PathBuf::from("relative"));
        let result = log_dir_from(Err(error), unused_platform);
        assert!(matches!(result, Err(BindingsError::Validation(_))));
    }
}
