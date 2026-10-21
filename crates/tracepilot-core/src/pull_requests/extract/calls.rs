//! First pass: the tool calls that can link a pull request, joined with
//! their results. An async shell's output, read later through
//! `read_powershell`/`read_bash` (Copilot) or `BashOutput`/`TaskOutput`
//! (Claude Code) with the same shell id, is joined to the command that
//! started it.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::Value;

use super::command::{Shell, ShellCommand, parse_command};
use super::output::{exit_code_trailer, running_shell_id};
use super::text::bounded;
use crate::parsing::events::TypedEvent;

/// A GitHub MCP tool (or the Claude app's PR binding) that names a pull request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum McpKind {
    Read,
    Merge,
    Update,
    Create,
    Bind,
}

pub(super) enum CallKind<'a> {
    Shell(ShellCommand),
    Mcp { kind: McpKind, args: &'a Value },
}

pub(super) struct Call<'a> {
    /// Index of the call's `tool.execution_start`.
    pub(super) start: usize,
    pub(super) at: Option<DateTime<Utc>>,
    pub(super) kind: CallKind<'a>,
    /// Result text: content, detailed content, error message, and any later
    /// reads of an async shell.
    pub(super) outputs: Vec<&'a str>,
    pub(super) exit_code: Option<i64>,
    /// The call reported failure (`success: false`).
    pub(super) failed: bool,
    /// It ran in the background: without an exit code, its outcome is unknown.
    pub(super) background: bool,
    pub(super) completed: bool,
}

#[derive(Clone, Copy)]
enum Slot {
    Call(usize),
    Read(usize),
}

fn str_at<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// A shell id, which sessions record as a string or a number.
fn shell_id(args: &Value) -> Option<String> {
    ["shellId", "shell_id", "bash_id", "task_id"]
        .iter()
        .find_map(|key| match args.get(*key)? {
            Value::String(id) => Some(id.clone()),
            Value::Number(id) => Some(id.to_string()),
            _ => None,
        })
}

fn is_shell(tool: &str) -> bool {
    matches!(
        tool,
        "powershell" | "bash" | "shell" | "run_powershell" | "pwsh"
    )
}

fn is_shell_read(tool: &str) -> bool {
    matches!(
        tool,
        "read_powershell"
            | "read_bash"
            | "write_powershell"
            | "write_bash"
            | "BashOutput"
            | "TaskOutput"
    )
}

/// The MCP server and tool a call names: the recorded fields, else
/// `mcp__<server>__<tool>` (Claude Code) or `github-mcp-server-<tool>`.
fn mcp_kind(data: &Value, tool_name: &str) -> Option<McpKind> {
    let (server, tool) = match (str_at(data, "mcpServerName"), str_at(data, "mcpToolName")) {
        (Some(server), Some(tool)) => (server, tool),
        _ => {
            if let Some(rest) = tool_name.strip_prefix("mcp__") {
                rest.split_once("__")?
            } else {
                (
                    "github-mcp-server",
                    tool_name.strip_prefix("github-mcp-server-")?,
                )
            }
        }
    };
    let server = server.to_ascii_lowercase();
    if tool == "bind_pr" && server.contains("ccd_pr") {
        return Some(McpKind::Bind);
    }
    if !server.contains("github") {
        return None;
    }
    Some(match tool {
        "pull_request_read" => McpKind::Read,
        "merge_pull_request" => McpKind::Merge,
        "update_pull_request" | "update_pull_request_branch" => McpKind::Update,
        "create_pull_request" => McpKind::Create,
        tool if tool.starts_with("get_pull_request") => McpKind::Read,
        _ => return None,
    })
}

/// The text pieces of a `tool.execution_complete`: content, detailed
/// content when it differs, and the error message.
fn result_texts(data: &Value) -> impl Iterator<Item = &str> {
    let result = data.get("result");
    let content = result.and_then(|r| r.as_str().or_else(|| str_at(r, "content")));
    let detailed = result
        .and_then(|r| str_at(r, "detailedContent"))
        .filter(|d| Some(*d) != content);
    let error = data
        .get("error")
        .and_then(|e| e.as_str().or_else(|| str_at(e, "message")));
    [content, detailed, error].into_iter().flatten()
}

