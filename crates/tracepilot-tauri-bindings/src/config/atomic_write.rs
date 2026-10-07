//! Crash-safe replacement of `config.toml`, keeping the last valid file as
//! its `.bak` backup.

use std::io::Write;
use std::path::{Path, PathBuf};

use super::config_backup_file_path;
use crate::error::BindingsError;

pub(super) fn atomic_replace_config(
    path: &Path,
    content: &[u8],
    backup_existing: bool,
) -> Result<(), BindingsError> {
    let mut temp_name = path.as_os_str().to_os_string();
    temp_name.push(format!(".tmp-{}", uuid::Uuid::new_v4()));
    let temp_path = PathBuf::from(temp_name);
    let mut backup_temp_path_to_cleanup = None;

    let write_result = (|| {
        let mut temp = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;
        temp.write_all(content)?;
        temp.sync_all()?;
        drop(temp);

        let backup_path = config_backup_file_path(path);
        if backup_existing {
            let mut backup_temp_name = backup_path.as_os_str().to_os_string();
            backup_temp_name.push(format!(".tmp-{}", uuid::Uuid::new_v4()));
            let backup_temp_path = PathBuf::from(backup_temp_name);
            backup_temp_path_to_cleanup = Some(backup_temp_path.clone());

            std::fs::copy(path, &backup_temp_path)?;
            std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(&backup_temp_path)?
                .sync_all()?;
            replace_file(&backup_temp_path, &backup_path, None)?;
            backup_temp_path_to_cleanup = None;
        }

        replace_file(
            &temp_path,
            path,
            backup_existing.then_some(backup_path.as_path()),
        )
    })();

    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
        if let Some(backup_temp_path) = backup_temp_path_to_cleanup {
            let _ = std::fs::remove_file(backup_temp_path);
        }
    }
    write_result
}

fn replace_file(
    source: &Path,
    destination: &Path,
    recovery: Option<&Path>,
) -> Result<(), BindingsError> {
    #[cfg(windows)]
    if destination.exists() {
        std::fs::remove_file(destination)?;
    }

    if let Err(error) = std::fs::rename(source, destination) {
        if !destination.exists()
            && let Some(recovery) = recovery
            && recovery.exists()
        {
            let _ = std::fs::copy(recovery, destination);
        }
        return Err(error.into());
    }

    Ok(())
}
