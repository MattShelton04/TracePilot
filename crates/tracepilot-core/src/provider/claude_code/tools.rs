//! Tool normalization table, argument half (mapping.md §2).
//!
//! Each Claude Code tool maps to a Copilot canonical name, so core match arms
//! never gain per-provider branches; the native name stays in
//! `nativeToolName`. Arguments are reshaped here, when the call starts.
//! Results are reshaped in `tool_results.rs`, which also renames the two
//! tools whose canonical name depends on the result: `Write` over an existing
//! file (`create` → `apply_patch`) and `TaskStop` of a shell
//! (`stop_agent` → `stop_powershell`). A shell's `backgroundTaskId` is
//! copied into its arguments there too.
//!
//! Tools without a mapping (`Monitor`, `ToolSearch`, `NotebookEdit`, plan
//! mode, harness tools, …) keep their native name and render generically.

use serde_json::{Map, Value, json};

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
    (
        "Write",
        "create",
        &[("file_path", "path"), ("content", "file_text")],
    ),
    ("Grep", "grep", &[("-i", "ignore_case")]),
    ("Glob", "glob", &[]),
    ("WebFetch", "web_fetch", &[]),
    ("WebSearch", "web_search", &[]),
    ("SendMessage", "write_agent", &[("to", "agent_id")]),
    // Refined by the result's `task_type` (tool_results.rs).
    (
        "TaskStop",
        "stop_agent",
        &[("task_id", "agent_id"), ("shell_id", "shellId")],
    ),
    ("KillShell", "stop_powershell", &[("shell_id", "shellId")]),
    // Older Claude Code. `TaskOutput` is not mapped: it reads a shell or an
    // agent, and neither was observed.
    ("BashOutput", "read_powershell", &[("bash_id", "shellId")]),
];

/// Claude Code's default subagent type when `subagent_type` is omitted.
const DEFAULT_AGENT_TYPE: &str = "general-purpose";

pub(super) fn is_agent_tool(native: &str) -> bool {
    matches!(native, "Agent" | "Task")
}

