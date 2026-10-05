//! Tool-name normalization (mapping.md §2), spike subset.
//!
//! Only the mappings the reconstructor depends on are applied here:
//! `Agent` → `task` (subagent detection needs `agent_type`) and `Skill` →
//! `skill` (skill invocations attach to it). The full table, with argument and
//! result reshaping for the renderers, is task C4. Every other tool keeps its
//! native name and renders generically.

use serde_json::{Map, Value};

pub(super) struct NormalizedTool {
    pub(super) name: String,
    pub(super) arguments: Value,
    pub(super) mcp_server_name: Option<String>,
    pub(super) mcp_tool_name: Option<String>,
}

/// Claude Code's default subagent type when `subagent_type` is omitted.
const DEFAULT_AGENT_TYPE: &str = "general-purpose";

pub(super) fn is_agent_tool(native: &str) -> bool {
    matches!(native, "Agent" | "Task")
}

pub(super) fn normalize(native: &str, input: &Value) -> NormalizedTool {
    if is_agent_tool(native) {
        return NormalizedTool {
            name: "task".into(),
            arguments: agent_arguments(input),
            mcp_server_name: None,
            mcp_tool_name: None,
        };
    }
    if native == "Skill" {
        return NormalizedTool {
            name: "skill".into(),
            arguments: input.clone(),
            mcp_server_name: None,
            mcp_tool_name: None,
        };
    }
    // `mcp__<server>__<tool>`: `__` cannot occur inside either part.
    let mcp = native
        .strip_prefix("mcp__")
        .and_then(|rest| rest.split_once("__"));
    NormalizedTool {
        name: native.to_string(),
        arguments: input.clone(),
        mcp_server_name: mcp.map(|(server, _)| server.to_string()),
        mcp_tool_name: mcp.map(|(_, tool)| tool.to_string()),
    }
}

/// `subagent_type` → `agent_type`, `run_in_background` → `mode`; other
/// arguments (`description`, `prompt`, `model`, `isolation`, …) are kept.
fn agent_arguments(input: &Value) -> Value {
    let mut args: Map<String, Value> = input.as_object().cloned().unwrap_or_default();
    let agent_type = args
        .remove("subagent_type")
        .filter(Value::is_string)
        .unwrap_or_else(|| Value::String(DEFAULT_AGENT_TYPE.into()));
    args.insert("agent_type".into(), agent_type);
    if let Some(background) = args.remove("run_in_background") {
        let mode = if background.as_bool() == Some(true) {
            "background"
        } else {
            "sync"
        };
        args.insert("mode".into(), Value::String(mode.into()));
    }
    Value::Object(args)
}
