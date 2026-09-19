//! `/subagents` settings in the user's `settings.json`.
//!
//! Shape confirmed against the Copilot CLI 1.0.79 settings schema
//! (`SubagentSettings`):
//!
//! ```json
//! "subagents": {
//!   "agents": { "<agent_type>": { "model": "…", "effortLevel": "…", "contextTier": "inherit|default|long_context" } },
//!   "disabledSubagents": ["<agent_type>"],
//!   "maxConcurrency": 1-128,
//!   "maxDepth": 1-128
//! }
//! ```
//!
//! `model`, `effortLevel` and `contextTier` accept `inherit` (use the
//! session's value). An entry may carry other keys (e.g. `autoInvoke` for
//! rubber-duck); they are preserved. Any unexpected shape makes the block
//! read-only rather than risk overwriting it.

use std::path::Path;

use serde_json::{Map, Value};
use tracepilot_core::paths::CopilotPaths;

use super::types::{SubagentOverride, SubagentSettings};
use crate::config_injector::{read_copilot_json_file, update_settings_json};
use crate::error::{OrchestratorError, Result};

const SUBAGENTS: &str = "subagents";
const AGENTS: &str = "agents";
const DISABLED: &str = "disabledSubagents";
const EDITABLE: [&str; 3] = ["model", "effortLevel", "contextTier"];
pub const CONTEXT_TIERS: [&str; 3] = ["inherit", "default", "long_context"];

/// Read the `subagents` block plus the session defaults it inherits from.
pub fn read_settings(copilot_home: &Path) -> SubagentSettings {
    let paths = CopilotPaths::from_home(copilot_home);
    let settings_path = paths.settings_json();
    let mut result = SubagentSettings {
        settings_path: settings_path.to_string_lossy().to_string(),
        ..Default::default()
    };
    // Session defaults may still live in the legacy config.json.
    for path in [paths.config_json(), settings_path.clone()] {
        if let Ok(Some(value)) = read_copilot_json_file(&path) {
            if let Some(model) = value.get("model").and_then(Value::as_str) {
                result.session_model = Some(model.to_string());
            }
            if let Some(effort) = value
                .get("effortLevel")
                .or_else(|| value.get("reasoningEffort"))
                .and_then(Value::as_str)
            {
                result.session_effort = Some(effort.to_string());
            }
        }
    }
    let settings = match read_copilot_json_file(&settings_path) {
        Ok(Some(settings)) => settings,
        Ok(None) => return result,
        Err(message) => {
            result.shape_error = Some(message);
            return result;
        }
    };
    let Some(block) = settings.get(SUBAGENTS) else {
        return result;
    };
    result.raw = Some(block.clone());
    if let Err(message) = parse_block(block, &mut result) {
        result.overrides.clear();
        result.disabled.clear();
        result.shape_error = Some(message);
    }
    result
}

fn parse_block(block: &Value, result: &mut SubagentSettings) -> std::result::Result<(), String> {
    let object = block
        .as_object()
        .ok_or("`subagents` is not an object".to_string())?;
    if let Some(agents) = object.get(AGENTS) {
        let agents = agents
            .as_object()
            .ok_or("`subagents.agents` is not an object".to_string())?;
        for (name, entry) in agents {
            let entry = entry
                .as_object()
                .ok_or(format!("`subagents.agents.{name}` is not an object"))?;
            let text = |key: &str| -> std::result::Result<Option<String>, String> {
                match entry.get(key) {
                    None | Some(Value::Null) => Ok(None),
                    Some(Value::String(value)) => Ok(Some(value.clone())),
                    Some(_) => Err(format!("`subagents.agents.{name}.{key}` is not a string")),
                }
            };
            result.overrides.insert(
                name.clone(),
                SubagentOverride {
                    model: text("model")?,
                    effort_level: text("effortLevel")?,
                    context_tier: text("contextTier")?,
                    other_keys: entry
                        .keys()
                        .filter(|key| !EDITABLE.contains(&key.as_str()))
                        .cloned()
                        .collect(),
                },
            );
        }
    }
    if let Some(disabled) = object.get(DISABLED) {
        result.disabled = disabled
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .map(|item| item.as_str().map(String::from))
                    .collect()
            })
            .ok_or("`subagents.disabledSubagents` is not a list of names".to_string())?;
    }
    result.max_concurrency = object.get("maxConcurrency").and_then(Value::as_u64);
    result.max_depth = object.get("maxDepth").and_then(Value::as_u64);
    Ok(())
}