fn trailer(text: &str) -> Option<i64> {
    let [head, tail] = bounded(text);
    exit_code_trailer(if tail.is_empty() { head } else { tail })
}

/// Collect the calls worth evaluating, in the order they started.
pub(super) fn collect(events: &[TypedEvent]) -> Vec<Call<'_>> {
    let mut calls: Vec<Call<'_>> = Vec::new();
    let mut slots: HashMap<&str, Slot> = HashMap::new();
    let mut shells: HashMap<String, usize> = HashMap::new();
    for (index, event) in events.iter().enumerate() {
        let data = &event.raw.data;
        match event.raw.event_type.as_str() {
            "tool.execution_start" => {
                let (Some(id), Some(tool)) = (str_at(data, "toolCallId"), str_at(data, "toolName"))
                else {
                    continue;
                };
                let args = data.get("arguments").unwrap_or(&Value::Null);
                if is_shell_read(tool) {
                    if let Some(origin) = shell_id(args).and_then(|s| shells.get(&s).copied()) {
                        slots.insert(id, Slot::Read(origin));
                    }
                    continue;
                }
                let kind = if is_shell(tool) {
                    let Some(command) = str_at(args, "command") else {
                        continue;
                    };
                    let shell = if matches!(tool, "shell" | "bash") {
                        Shell::Bash
                    } else {
                        Shell::PowerShell
                    };
                    let command = parse_command(command, shell);
                    if command.is_empty() {
                        continue;
                    }
                    CallKind::Shell(command)
                } else if let Some(kind) = mcp_kind(data, tool) {
                    CallKind::Mcp { kind, args }
                } else {
                    continue;
                };
                let slot = calls.len();
                if matches!(kind, CallKind::Shell(_))
                    && let Some(shell) = shell_id(args)
                {
                    shells.insert(shell, slot);
                }
                let background = matches!(str_at(args, "mode"), Some("background" | "async"))
                    || args.get("detach").and_then(Value::as_bool) == Some(true);
                calls.push(Call {
                    start: index,
                    at: event.raw.timestamp,
                    kind,
                    outputs: Vec::new(),
                    exit_code: None,
                    failed: false,
                    background,
                    completed: false,
                });
                slots.insert(id, Slot::Call(slot));
            }
            "tool.execution_complete" => {
                let Some(slot) = str_at(data, "toolCallId").and_then(|id| slots.get(id).copied())
                else {
                    continue;
                };
                match slot {
                    Slot::Call(slot) => {
                        let call = &mut calls[slot];
                        call.completed = true;
                        call.failed = data.get("success").and_then(Value::as_bool) == Some(false);
                        call.exit_code = data
                            .get("shellExecution")
                            .and_then(|s| s.get("exitCode"))
                            .and_then(Value::as_i64);
                        for text in result_texts(data) {
                            call.outputs.push(text);
                            if call.exit_code.is_none() {
                                call.exit_code = trailer(text);
                            }
                            if text.starts_with("Command running in background")
                                || text.contains("moved to the background")
                            {
                                call.background = true;
                            }
                            if let Some(shell) = running_shell_id(text)
                                && matches!(call.kind, CallKind::Shell(_))
                            {
                                call.background = true;
                                shells.insert(shell.to_string(), slot);
                            }
                        }
                    }
                    Slot::Read(origin) => {
                        let call = &mut calls[origin];
                        for text in result_texts(data) {
                            call.outputs.push(text);
                            if let Some(code) = trailer(text) {
                                call.exit_code = Some(code);
                            }
                        }
                    }
                }
            }
            "system.notification" => {
                // Claude Code: a background shell finished.
                let Some(kind) = data.get("kind") else {
                    continue;
                };
                if str_at(kind, "type") == Some("shell_completed")
                    && let Some(origin) = shell_id(kind).and_then(|s| shells.get(&s).copied())
                    && let Some(code) = kind.get("exitCode").and_then(Value::as_i64)
                {
                    calls[origin].exit_code = Some(code);
                }
            }
            _ => {}
        }
    }
    calls
}
