//! Tool-name normalization (mapping.md §2), minimal subset (C4a).
//!
//! - `Agent` → `task` (subagent detection needs `agent_type`) and `Skill` →
//!   `skill` (skill invocations attach to it).
//! - [`RENAMES`]: tools whose canonical renderer, icon and summary work once
//!   argument keys are renamed, because they read only the arguments or the
//!   plain result text Claude Code already writes.
//!
//! Tools that also need a result reshape (`Read`, `Write`, `Bash`,
//! `WebSearch`, `AskUserQuestion`, …) keep their native name and render
//! generically until the full table (C4).

use serde_json::{Map, Value};

pub(super) struct NormalizedTool {
    pub(super) name: String,
    pub(super) arguments: Value,
    pub(super) mcp_server_name: Option<String>,
    pub(super) mcp_tool_name: Option<String>,
}

/// Native name, canonical name, and argument key renames (`from`, `to`).
type Rename = (
    &'static str,
    &'static str,
    &'static [(&'static str, &'static str)],
);

const RENAMES: &[Rename] = &[
    (
        "Edit",
        "edit",
        &[
            ("file_path", "path"),
            ("old_string", "old_str"),
            ("new_string", "new_str"),
        ],
    ),
    ("Grep", "grep", &[("-i", "ignore_case")]),
    ("Glob", "glob", &[]),
    ("PowerShell", "powershell", &[]),
    ("WebFetch", "web_fetch", &[]),
];

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
    if let Some((_, canonical, keys)) = RENAMES.iter().find(|(name, ..)| *name == native) {
        return NormalizedTool {
            name: (*canonical).into(),
            arguments: rename_keys(input, keys),
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

fn rename_keys(input: &Value, keys: &[(&str, &str)]) -> Value {
    let Some(map) = input.as_object() else {
        return input.clone();
    };
    let mut args = map.clone();
    for (from, to) in keys {
        if let Some(value) = args.remove(*from) {
            args.insert((*to).into(), value);
        }
    }
    Value::Object(args)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::normalize;

    #[test]
    fn renames_tools_whose_renderer_reads_only_arguments() {
        let edit = normalize(
            "Edit",
            &json!({"file_path": "src/a.rs", "old_string": "a", "new_string": "b", "replace_all": true}),
        );
        assert_eq!(edit.name, "edit");
        assert_eq!(
            edit.arguments,
            json!({"path": "src/a.rs", "old_str": "a", "new_str": "b", "replace_all": true})
        );
        let grep = normalize("Grep", &json!({"pattern": "fn", "-i": true, "-n": true}));
        assert_eq!(grep.name, "grep");
        assert_eq!(
            grep.arguments,
            json!({"pattern": "fn", "ignore_case": true, "-n": true})
        );
        for (native, canonical) in [
            ("Glob", "glob"),
            ("PowerShell", "powershell"),
            ("WebFetch", "web_fetch"),
        ] {
            let tool = normalize(native, &json!({"pattern": "*.rs"}));
            assert_eq!(tool.name, canonical);
            assert_eq!(tool.arguments, json!({"pattern": "*.rs"}));
        }
    }

    #[test]
    fn tools_needing_a_result_reshape_keep_their_native_name() {
        for native in [
            "Read",
            "Write",
            "Bash",
            "WebSearch",
            "AskUserQuestion",
            "Monitor",
        ] {
            let tool = normalize(native, &json!({"file_path": "a"}));
            assert_eq!(tool.name, native);
            assert_eq!(tool.arguments, json!({"file_path": "a"}));
        }
        let mcp = normalize("mcp__docs__search", &json!({}));
        assert_eq!(mcp.name, "mcp__docs__search");
        assert_eq!(mcp.mcp_server_name.as_deref(), Some("docs"));
        assert_eq!(mcp.mcp_tool_name.as_deref(), Some("search"));
    }

    #[test]
    fn agent_becomes_task_with_agent_type_and_mode() {
        let task = normalize(
            "Agent",
            &json!({"description": "Map", "prompt": "Go", "run_in_background": true}),
        );
        assert_eq!(task.name, "task");
        assert_eq!(
            task.arguments,
            json!({"description": "Map", "prompt": "Go", "agent_type": "general-purpose", "mode": "background"})
        );
        let typed = normalize("Task", &json!({"subagent_type": "Explore"}));
        assert_eq!(typed.arguments, json!({"agent_type": "Explore"}));
    }
}
