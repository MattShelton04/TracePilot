use super::capability::{self, CliCapabilities};
use super::snapshot::{inspect_session_tree, source_fingerprint};
use crate::error::{OrchestratorError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use tracepilot_core::context_capture::{CaptureProtocol, SourceEventsFingerprint};
use tracepilot_core::paths::{SessionPaths, TracePilotPaths};

use super::snapshot::{set_private_dir_permissions, set_private_file_permissions};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturePreflight {
    pub source_session_id: String,
    pub inactive: bool,
    pub source_size_bytes: u64,
    pub source_file_count: u64,
    pub storage_writable: bool,
    pub source_events_fingerprint: SourceEventsFingerprint,
    pub working_directory: String,
    pub working_directory_exists: bool,
    pub cli: CliCapabilities,
    pub source_cli_version: Option<String>,
    pub model: String,
    pub protocol: CaptureProtocol,
    pub protocol_detection_source: String,
    pub protocol_options: Vec<CaptureProtocol>,
    pub capture_profile: String,
    pub included_resources: Vec<String>,
    pub omitted_resources: Vec<String>,
    pub warnings: Vec<String>,
    pub can_capture: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkPreflight {
    pub storage_writable: bool,
    pub cli: CliCapabilities,
    pub warnings: Vec<String>,
    pub can_capture: bool,
}

pub fn benchmark_preflight(
    cli_command: &str,
    tracepilot_home: &Path,
) -> Result<BenchmarkPreflight> {
    let cli = capability::probe(cli_command)?;
    let mut warnings = Vec::new();
    let storage_writable = match verify_capture_storage(tracepilot_home) {
        Ok(()) => true,
        Err(error) => {
            warnings.push(format!(
                "TracePilot capture storage is not writable: {error}."
            ));
            false
        }
    };
    if !cli.capture_supported() {
        warnings.push(format!(
            "The installed CLI is missing required capture capabilities: {}.",
            cli.missing_capabilities.join(", ")
        ));
    }
    Ok(BenchmarkPreflight {
        storage_writable,
        can_capture: storage_writable && cli.capture_supported(),
        cli,
        warnings,
    })
}

pub fn context_capture_preflight(
    session_id: &str,
    session_path: &Path,
    cli_command: &str,
    tracepilot_home: &Path,
) -> Result<CapturePreflight> {
    let session_paths = SessionPaths::from_root(session_path);
    if !session_paths.events_jsonl().is_file() || !session_paths.workspace_yaml().is_file() {
        return Err(OrchestratorError::ContextCapture(
            "The session must contain both events.jsonl and workspace.yaml.".into(),
        ));
    }
    let inactive = !tracepilot_core::session::discovery::has_lock_file(session_path);
    let (source_size_bytes, source_file_count) = inspect_session_tree(session_path)?;
    let source_events_fingerprint = source_fingerprint(&session_paths.events_jsonl())?;
    let summary = tracepilot_core::summary::load_session_summary(session_path)?;
    let workspace =
        tracepilot_core::parsing::workspace::parse_workspace_yaml(&session_paths.workspace_yaml())?;
    let cwd = workspace.cwd.map(PathBuf::from).unwrap_or_default();
    let working_directory_exists = cwd.is_dir();
    let working_directory = cwd.to_string_lossy().to_string();
    let observations = scan_event_observations(&session_paths.events_jsonl())?;
    let model = summary
        .shutdown_metrics
        .and_then(|metrics| metrics.current_model)
        .or(observations.model)
        .ok_or_else(|| {
            OrchestratorError::ContextCapture(
                "Could not determine the session's current model from session events. Open the session in Copilot CLI, select a model, close it, and retry.".into(),
            )
        })?;
    let (protocol, protocol_detection_source) = observations
        .protocol
        .map(|protocol| (protocol, "assistant.usage API endpoint".to_string()))
        .unwrap_or_else(|| {
            (
                infer_protocol_from_model(&model),
                "model-family compatibility fallback".to_string(),
            )
        });
    let cli = capability::probe(cli_command)?;
    let mut warnings = Vec::new();
    let storage_writable = match verify_capture_storage(tracepilot_home) {
        Ok(()) => true,
        Err(error) => {
            warnings.push(format!(
                "TracePilot capture storage is not writable: {error}."
            ));
            false
        }
    };
    if !inactive {
        warnings.push("This session appears active. Close Copilot CLI before capturing it.".into());
    }
    if !working_directory_exists {
        warnings.push(
            "The original working directory is missing; capture will use an empty temporary workspace with degraded fidelity.".into(),
        );
    }
    if protocol_detection_source.contains("fallback") {
        warnings.push(
            "No persisted model API endpoint was found. Review the selected wire protocol before capture.".into(),
        );
    }
    if !cli.capture_supported() {
        warnings.push(format!(
            "The installed CLI is missing required capture capabilities: {}.",
            cli.missing_capabilities.join(", ")
        ));
    }
    let can_capture = inactive && cli.capture_supported() && storage_writable;

    Ok(CapturePreflight {
        source_session_id: session_id.to_string(),
        inactive,
        source_size_bytes,
        source_file_count,
        storage_writable,
        source_events_fingerprint,
        working_directory,
        working_directory_exists,
        source_cli_version: observations.cli_version,
        model,
        protocol,
        protocol_detection_source,
        protocol_options: vec![
            CaptureProtocol::OpenAiChatCompletions,
            CaptureProtocol::OpenAiResponses,
            CaptureProtocol::AnthropicMessages,
        ],
        capture_profile: "isolated".into(),
        included_resources: vec![
            "source session files (same session ID in a private temporary COPILOT_HOME)".into(),
            "installed CLI built-ins".into(),
            "current repository instruction discovery when the original working directory exists".into(),
        ],
        omitted_resources: vec![
            "Copilot authentication and credential stores".into(),
            "user-level settings, MCP configuration, skills, agents, plugins, logs, and other sessions".into(),
        ],
        warnings,
        can_capture,
        cli,
    })
}

pub(crate) fn verify_capture_storage(tracepilot_home: &Path) -> Result<()> {
    let paths = TracePilotPaths::from_root(tracepilot_home);
    for directory in [
        paths.context_captures_dir(),
        paths.context_capture_scratch_dir(),
    ] {
        fs::create_dir_all(&directory)?;
        set_private_dir_permissions(&directory)?;
        let probe = directory.join(format!(".tracepilot-write-probe-{}", uuid::Uuid::new_v4()));
        let result = (|| -> Result<()> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&probe)?;
            set_private_file_permissions(&probe)?;
            file.write_all(b"capture-storage-probe")?;
            file.sync_all()?;
            drop(file);
            fs::remove_file(&probe)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&probe);
        }
        result?;
    }
    Ok(())
}

