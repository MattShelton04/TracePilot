use crate::error::{OrchestratorError, Result};
use crate::process::{find_executable, run_hidden};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCapabilities {
    pub executable: String,
    pub version: String,
    pub supports_resume: bool,
    pub supports_prompt: bool,
    pub supports_json_output: bool,
    pub supports_offline: bool,
    pub supports_byok_routing: bool,
    pub supports_required_safety_flags: bool,
    pub missing_capabilities: Vec<String>,
}

impl CliCapabilities {
    pub fn capture_supported(&self) -> bool {
        self.supports_resume
            && self.supports_prompt
            && self.supports_json_output
            && self.supports_offline
            && self.supports_byok_routing
            && self.supports_required_safety_flags
    }
}

pub fn probe(cli_command: &str) -> Result<CliCapabilities> {
    let executable = resolve_executable(cli_command)?;
    let executable_str = executable.to_string_lossy().to_string();
    let version_output = run_hidden(&executable_str, &["--version"], None, Some(8))?;
    if !version_output.status.success() {
        return Err(OrchestratorError::ContextCapture(
            "The configured Copilot CLI did not respond successfully to --version.".into(),
        ));
    }
    let version_text = format!(
        "{} {}",
        String::from_utf8_lossy(&version_output.stdout),
        String::from_utf8_lossy(&version_output.stderr)
    );
    let version = extract_version(&version_text).unwrap_or_else(|| "unknown".to_string());
    let help_output = run_hidden(&executable_str, &["--help"], None, Some(8))?;
    let help = format!(
        "{} {}",
        String::from_utf8_lossy(&help_output.stdout),
        String::from_utf8_lossy(&help_output.stderr)
    );
    let version_supports_byok = semver::Version::parse(&version)
        .map(|value| value >= semver::Version::new(1, 0, 71))
        .unwrap_or(false);

    let supports_resume = help.contains("--resume");
    let supports_prompt = help.contains("--prompt") || help.contains("-p,");
    let supports_json_output = help.contains("--output-format");
    let supports_offline = help.contains("--no-remote") || help.contains("COPILOT_OFFLINE");
    let supports_byok_routing = help.contains("COPILOT_PROVIDER_BASE_URL") || version_supports_byok;
    let supports_required_safety_flags = [
        "--allow-all-tools",
        "--no-ask-user",
        "--no-auto-update",
        "--no-remote",
    ]
    .iter()
    .all(|flag| help.contains(flag));
    let mut missing_capabilities = Vec::new();
    for (supported, label) in [
        (supports_resume, "explicit session resume"),
        (supports_prompt, "non-interactive prompt mode"),
        (supports_json_output, "JSON output mode"),
        (supports_offline, "offline/no-remote mode"),
        (supports_byok_routing, "custom provider base URL routing"),
        (
            supports_required_safety_flags,
            "required non-interactive safety flags",
        ),
    ] {
        if !supported {
            missing_capabilities.push(label.to_string());
        }
    }

    Ok(CliCapabilities {
        executable: executable_str,
        version,
        supports_resume,
        supports_prompt,
        supports_json_output,
        supports_offline,
        supports_byok_routing,
        supports_required_safety_flags,
        missing_capabilities,
    })
}

fn resolve_executable(cli_command: &str) -> Result<PathBuf> {
    let trimmed = cli_command.trim();
    if trimmed.is_empty() {
        return Err(OrchestratorError::ContextCapture(
            "No Copilot CLI executable is configured.".into(),
        ));
    }
    let path = Path::new(trimmed);
    if path.is_file() {
        return Ok(path.to_path_buf());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err(OrchestratorError::ContextCapture(
            "Exact context capture requires the CLI setting to contain only an executable path, not shell arguments.".into(),
        ));
    }
    find_executable(trimmed).ok_or_else(|| {
        OrchestratorError::ContextCapture(format!(
            "Could not resolve the configured Copilot CLI executable '{trimmed}'."
        ))
    })
}

fn extract_version(value: &str) -> Option<String> {
    value.split_whitespace().find_map(|token| {
        let cleaned = token.trim_matches(|ch: char| !ch.is_ascii_digit() && ch != '.' && ch != '-');
        semver::Version::parse(cleaned)
            .ok()
            .map(|version| version.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::extract_version;

    #[test]
    fn extracts_cli_version_without_preserving_banner_text() {
        assert_eq!(
            extract_version("GitHub Copilot CLI 1.0.74-0"),
            Some("1.0.74-0".into())
        );
    }
}
