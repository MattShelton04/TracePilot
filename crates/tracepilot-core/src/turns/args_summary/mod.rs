//! One-line tool-call argument summaries (a command, a path, a pattern).
//!
//! Mirrors the frontend `formatArgsSummary()` from
//! `packages/ui/src/utils/toolCall.ts`, JavaScript semantics included (see
//! [`js`]): the app shows this server-computed text in place of its own, and
//! exports fall back to it when a call has no intention summary. Both sides
//! are pinned by one case table,
//! `crates/tracepilot-core/tests/fixtures/contracts/tool-args-summary.json`.

mod js;
mod task_list;
#[cfg(test)]
mod tests;

use serde_json::{Map, Value};

use crate::models::conversation::TurnToolCall;
use task_list::{TASK_LIST_TOOLS, task_list_summary};

/// Shells that run a command: Windows (`powershell`) and macOS/Linux (`bash`).
const SHELL_COMMAND_TOOLS: [&str; 3] = ["shell", "powershell", "bash"];
/// Tools that address an existing shell session by its id.
const SHELL_SESSION_TOOLS: [&str; 6] = [
    "read_powershell",
    "write_powershell",
    "stop_powershell",
    "read_bash",
    "write_bash",
    "stop_bash",
];

/// Arguments that usually name what an MCP call is about, most specific first.
/// Other arguments may hold secrets or blobs, so they never reach a summary.
const MCP_SUMMARY_KEYS: [&str; 8] = [
    "query",
    "q",
    "url",
    "path",
    "file_path",
    "name",
    "title",
    "description",
];

/// Compute a short human-readable summary of tool call arguments, or "".
pub fn compute_args_summary(tool_name: &str, args: &Value) -> String {
    // apply_patch arguments are usually the raw patch string, not an object.
    if tool_name == "apply_patch" {
        return patch_summary(args);
    }
    // Arrays are objects in JavaScript but carry no named arguments, so every
    // tool summarizes them, like non-objects, as "".
    let Some(a) = args.as_object() else {
        return String::new();
    };
    object_summary(tool_name, a).unwrap_or_default()
}

/// [`compute_args_summary`] for a reconstructed call, given its arguments.
/// A started subagent's `task` call is renamed to its agent (`explore`), but
/// its arguments are still `task`'s, so it is summarized as `task` (its
/// description).
pub fn tool_call_args_summary(tc: &TurnToolCall, args: &Value) -> String {
    let tool_name = if tc.is_subagent {
        "task"
    } else {
        tc.tool_name.as_str()
    };
    compute_args_summary(tool_name, args)
}

fn object_summary(tool_name: &str, a: &Map<String, Value>) -> Option<String> {
    let truthy_string = |key: &str| js::truthy_arg(a, key).map(js::to_string);
    match tool_name {
        "view" | "edit" | "create" => truthy_string("path"),
        "grep" | "rg" => {
            let pattern = truthy_string("pattern")?;
            let paths = match js::nullish(a, &["path", "paths"]) {
                Some(Value::Array(items)) => items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", "),
                Some(Value::String(path)) => path.clone(),
                _ => String::new(),
            };
            let suffix = if paths.is_empty() {
                String::new()
            } else {
                format!(" in {paths}")
            };
            Some(format!("/{pattern}/{suffix}"))
        }
        "glob" => truthy_string("pattern"),
        name if SHELL_COMMAND_TOOLS.contains(&name) => {
            truthy_string("command").map(|command| js::truncate(&command, 150))
        }
        name if SHELL_SESSION_TOOLS.contains(&name) => js::nullish(a, &["shellId", "shell_id"])
            .map(|id| format!("Shell {}", js::to_string(id))),
        "task" | "sql" => truthy_string("description"),
        "read_agent" | "stop_agent" => js::nullish(a, &["agent_id", "agent_name", "name"])
            .filter(|candidate| js::truthy(Some(candidate)))
            .map(js::to_string),
        "write_agent" => Some(write_agent_summary(a)),
        "list_agents" => truthy_string("scope").map(|scope| format!("scope: {scope}")),
        "report_intent" => truthy_string("intent"),
        "store_memory" => truthy_string("fact").map(|fact| js::truncate(&fact, 100)),
        "ask_user" => {
            // Claude Code and schema forms carry `message`; older Copilot calls `question`.
            let prompt = js::str_arg(a, "message")
                .filter(|m| !m.is_empty())
                .or_else(|| js::str_arg(a, "question"))
                .filter(|p| !p.is_empty())?;
            Some(js::truncate_summary(prompt, 100))
        }
        "skill" => js::str_arg(a, "skill").map(String::from),
        "ExitPlanMode" => js::str_arg(a, "plan").map(plan_summary),
        "web_search" => truthy_string("query"),
        "web_fetch" => truthy_string("url"),
        name if name.starts_with("github-mcp-server") => Some(github_summary(a)),
        name if TASK_LIST_TOOLS.contains(&name) => {
            Some(js::truncate_summary(&task_list_summary(name, a), 100))
        }
        // Claude Code tools without a canonical mapping keep their native names.
        "ToolSearch" => Some(js::string_arg(a, "query")),
        "NotebookEdit" => Some(js::string_arg(a, "notebook_path")),
        "Monitor" => {
            let description = js::string_arg(a, "description");
            Some(if description.is_empty() {
                js::string_arg(a, "command")
            } else {
                description
            })
        }
        name if name.starts_with("mcp__") => MCP_SUMMARY_KEYS
            .iter()
            .map(|key| js::string_arg(a, key))
            .find(|value| !value.is_empty()),
        _ => None,
    }
}