#[derive(Default)]
struct EventObservations {
    model: Option<String>,
    cli_version: Option<String>,
    protocol: Option<CaptureProtocol>,
}

fn scan_event_observations(path: &Path) -> Result<EventObservations> {
    let reader = BufReader::new(File::open(path)?);
    let mut observations = EventObservations::default();
    for line in reader.lines() {
        let line = line?;
        let Ok(event) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let event_type = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let data = event.get("data").unwrap_or(&Value::Null);
        if matches!(event_type, "session.start" | "session.resume") {
            if let Some(value) = data.get("copilotVersion").and_then(Value::as_str) {
                observations.cli_version = Some(value.to_string());
            }
            if let Some(value) = data.get("selectedModel").and_then(Value::as_str) {
                observations.model = Some(value.to_string());
            }
        } else if event_type == "session.model_change" {
            if let Some(value) = data.get("newModel").and_then(Value::as_str) {
                observations.model = Some(value.to_string());
            }
        } else if event_type == "session.shutdown"
            && let Some(value) = data.get("currentModel").and_then(Value::as_str)
        {
            observations.model = Some(value.to_string());
        }
        if event_type == "assistant.usage" {
            if let Some(endpoint) = find_string_key(data, &["apiEndpoint", "api_endpoint"]) {
                observations.protocol = protocol_from_endpoint(endpoint);
            }
            if let Some(value) = data.get("model").and_then(Value::as_str) {
                observations.model = Some(value.to_string());
            }
        }
    }
    Ok(observations)
}

fn find_string_key<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(found) = map.get(*key).and_then(Value::as_str) {
                    return Some(found);
                }
            }
            map.values().find_map(|value| find_string_key(value, keys))
        }
        Value::Array(items) => items.iter().find_map(|value| find_string_key(value, keys)),
        _ => None,
    }
}

fn protocol_from_endpoint(endpoint: &str) -> Option<CaptureProtocol> {
    let lower = endpoint.to_ascii_lowercase();
    if lower.contains("/responses") {
        Some(CaptureProtocol::OpenAiResponses)
    } else if lower.contains("/chat/completions") {
        Some(CaptureProtocol::OpenAiChatCompletions)
    } else if lower.contains("/messages") || lower.contains("anthropic") {
        Some(CaptureProtocol::AnthropicMessages)
    } else {
        None
    }
}

fn infer_protocol_from_model(model: &str) -> CaptureProtocol {
    let lower = model.to_ascii_lowercase();
    if lower.contains("claude") {
        CaptureProtocol::AnthropicMessages
    } else if lower.starts_with("gpt-5")
        || lower.starts_with("o1")
        || lower.starts_with("o3")
        || lower.starts_with("o4")
    {
        CaptureProtocol::OpenAiResponses
    } else {
        CaptureProtocol::OpenAiChatCompletions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_fallback_selects_a_wire_schema_only() {
        assert_eq!(
            infer_protocol_from_model("claude-opus-4.6"),
            CaptureProtocol::AnthropicMessages
        );
        assert_eq!(
            infer_protocol_from_model("gpt-5.2"),
            CaptureProtocol::OpenAiResponses
        );
        assert_eq!(
            infer_protocol_from_model("custom-model"),
            CaptureProtocol::OpenAiChatCompletions
        );
    }
}
