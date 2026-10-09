//! The background-task list: subagents and shells a session ran in the
//! background, built from `<task-notification>` blocks and `task_status`
//! attachments.
//!
//! One completion can arrive in a `user` record, a `queue-operation` and an
//! `attachment:queued_command` (mapping.md §1.3). Every carrier updates the
//! same entry, keyed by task id, so a duplicate never adds a task. Launching
//! calls only add a kind, description and start time: a launch with no report
//! is not listed, because its outcome is unknown.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde_json::Value;

use super::ClaudeDiagnostics;
use super::notify::{TaskNotification, contains_notification, parse_notifications};
use super::reader::{Line, read_jsonl};
use super::records::{Rec, block_type};
use super::subagents::{self, ChildStream};
use super::tools::is_agent_tool;
use crate::error::Result;
use crate::provider::{BackgroundTask, BackgroundTaskKind, BackgroundTaskStatus};

/// The longest shell command kept as a description.
const MAX_COMMAND_CHARS: usize = 200;

/// Read the session at `main` and list its background tasks.
pub(super) fn read_background_tasks(main: &Path) -> Result<Vec<BackgroundTask>> {
    let never = || false;
    let mut diagnostics = ClaudeDiagnostics::default();
    let lines = read_jsonl(main, &never, &mut diagnostics)?;
    let children = subagents::load(main, &never, &mut diagnostics)?;
    Ok(background_tasks(&lines, &children))
}

/// Background tasks reported anywhere in the session: the main transcript's in
/// the order they were first reported, then each subagent file's.
pub(super) fn background_tasks(main: &[Line], children: &[ChildStream]) -> Vec<BackgroundTask> {
    let links = subagents::link(main, children);
    let streams = || std::iter::once(main).chain(children.iter().map(|c| c.lines.as_slice()));
    let mut list = TaskList::default();
    for (agent, tool) in &links.agent_owner {
        list.task_tool.insert(agent.clone(), tool.clone());
    }
    for child in children {
        let description = child.meta.as_ref().and_then(|m| m.description.clone());
        if let Some(description) = description {
            list.agent_descriptions
                .insert(child.agent_id.clone(), description);
        }
    }
    for line in streams().flatten() {
        list.scan_launch(Rec(&line.value));
    }
    for line in streams().flatten() {
        list.scan_report(Rec(&line.value));
    }
    list.finish()
}

/// A call that can start background work.
struct Launch {
    is_agent: bool,
    description: Option<String>,
    at: Option<String>,
}

#[derive(Default)]
struct TaskList {
    tasks: Vec<BackgroundTask>,
    /// Kind from a `task_status` report, which wins over inference.
    reported_kinds: HashMap<String, BackgroundTaskKind>,
    by_id: HashMap<String, usize>,
    /// `tool_use` id → the call.
    launches: HashMap<String, Launch>,
    /// Task id → launching `tool_use` id, from tool results and `meta.json`.
    task_tool: HashMap<String, String>,
    /// Agent id → `meta.json` description.
    agent_descriptions: HashMap<String, String>,
    /// Tasks whose summary came from a notification, which `task_status`
    /// progress never replaces.
    notified: HashSet<usize>,
}