/// "→ beta · what is 6*7?": the target, then the message as one line.
fn write_agent_summary(a: &Map<String, Value>) -> String {
    let target = match (a.get("agent_id"), a.get("agent_ids"), a.get("scope")) {
        (Some(Value::String(id)), ..) => id.clone(),
        (_, Some(Value::Array(ids)), _) => format!("{} agents", ids.len()),
        (_, _, Some(Value::String(scope))) => format!("all {scope}"),
        _ => String::new(),
    };
    let message = js::str_arg(a, "message")
        .map(|m| js::truncate_summary(m, 100))
        .unwrap_or_default();
    let target = (!target.is_empty()).then(|| format!("→ {target}"));
    target
        .into_iter()
        .chain((!message.is_empty()).then_some(message))
        .collect::<Vec<_>>()
        .join(" · ")
}

/// A GitHub MCP call (Copilot's `github-mcp-server-*`): its `method`, then
/// `owner/repo`, then the path or query, e.g. "get · octo/app · src/a.ts".
fn github_summary(a: &Map<String, Value>) -> String {
    let owner = js::string_arg(a, "owner");
    let repo = js::string_arg(a, "repo");
    let repo = match (owner.is_empty(), repo.is_empty()) {
        (false, false) => format!("{owner}/{repo}"),
        (false, true) => owner,
        _ => repo,
    };
    let path = js::string_arg(a, "path");
    let target = if path.is_empty() {
        js::string_arg(a, "query")
    } else {
        path
    };
    let parts: Vec<String> = [js::string_arg(a, "method"), repo, target]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect();
    js::truncate_summary(&parts.join(" · "), 100)
}

/// The files an apply_patch envelope names: "a.ts", or "a.ts +2 files".
fn patch_summary(args: &Value) -> String {
    let patch = match args {
        Value::String(patch) => patch.as_str(),
        Value::Object(a) => js::str_arg(a, "patch")
            .or_else(|| js::str_arg(a, "input"))
            .unwrap_or_default(),
        _ => "",
    };
    // `/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm`: JavaScript lines end at
    // any of these terminators, and `.` matches none of them.
    let mut paths = patch
        .split(['\n', '\r', '\u{2028}', '\u{2029}'])
        .filter_map(|line| {
            let rest = line.strip_prefix("*** ")?;
            let path = ["Update", "Add", "Delete"]
                .iter()
                .find_map(|verb| rest.strip_prefix(verb)?.strip_prefix(" File: "))?;
            (!path.is_empty()).then(|| js::trim(path))
        });
    let Some(first) = paths.next() else {
        return String::new();
    };
    match paths.count() {
        0 => first.to_string(),
        1 => format!("{first} +1 file"),
        others => format!("{first} +{others} files"),
    }
}

/// The plan's first Markdown heading, or its first non-empty line.
fn plan_summary(plan: &str) -> String {
    let lines: Vec<&str> = plan.split('\n').map(js::trim).collect();
    let first = lines
        .iter()
        .find_map(|line| heading_text(line))
        .or_else(|| lines.iter().copied().find(|line| !line.is_empty()))
        .unwrap_or_default();
    js::truncate_summary(first, 100)
}

/// The text of a trimmed `/^#{1,6}\s+\S/` heading line, without its marker.
fn heading_text(line: &str) -> Option<&str> {
    let text = line.trim_start_matches('#');
    let level = line.len() - text.len();
    let after = text.trim_start_matches(js::is_space);
    let has_space = after.len() < text.len();
    ((1..=6).contains(&level) && has_space && !after.is_empty()).then_some(after)
}
