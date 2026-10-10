//! Session sources other than Copilot. Copilot's paths stay in
//! [`super::PathsConfig`]; whether a source runs is a feature flag.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SourcesConfig {
    #[serde(default)]
    pub claude_code: ClaudeCodeSourceConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCodeSourceConfig {
    /// Claude Code's config directory (`projects/` lives under it). Empty
    /// until normalized to `CLAUDE_CONFIG_DIR`, else `~/.claude`.
    #[serde(default)]
    pub config_dir: String,
    /// The command that runs Claude Code, for Resume in Terminal. Checked by
    /// `validators::validate_cli_command` before each use; blank means
    /// `claude`.
    #[serde(default = "default_claude_cli_command")]
    pub cli_command: String,
}

impl Default for ClaudeCodeSourceConfig {
    fn default() -> Self {
        Self {
            config_dir: String::new(),
            cli_command: default_claude_cli_command(),
        }
    }
}

impl ClaudeCodeSourceConfig {
    /// The configured command, or `claude` when it is blank.
    pub(crate) fn resume_cli(&self) -> &str {
        match self.cli_command.trim() {
            "" => tracepilot_core::constants::DEFAULT_CLAUDE_CLI_COMMAND,
            _ => &self.cli_command,
        }
    }
}

fn default_claude_cli_command() -> String {
    tracepilot_core::constants::DEFAULT_CLAUDE_CLI_COMMAND.to_string()
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

/// Not a drive or WSL root, by the parsed prefix ([`has_local_root`]), so no
/// mix of `\` and `/` spells a share past it.
///
/// [`has_local_root`]: crate::helpers::has_local_root
fn is_network_path(path: &std::path::Path) -> bool {
    !crate::helpers::has_local_root(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_claude_cli_defaults_to_claude() {
        let old: ClaudeCodeSourceConfig =
            serde_json::from_value(serde_json::json!({ "configDir": "C:/c" })).unwrap();
        assert_eq!(old.cli_command, "claude");
        assert_eq!(ClaudeCodeSourceConfig::default().cli_command, "claude");
        let blank = ClaudeCodeSourceConfig {
            cli_command: "  ".into(),
            ..old.clone()
        };
        assert_eq!(blank.resume_cli(), "claude");
        let custom = ClaudeCodeSourceConfig {
            cli_command: "npx claude".into(),
            ..old
        };
        assert_eq!(custom.resume_cli(), "npx claude");
    }

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
        for share in [
            r"\\server\share\.claude",
            r"\\?\UNC\server\share\.claude",
            r"\/192.0.2.1/share/.claude",
            r"/\192.0.2.1\share\.claude",
        ] {
            let error = canonical_claude_config_dir(share).unwrap_err();
            assert!(error.contains("Network"), "{share}: {error}");
        }
    }

    /// Classified from the parsed prefix, before anything touches the
    /// filesystem, whatever mix of separators spells a share.
    #[cfg(windows)]
    #[test]
    fn mixed_separator_shares_are_network_paths() {
        use std::path::Path;
        for share in [r"\/192.0.2.1/share/.claude", r"/\192.0.2.1\share\.claude"] {
            assert!(is_network_path(Path::new(share)), "{share}");
        }
        assert!(!is_network_path(Path::new(r"C:\Users\me\.claude")));
    }
}