/// Validate the existing block before any write.
fn subagents_mut(root: &mut Map<String, Value>) -> Result<&mut Map<String, Value>> {
    let mut probe = SubagentSettings::default();
    if let Some(block) = root.get(SUBAGENTS) {
        parse_block(block, &mut probe).map_err(|message| {
            OrchestratorError::Config(format!("Refusing to update settings.json: {message}"))
        })?;
    }
    let block = root
        .entry(SUBAGENTS)
        .or_insert_with(|| Value::Object(Map::new()));
    block
        .as_object_mut()
        .ok_or_else(|| OrchestratorError::Config("`subagents` is not an object".into()))
}

/// Drop empty containers so a reset leaves no trace in the file.
fn prune(root: &mut Map<String, Value>) {
    if let Some(Value::Object(block)) = root.get_mut(SUBAGENTS) {
        if block
            .get(AGENTS)
            .and_then(Value::as_object)
            .is_some_and(Map::is_empty)
        {
            block.remove(AGENTS);
        }
        if block
            .get(DISABLED)
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            block.remove(DISABLED);
        }
        if block.is_empty() {
            root.remove(SUBAGENTS);
        }
    }
}

fn validate_override(value: &SubagentOverride) -> Result<()> {
    if let Some(tier) = value.context_tier.as_deref()
        && !tier.is_empty()
        && !CONTEXT_TIERS.contains(&tier)
    {
        return Err(OrchestratorError::Config(format!(
            "Context tier must be one of {}",
            CONTEXT_TIERS.join(", ")
        )));
    }
    Ok(())
}

/// Set (or with `None`, reset) the per-agent override for `agent_type`.
/// Keys other than model, effort and context tier are kept.
pub fn set_override(
    copilot_home: &Path,
    agent_type: &str,
    value: Option<&SubagentOverride>,
) -> Result<()> {
    let agent_type = agent_type.trim();
    if agent_type.is_empty() {
        return Err(OrchestratorError::Config("Agent name is required".into()));
    }
    if let Some(value) = value {
        validate_override(value)?;
    }
    update_settings_json(copilot_home, |root| {
        let block = subagents_mut(root)?;
        let agents = block
            .entry(AGENTS)
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| {
                OrchestratorError::Config("`subagents.agents` is not an object".into())
            })?;
        let mut entry = agents
            .get(agent_type)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for (key, new_value) in EDITABLE.iter().zip([
            value.and_then(|v| v.model.as_deref()),
            value.and_then(|v| v.effort_level.as_deref()),
            value.and_then(|v| v.context_tier.as_deref()),
        ]) {
            match new_value.map(str::trim).filter(|v| !v.is_empty()) {
                Some(text) => {
                    entry.insert((*key).to_string(), Value::String(text.to_string()));
                }
                None => {
                    entry.remove(*key);
                }
            }
        }
        if entry.is_empty() {
            agents.remove(agent_type);
        } else {
            agents.insert(agent_type.to_string(), Value::Object(entry));
        }
        prune(root);
        Ok(())
    })
}

/// Add or remove `agent_type` from `subagents.disabledSubagents`.
pub fn set_disabled(copilot_home: &Path, agent_type: &str, disabled: bool) -> Result<()> {
    let agent_type = agent_type.trim();
    if agent_type.is_empty() {
        return Err(OrchestratorError::Config("Agent name is required".into()));
    }
    update_settings_json(copilot_home, |root| {
        let block = subagents_mut(root)?;
        let mut names: Vec<String> = block
            .get(DISABLED)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        names.retain(|name| name != agent_type);
        if disabled {
            names.push(agent_type.to_string());
            names.sort_by_key(|name| name.to_lowercase());
        }
        block.insert(
            DISABLED.to_string(),
            Value::Array(names.into_iter().map(Value::String).collect()),
        );
        prune(root);
        Ok(())
    })
}