pub(super) fn normalize(native: &str, input: &Value) -> NormalizedTool {
    let canonical = |name: &str, arguments: Value| NormalizedTool {
        name: name.into(),
        arguments,
        mcp_server_name: None,
        mcp_tool_name: None,
    };
    match native {
        "Agent" | "Task" => return canonical("task", agent_arguments(input)),
        "Skill" => return canonical("skill", input.clone()),
        "Bash" => return canonical("shell", shell_arguments(input)),
        "PowerShell" => return canonical("powershell", shell_arguments(input)),
        "Read" => return canonical("view", read_arguments(input)),
        "AskUserQuestion" => return canonical("ask_user", ask_user_arguments(input)),
        _ => {}
    }
    if let Some((_, name, keys)) = RENAMES.iter().find(|(name, ..)| *name == native) {
        return canonical(name, rename_keys(input, keys));
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
    let mut args = object(input);
    let agent_type = args
        .remove("subagent_type")
        .filter(Value::is_string)
        .unwrap_or_else(|| Value::String(DEFAULT_AGENT_TYPE.into()));
    args.insert("agent_type".into(), agent_type);
    background_mode(&mut args);
    Value::Object(args)
}

/// `command`, `description` and `timeout` as-is; `run_in_background` → `mode`.
fn shell_arguments(input: &Value) -> Value {
    let Some(map) = input.as_object() else {
        return input.clone();
    };
    let mut args = map.clone();
    background_mode(&mut args);
    Value::Object(args)
}

fn background_mode(args: &mut Map<String, Value>) {
    if let Some(background) = args.remove("run_in_background") {
        let mode = if background.as_bool() == Some(true) {
            "background"
        } else {
            "sync"
        };
        args.insert("mode".into(), Value::String(mode.into()));
    }
}

/// `file_path` → `path`; 1-based `offset` and `limit` → inclusive
/// `view_range` (`-1` = to the end). `pages` and other keys are kept.
fn read_arguments(input: &Value) -> Value {
    let Some(map) = input.as_object() else {
        return input.clone();
    };
    let mut args = map.clone();
    if let Some(path) = args.remove("file_path") {
        args.insert("path".into(), path);
    }
    let offset = args.get("offset").and_then(Value::as_i64);
    let limit = args.get("limit").and_then(Value::as_i64);
    if offset.is_some() || limit.is_some() {
        let start = offset.unwrap_or(1).max(1);
        let end = limit
            .filter(|limit| *limit > 0)
            .map_or(-1, |n| start + n - 1);
        args.remove("offset");
        args.remove("limit");
        args.insert("view_range".into(), json!([start, end]));
    }
    Value::Object(args)
}

/// `questions[]` → an elicitation `requestedSchema` with one property per
/// question (`q1`, `q2`, …; the result uses the same keys). Options become
/// `oneOf` constants, or `items.anyOf` for a multi-select. `questions` is
/// kept for reference.
fn ask_user_arguments(input: &Value) -> Value {
    let mut args = object(input);
    let questions = args
        .get("questions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut properties = Map::new();
    for (index, question) in questions.iter().enumerate() {
        let text = question.get("question").and_then(Value::as_str);
        let options: Vec<Value> = question
            .get("options")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|option| option.get("label").and_then(Value::as_str))
            .map(|label| json!({"const": label, "title": label}))
            .collect();
        let mut field = Map::new();
        if let Some(title) = question.get("header").and_then(Value::as_str).or(text) {
            field.insert("title".into(), title.into());
        }
        if let Some(text) = text {
            field.insert("description".into(), text.into());
        }
        if question.get("multiSelect").and_then(Value::as_bool) == Some(true) {
            field.insert("type".into(), "array".into());
            field.insert("items".into(), json!({"type": "string", "anyOf": options}));
        } else {
            field.insert("type".into(), "string".into());
            field.insert("oneOf".into(), Value::Array(options));
        }
        properties.insert(question_key(index), Value::Object(field));
    }
    let required: Vec<Value> = properties.keys().cloned().map(Value::String).collect();
    let message = match questions.as_slice() {
        [only] => only.get("question").cloned(),
        _ => None,
    };
    if let Some(message) = message {
        args.insert("message".into(), message);
    }
    args.insert(
        "requestedSchema".into(),
        json!({"type": "object", "properties": properties, "required": required}),
    );
    Value::Object(args)
}

/// The `requestedSchema` property key of the question at `index`.
pub(super) fn question_key(index: usize) -> String {
    format!("q{}", index + 1)
}

fn object(input: &Value) -> Map<String, Value> {
    input.as_object().cloned().unwrap_or_default()
}

pub(super) fn rename_keys(input: &Value, keys: &[(&str, &str)]) -> Value {
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
    fn renames_argument_keys() {
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
        let write = normalize("Write", &json!({"file_path": "a.txt", "content": "hi"}));
        assert_eq!(write.name, "create");
        assert_eq!(write.arguments, json!({"path": "a.txt", "file_text": "hi"}));
        let send = normalize("SendMessage", &json!({"to": "reviewer", "message": "Go"}));
        assert_eq!(send.name, "write_agent");
        assert_eq!(
            send.arguments,
            json!({"agent_id": "reviewer", "message": "Go"})
        );
        let stop = normalize("TaskStop", &json!({"task_id": "b1"}));
        assert_eq!(
            (stop.name.as_str(), stop.arguments),
            ("stop_agent", json!({"agent_id": "b1"}))
        );
        let legacy = normalize("TaskStop", &json!({"shell_id": "b3"}));
        assert_eq!(legacy.arguments, json!({"shellId": "b3"}));
        let kill = normalize("KillShell", &json!({"shell_id": "b2"}));
        assert_eq!(
            (kill.name.as_str(), kill.arguments),
            ("stop_powershell", json!({"shellId": "b2"}))
        );
        let read = normalize("BashOutput", &json!({"bash_id": "b2", "filter": "error"}));
        assert_eq!(
            (read.name.as_str(), read.arguments),
            (
                "read_powershell",
                json!({"shellId": "b2", "filter": "error"})
            )
        );
        for (native, canonical) in [
            ("Glob", "glob"),
            ("WebFetch", "web_fetch"),
            ("WebSearch", "web_search"),
        ] {
            let tool = normalize(native, &json!({"pattern": "*.rs"}));
            assert_eq!(tool.name, canonical);
            assert_eq!(tool.arguments, json!({"pattern": "*.rs"}));
        }
    }

    #[test]
    fn shells_join_the_canonical_shell_family() {
        let bash = normalize(
            "Bash",
            &json!({"command": "ls", "description": "List", "timeout": 5000, "run_in_background": true}),
        );
        assert_eq!(bash.name, "shell");
        assert_eq!(
            bash.arguments,
            json!({"command": "ls", "description": "List", "timeout": 5000, "mode": "background"})
        );
        let ps = normalize(
            "PowerShell",
            &json!({"command": "dir", "run_in_background": false}),
        );
        assert_eq!(ps.name, "powershell");
        assert_eq!(ps.arguments, json!({"command": "dir", "mode": "sync"}));
    }

    #[test]
    fn read_becomes_view_with_an_inclusive_range() {
        let whole = normalize("Read", &json!({"file_path": "a.rs"}));
        assert_eq!(
            (whole.name.as_str(), whole.arguments),
            ("view", json!({"path": "a.rs"}))
        );
        let ranged = normalize(
            "Read",
            &json!({"file_path": "a.rs", "offset": 10, "limit": 5}),
        );
        assert_eq!(
            ranged.arguments,
            json!({"path": "a.rs", "view_range": [10, 14]})
        );
        let open = normalize("Read", &json!({"file_path": "a.rs", "offset": 0}));
        assert_eq!(
            open.arguments,
            json!({"path": "a.rs", "view_range": [1, -1]})
        );
        let head = normalize("Read", &json!({"file_path": "a.rs", "limit": 3}));
        assert_eq!(
            head.arguments,
            json!({"path": "a.rs", "view_range": [1, 3]})
        );
    }

    #[test]
    fn ask_user_question_becomes_a_requested_schema() {
        let ask = normalize(
            "AskUserQuestion",
            &json!({"questions": [
                {"question": "Which viewport?", "header": "Viewport", "multiSelect": false,
                 "options": [{"label": "Desktop", "description": "1440"}, {"label": "Minimum"}]},
                {"question": "Which themes?", "header": "Themes", "multiSelect": true,
                 "options": [{"label": "Dark"}, {"label": "Light"}]},
            ]}),
        );
        assert_eq!(ask.name, "ask_user");
        assert_eq!(
            ask.arguments.get("message"),
            None,
            "two questions have no single prompt"
        );
        assert_eq!(
            ask.arguments["requestedSchema"],
            json!({"type": "object", "required": ["q1", "q2"], "properties": {
                "q1": {"title": "Viewport", "description": "Which viewport?", "type": "string",
                       "oneOf": [{"const": "Desktop", "title": "Desktop"},
                                 {"const": "Minimum", "title": "Minimum"}]},
                "q2": {"title": "Themes", "description": "Which themes?", "type": "array",
                       "items": {"type": "string", "anyOf": [{"const": "Dark", "title": "Dark"},
                                                             {"const": "Light", "title": "Light"}]}},
            }})
        );
        let one = normalize(
            "AskUserQuestion",
            &json!({"questions": [{"question": "Ship?"}]}),
        );
        assert_eq!(one.arguments["message"], "Ship?");
        let odd = normalize("AskUserQuestion", &json!("not an object"));
        assert_eq!(odd.arguments["requestedSchema"]["properties"], json!({}));
    }

    #[test]
    fn unmapped_tools_keep_their_native_name_and_mcp_tools_split() {
        for native in [
            "Monitor",
            "ToolSearch",
            "NotebookEdit",
            "ExitPlanMode",
            "MultiEdit",
        ] {
            let tool = normalize(native, &json!({"file_path": "a"}));
            assert_eq!(tool.name, native);
            assert_eq!(tool.arguments, json!({"file_path": "a"}));
            assert_eq!(tool.mcp_server_name, None);
        }
        let mcp = normalize("mcp__docs__search_pages", &json!({"q": 1}));
        assert_eq!(mcp.name, "mcp__docs__search_pages");
        assert_eq!(mcp.arguments, json!({"q": 1}));
        assert_eq!(mcp.mcp_server_name.as_deref(), Some("docs"));
        assert_eq!(mcp.mcp_tool_name.as_deref(), Some("search_pages"));
        let dashed = normalize("mcp__github-server__get_file", &json!({}));
        assert_eq!(dashed.mcp_server_name.as_deref(), Some("github-server"));
        assert_eq!(dashed.mcp_tool_name.as_deref(), Some("get_file"));
        let bare = normalize("mcp__docs", &json!({}));
        assert_eq!((bare.mcp_server_name, bare.mcp_tool_name), (None, None));
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
