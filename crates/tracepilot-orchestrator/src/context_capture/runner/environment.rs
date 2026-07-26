use super::super::MAX_SESSION_COPY_BYTES;
use super::super::snapshot::{set_private_dir_permissions, set_private_file_permissions};
use crate::error::{OrchestratorError, Result};
use sha2::{Digest, Sha256};
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};

pub(super) fn copy_environment_context(source_home: &Path, destination_home: &Path) -> Result<u64> {
    const FILES: &[&str] = &["settings.json", "mcp-config.json"];
    const DIRECTORIES: &[&str] = &["skills", "prompts", "hooks", "agents", "plugins"];
    let mut copied_bytes = 0u64;
    copied_bytes = copied_bytes.saturating_add(copy_sanitized_cli_config(
        &source_home.join("config.json"),
        &destination_home.join("config.json"),
    )?);
    for name in FILES {
        let source = source_home.join(name);
        if source.is_file() {
            copied_bytes = copied_bytes
                .saturating_add(copy_context_file(&source, &destination_home.join(name))?);
        }
    }
    for name in DIRECTORIES {
        let source = source_home.join(name);
        if !source.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(&source).follow_links(false) {
            let entry = entry?;
            let metadata = std::fs::symlink_metadata(entry.path())?;
            if metadata.file_type().is_symlink() {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Configured context contains a symbolic link: {}",
                    entry.path().display()
                )));
            }
            let relative = entry.path().strip_prefix(source_home).map_err(|_| {
                OrchestratorError::ContextCapture(
                    "Configured context path escaped the Copilot home.".into(),
                )
            })?;
            let destination = destination_home.join(relative);
            if metadata.is_dir() {
                std::fs::create_dir_all(&destination)?;
                set_private_dir_permissions(&destination)?;
            } else if metadata.is_file() {
                copied_bytes =
                    copied_bytes.saturating_add(copy_context_file(entry.path(), &destination)?);
            } else {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Configured context contains a non-regular entry: {}",
                    entry.path().display()
                )));
            }
            if copied_bytes > MAX_SESSION_COPY_BYTES {
                return Err(OrchestratorError::ContextCapture(format!(
                    "Configured context exceeds the {} MiB temporary-copy limit.",
                    MAX_SESSION_COPY_BYTES / 1024 / 1024
                )));
            }
        }
    }
    Ok(copied_bytes)
}

pub(super) fn canonicalize_repository(selected: &str) -> Result<PathBuf> {
    tracepilot_core::utils::fs::canonicalize(PathBuf::from(selected)).map_err(|error| {
        OrchestratorError::ContextCapture(format!(
            "Could not open the selected repository: {error}"
        ))
    })
}

fn copy_sanitized_cli_config(source: &Path, destination: &Path) -> Result<u64> {
    const RETAINED_SETUP_KEYS: &[&str] = &[
        "trustedFolders",
        "askedSetupTerminals",
        "reasoningSummariesCleanupDone",
    ];

    if !source.is_file() {
        return Ok(0);
    }
    let value = crate::config_injector::read_copilot_json_file(source)
        .map_err(|error| {
            OrchestratorError::ContextCapture(format!(
                "Could not read Copilot's temporary setup state: {error}"
            ))
        })?
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
    let source_object = value.as_object().ok_or_else(|| {
        OrchestratorError::ContextCapture(format!(
            "Copilot setup state is not a JSON object: {}",
            source.display()
        ))
    })?;
    let mut sanitized = serde_json::Map::new();
    for key in RETAINED_SETUP_KEYS {
        if let Some(value) = source_object.get(*key) {
            sanitized.insert((*key).into(), value.clone());
        }
    }
    for key in source_object
        .keys()
        .filter(|key| !RETAINED_SETUP_KEYS.contains(&key.as_str()))
        .filter(|key| looks_like_setup_state_key(key))
    {
        tracing::warn!(
            config_path = %source.display(),
            key,
            "Copilot added setup-like state that context capture does not copy"
        );
    }
    let bytes = serde_json::to_vec_pretty(&sanitized)?;
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
        set_private_dir_permissions(parent)?;
    }
    std::fs::write(destination, &bytes)?;
    set_private_file_permissions(destination)?;
    Ok(bytes.len() as u64)
}

fn looks_like_setup_state_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["trust", "setup", "terminal"]
        .iter()
        .any(|fragment| key.contains(fragment))
}

pub(super) fn fingerprint_context_tree(root: &Path, seed: &str) -> Result<String> {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    if !root.is_dir() {
        return Ok(format!("{:x}", hasher.finalize()));
    }
    for entry in walkdir::WalkDir::new(root)
        .sort_by_file_name()
        .follow_links(false)
    {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry.path().strip_prefix(root).map_err(|_| {
            OrchestratorError::ContextCapture(
                "Configured context fingerprint path escaped its root.".into(),
            )
        })?;
        hasher.update(relative.to_string_lossy().as_bytes());
        let mut file = std::fs::File::open(entry.path())?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn copy_context_file(source: &Path, destination: &Path) -> Result<u64> {
    let metadata = std::fs::symlink_metadata(source)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(OrchestratorError::ContextCapture(format!(
            "Configured context file is not a regular file: {}",
            source.display()
        )));
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
        set_private_dir_permissions(parent)?;
    }
    std::fs::copy(source, destination)?;
    set_private_file_permissions(destination)?;
    Ok(metadata.len())
}

const CAPTURE_ENV_ALLOWLIST: &[&str] = &[
    "PATH",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "COLORTERM",
    "TZ",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "PROCESSOR_LEVEL",
    "PROCESSOR_REVISION",
    "USERNAME",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
];

fn capture_environment_name_allowed(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    #[cfg(windows)]
    {
        CAPTURE_ENV_ALLOWLIST
            .iter()
            .any(|allowed| name.eq_ignore_ascii_case(allowed))
    }
    #[cfg(not(windows))]
    {
        CAPTURE_ENV_ALLOWLIST.contains(&name)
    }
}

pub(super) fn capture_process_environment() -> Vec<(OsString, OsString)> {
    std::env::vars_os()
        .filter(|(name, _)| capture_environment_name_allowed(name))
        .collect()
}

#[cfg(test)]
mod tests;