impl TaskList {
    fn scan_launch(&mut self, rec: Rec<'_>) {
        let blocks = rec.0.pointer("/message/content").and_then(Value::as_array);
        for block in blocks.into_iter().flatten() {
            match block_type(block) {
                "tool_use" => {
                    let (Some(id), Some(name)) = (
                        block.get("id").and_then(Value::as_str),
                        block.get("name").and_then(Value::as_str),
                    ) else {
                        continue;
                    };
                    let input = block.get("input").unwrap_or(&Value::Null);
                    let is_agent = is_agent_tool(name);
                    let text = |key: &str| {
                        input
                            .get(key)
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|v| !v.is_empty())
                    };
                    let description = text("description")
                        .map(str::to_string)
                        .or_else(|| text("command").map(shorten));
                    self.launches.insert(
                        id.to_string(),
                        Launch {
                            is_agent,
                            description,
                            at: rec.str("timestamp").map(str::to_string),
                        },
                    );
                }
                "tool_result" => {
                    let tool = block.get("tool_use_id").and_then(Value::as_str);
                    let task = rec.ptr_str("/toolUseResult/backgroundTaskId");
                    if let (Some(tool), Some(task)) = (tool, task) {
                        self.task_tool.insert(task.to_string(), tool.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    fn scan_report(&mut self, rec: Rec<'_>) {
        let at = rec.str("timestamp");
        match rec.kind() {
            "user" if !rec.has_tool_results() && rec.origin_kind() != Some("peer") => {
                let text = rec.text().unwrap_or_default();
                if rec.origin_kind() == Some("task-notification") || contains_notification(&text) {
                    self.notifications(&text, at);
                }
            }
            "queue-operation" => {
                if let Some(content) = rec.str("content") {
                    self.notifications(content, at);
                }
            }
            "attachment" => match rec.ptr_str("/attachment/type") {
                Some("queued_command") => {
                    if let Some(prompt) = rec.ptr_str("/attachment/prompt") {
                        self.notifications(prompt, at);
                    }
                }
                Some("task_status") => {
                    if let Some(body) = rec.0.get("attachment") {
                        self.task_status(body, at);
                    }
                }
                _ => {}
            },
            _ => {}
        }
    }

    fn notifications(&mut self, text: &str, at: Option<&str>) {
        for note in parse_notifications(text) {
            let TaskNotification {
                task_id,
                tool_use_id,
                status,
                summary,
                total_tokens,
                tool_uses,
                duration_ms,
                ..
            } = note;
            let Some(index) = self.entry(task_id, tool_use_id) else {
                continue;
            };
            let task = &mut self.tasks[index];
            update_status(task, parse_status(status.as_deref()), at);
            if summary.is_some() {
                task.summary = summary;
                self.notified.insert(index);
            }
            task.total_tokens = total_tokens.or(task.total_tokens);
            task.tool_calls = tool_uses.or(task.tool_calls);
            task.duration_ms = duration_ms.or(task.duration_ms);
        }
    }

    /// `attachment:task_status`: `{ taskId, taskType, status, description,
    /// deltaSummary, outputFilePath, … }`. The latest `deltaSummary` is the
    /// summary until a notification reports the outcome.
    fn task_status(&mut self, body: &Value, at: Option<&str>) {
        let field = |keys: &[&str]| {
            keys.iter()
                .find_map(|key| body.get(*key).and_then(Value::as_str))
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(str::to_string)
        };
        let task_id = field(&["taskId", "task_id", "id"]);
        let tool_use_id = field(&["toolUseId", "tool_use_id"]);
        let Some(index) = self.entry(task_id, tool_use_id) else {
            return;
        };
        if let Some(kind) = field(&["taskType", "task_type"]).map(|t| task_kind(&t)) {
            let id = self.tasks[index].id.clone();
            self.reported_kinds.insert(id, kind);
        }
        let task = &mut self.tasks[index];
        update_status(task, parse_status(field(&["status"]).as_deref()), at);
        task.description = field(&["description"]).or(task.description.take());
        if !self.notified.contains(&index)
            && let Some(progress) = field(&["deltaSummary", "summary"])
        {
            task.summary = Some(progress);
        }
    }

    /// The entry for a report, created on first sight. A report without a
    /// task id is keyed by its tool-use id.
    fn entry(&mut self, task_id: Option<String>, tool_use_id: Option<String>) -> Option<usize> {
        let id = task_id.clone().or_else(|| {
            let tool = tool_use_id.as_deref()?;
            let known = self
                .tasks
                .iter()
                .find(|task| task.tool_call_id.as_deref() == Some(tool));
            Some(known.map_or_else(|| tool.to_string(), |task| task.id.clone()))
        })?;
        if let Some(index) = self.by_id.get(&id) {
            let task = &mut self.tasks[*index];
            if task.tool_call_id.is_none() {
                task.tool_call_id = tool_use_id;
            }
            return Some(*index);
        }
        let tool_call_id = tool_use_id.or_else(|| self.task_tool.get(&id).cloned());
        self.by_id.insert(id.clone(), self.tasks.len());
        self.tasks.push(BackgroundTask {
            id,
            kind: BackgroundTaskKind::Shell,
            status: BackgroundTaskStatus::Unknown,
            description: None,
            summary: None,
            tool_call_id,
            started_at: None,
            finished_at: None,
            duration_ms: None,
            total_tokens: None,
            tool_calls: None,
        });
        Some(self.tasks.len() - 1)
    }

    /// Fill what the launching call knows and settle each task's kind.
    fn finish(mut self) -> Vec<BackgroundTask> {
        for task in &mut self.tasks {
            let launch = task
                .tool_call_id
                .as_ref()
                .and_then(|tool| self.launches.get(tool));
            if let Some(launch) = launch {
                task.started_at = launch.at.clone();
                if task.description.is_none() {
                    task.description = launch.description.clone();
                }
            }
            let is_agent = launch.is_some_and(|l| l.is_agent)
                || self.agent_descriptions.contains_key(&task.id)
                || task.total_tokens.is_some();
            task.kind = match self.reported_kinds.get(&task.id) {
                Some(kind) => *kind,
                None if is_agent => BackgroundTaskKind::Agent,
                None => BackgroundTaskKind::Shell,
            };
            if task.description.is_none() {
                task.description = self.agent_descriptions.get(&task.id).cloned();
            }
        }
        self.tasks
    }
}

/// A later report replaces the status, except that a finished task stays
/// finished. `finished_at` is the first timed report of the final status.
fn update_status(task: &mut BackgroundTask, status: BackgroundTaskStatus, at: Option<&str>) {
    if task.status.is_terminal() {
        if status == task.status && task.finished_at.is_none() {
            task.finished_at = at.map(str::to_string);
        }
        return;
    }
    if status == BackgroundTaskStatus::Unknown {
        return;
    }
    task.status = status;
    if status.is_terminal() {
        task.finished_at = at.map(str::to_string);
    }
}

fn parse_status(status: Option<&str>) -> BackgroundTaskStatus {
    match status.map(str::to_ascii_lowercase).as_deref() {
        Some("running" | "pending") => BackgroundTaskStatus::Running,
        Some("completed") => BackgroundTaskStatus::Completed,
        Some("failed") => BackgroundTaskStatus::Failed,
        Some("stopped" | "killed" | "cancelled") => BackgroundTaskStatus::Stopped,
        _ => BackgroundTaskStatus::Unknown,
    }
}

/// `task_status.taskType`, such as `local_bash` or `local_agent`.
fn task_kind(task_type: &str) -> BackgroundTaskKind {
    let task_type = task_type.to_ascii_lowercase();
    if task_type.contains("bash") || task_type.contains("shell") {
        BackgroundTaskKind::Shell
    } else if task_type.contains("agent") {
        BackgroundTaskKind::Agent
    } else {
        BackgroundTaskKind::Other
    }
}

fn shorten(command: &str) -> String {
    let line = command.lines().next().unwrap_or("").trim();
    match line.char_indices().nth(MAX_COMMAND_CHARS) {
        Some((cut, _)) => format!("{}…", &line[..cut]),
        None if line.len() < command.trim().len() => format!("{line} …"),
        None => line.to_string(),
    }
}
