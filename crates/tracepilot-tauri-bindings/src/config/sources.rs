//! Session sources other than Copilot. Copilot's paths stay in
//! [`super::PathsConfig`]; whether a source runs is a feature flag.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SourcesConfig {
    #[serde(default)]
    pub claude_code: ClaudeCodeSourceConfig,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeSourceConfig {
    /// Claude Code's config directory (`projects/` lives under it). Empty
    /// until normalized to `CLAUDE_CONFIG_DIR`, else `~/.claude`.
    #[serde(default)]
    pub config_dir: String,
}

/// Resolve a user-chosen Claude Code folder at the filesystem trust boundary
/// (ADR 0012): an existing local directory, canonicalized. Network shares are
/// refused so indexing never opens an outbound SMB connection.
pub(crate) fn canonical_claude_config_dir(path: &str) -> Result<std::path::PathBuf, String> {
    if path.as_bytes().contains(&0) {
        return Err("Path contains a NUL byte".into());
    }
    let dir = std::path::Path::new(path);
    if !dir.is_absolute() {
        return Err(format!("Path must be absolute: {path}"));
    }
    if is_network_path(dir) {
        return Err(format!("Network (UNC) paths are not permitted: {path}"));
    }
    let canonical = tracepilot_core::utils::fs::canonicalize(dir).map_err(|error| {
        format!("Directory does not exist or is not accessible: {path} ({error})")
    })?;
    // A mapped drive or a link can still resolve to a share.
    if is_network_path(&canonical) {
        return Err(format!("Network (UNC) paths are not permitted: {path}"));
    }
    if !canonical.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }
    Ok(canonical)
}

fn is_network_path(path: &std::path::Path) -> bool {
    let path = path.to_string_lossy();
    cfg!(windows)
        && (path.starts_with(r"\\?\UNC\")
            || (path.starts_with(r"\\") && !path.starts_with(r"\\?\")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_claude_folder_must_be_an_existing_local_directory() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("claude");
        std::fs::create_dir(&dir).unwrap();
        let canonical =
            canonical_claude_config_dir(&dir.join("..").join("claude").to_string_lossy()).unwrap();
        assert_eq!(
            canonical,
            tracepilot_core::utils::fs::canonicalize(&dir).unwrap()
        );

        let file = temp.path().join("file");
        std::fs::write(&file, "").unwrap();
        for bad in [
            "relative/claude".to_string(),
            temp.path().join("missing").to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
            "C:/claude\0".to_string(),
        ] {
            assert!(
                canonical_claude_config_dir(&bad).is_err(),
                "{bad:?} accepted"
            );
        }
        #[cfg(windows)]
        for share in [r"\\server\share\.claude", r"\\?\UNC\server\share\.claude"] {
            let error = canonical_claude_config_dir(share).unwrap_err();
            assert!(error.contains("Network"), "{share}: {error}");
        }
    }
}
