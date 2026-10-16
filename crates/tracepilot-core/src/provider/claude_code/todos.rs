//! The session's task list, rebuilt from the main transcript's tool calls.
//!
//! Claude Code keeps no task file beside a session, so the list is replayed
//! from the calls that changed it, in file order:
//!
//! - The desktop app's `mcp__ccd_turn__update_plan`: `items` replaces the
//!   list; `advance` completes the step in progress and starts the next
//!   pending one; `done`/`start` name 1-based steps. Its `wrap_up` completes
//!   the step still in progress.
//! - `TaskCreate`/`TaskUpdate` (CLI, opt-in on current models): one task per
//!   create, with the id from `toolUseResult.task.id`; updates change status,
//!   text and dependencies, and `deleted` removes the task.
//! - Legacy `TodoWrite`: `todos` replaces the list.
//!
//! A call counts once its result arrives without an error, so a refused or
//! interrupted call never changes the list. Subagents keep their own lists,
//! which the app never shows, so only the main transcript is read.

use std::collections::HashMap;

use serde_json::Value;

use super::reader::Line;
use super::records::{Blocks, Rec, block_type, tool_result_text};
use crate::parsing::session_db::{TodoDep, TodoItem};
use crate::provider::TodoList;

const UPDATE_PLAN: &str = "mcp__ccd_turn__update_plan";
const WRAP_UP: &str = "mcp__ccd_turn__wrap_up";
const TASK_CREATE: &str = "TaskCreate";
const TASK_UPDATE: &str = "TaskUpdate";
const TODO_WRITE: &str = "TodoWrite";

const PENDING: &str = "pending";
const IN_PROGRESS: &str = "in_progress";
const DONE: &str = "done";

/// The task list at the end of `lines`, or `None` when no call changed one.
pub(super) fn latest_todos(lines: &[Line]) -> Option<TodoList> {
    let mut board = Board::default();
    // Calls waiting for their result: (name, input, call timestamp).
    let mut calls: HashMap<&str, (&str, &Value, Option<String>)> = HashMap::new();
    for line in lines {
        let rec = Rec(&line.value);
        if rec.flag("isSidechain") {
            continue;
        }
        let Blocks::Array(blocks) = rec.blocks() else {
            continue;
        };
        for block in blocks {
            match block_type(block) {
                "tool_use" => {
                    let name = block.get("name").and_then(Value::as_str).unwrap_or("");
                    if !is_todo_tool(name) {
                        continue;
                    }
                    if let (Some(id), Some(input)) =
                        (block.get("id").and_then(Value::as_str), block.get("input"))
                    {
                        let at = rec.timestamp().map(|ts| ts.to_rfc3339());
                        calls.insert(id, (name, input, at));
                    }
                }
                "tool_result" => {
                    let Some((name, input, at)) = block
                        .get("tool_use_id")
                        .and_then(Value::as_str)
                        .and_then(|id| calls.remove(id))
                    else {
                        continue;
                    };
                    if block.get("is_error").and_then(Value::as_bool) == Some(true) {
                        continue;
                    }
                    board.apply(name, input, at, rec.0.get("toolUseResult"), block);
                }
                _ => {}
            }
        }
    }
    board.touched.then(|| board.into_list())
}

fn is_todo_tool(name: &str) -> bool {
    matches!(
        name,
        UPDATE_PLAN | WRAP_UP | TASK_CREATE | TASK_UPDATE | TODO_WRITE
    )
}

struct Entry {
    item: TodoItem,
    /// Ids of the tasks this one waits on.
    blocked_by: Vec<String>,
}

#[derive(Default)]
struct Board {
    entries: Vec<Entry>,
    /// A call changed the list, even if it ends empty.
    touched: bool,
    /// `TaskCreate`/`TaskUpdate` were used, so dependencies are known.
    tracks_deps: bool,
}

impl Board {
    fn apply(
        &mut self,
        name: &str,
        input: &Value,
        at: Option<String>,
        tool_use_result: Option<&Value>,
        result: &Value,
    ) {
        match name {
            UPDATE_PLAN => self.update_plan(input, at),
            // Only a list the session kept: a wrap-up alone has no steps.
            WRAP_UP => self.complete_in_progress(at.as_deref()),
            TASK_CREATE => self.task_create(input, at, tool_use_result, result),
            TASK_UPDATE => self.task_update(input, at),
            TODO_WRITE => {
                if let Some(todos) = input.get("todos").and_then(Value::as_array) {
                    self.replace(todos, "content", at);
                }
            }
            _ => {}
        }
    }

    fn update_plan(&mut self, input: &Value, at: Option<String>) {
        if let Some(items) = input.get("items").and_then(Value::as_array) {
            self.replace(items, "content", at.clone());
        }
        if input.get("advance").and_then(Value::as_bool) == Some(true) {
            let current = self.position(IN_PROGRESS);
            self.complete_in_progress(at.as_deref());
            let next = current
                .and_then(|from| self.position_after(from, PENDING))
                .or_else(|| self.position(PENDING));
            if let Some(next) = next {
                self.set_status(next, IN_PROGRESS, at.as_deref());
            }
        }
        for step in input
            .get("done")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(step_index)
        {
            self.set_status(step, DONE, at.as_deref());
        }
        if let Some(step) = input.get("start").and_then(step_index) {
            self.set_status(step, IN_PROGRESS, at.as_deref());
        }
    }

    /// Replace the list with `items`, each titled by `title_key`. Ids are
    /// 1-based positions, as `update_plan` names its steps; an item whose
    /// title was already listed keeps its creation time.
    fn replace(&mut self, items: &[Value], title_key: &str, at: Option<String>) {
        self.touched = true;
        self.tracks_deps = false;
        let previous = std::mem::take(&mut self.entries);
        for (index, item) in items.iter().enumerate() {
            let Some(title) = item
                .get(title_key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|title| !title.is_empty())
            else {
                continue;
            };
            let status = status(item.get("status")).unwrap_or(PENDING);
            let before = previous.iter().find(|entry| entry.item.title == title);
            let changed = before.is_none_or(|entry| entry.item.status != status);
            self.entries.push(Entry {
                item: TodoItem {
                    id: (index + 1).to_string(),
                    title: title.to_string(),
                    description: None,
                    status: status.to_string(),
                    created_at: before
                        .map(|entry| entry.item.created_at.clone())
                        .unwrap_or_else(|| at.clone()),
                    updated_at: if changed {
                        at.clone()
                    } else {
                        before.and_then(|entry| entry.item.updated_at.clone())
                    },
                },
                blocked_by: Vec::new(),
            });
        }
    }

    fn task_create(
        &mut self,
        input: &Value,
        at: Option<String>,
        tool_use_result: Option<&Value>,
        result: &Value,
    ) {
        let Some(subject) = input
            .get("subject")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|subject| !subject.is_empty())
        else {
            return;
        };
        if self.touched && !self.tracks_deps {
            // A list from `TodoWrite`/`update_plan` is not a task list.
            self.entries.clear();
        }
        self.touched = true;
        self.tracks_deps = true;
        let id = tool_use_result
            .and_then(|tur| tur.pointer("/task/id"))
            .and_then(id_text)
            .or_else(|| created_id(&tool_result_text(result)))
            .unwrap_or_else(|| self.next_id());
        self.entries.retain(|entry| entry.item.id != id);
        self.entries.push(Entry {
            item: TodoItem {
                id,
                title: subject.to_string(),
                description: text(input, "description"),
                status: PENDING.to_string(),
                created_at: at.clone(),
                updated_at: at,
            },
            blocked_by: Vec::new(),
        });
    }

    fn task_update(&mut self, input: &Value, at: Option<String>) {
        // Claude Code repairs `id`/`task_id` to `taskId` before running it.
        let Some(id) = ["taskId", "id", "task_id"]
            .into_iter()
            .find_map(|key| input.get(key).and_then(id_text))
        else {
            return;
        };
        if input.get("status").and_then(Value::as_str) == Some("deleted") {
            self.entries.retain(|entry| entry.item.id != id);
            for entry in &mut self.entries {
                entry.blocked_by.retain(|blocker| *blocker != id);
            }
            return;
        }
        let Some(index) = self.entries.iter().position(|entry| entry.item.id == id) else {
            return;
        };
        let entry = &mut self.entries[index];
        if let Some(status) = status(input.get("status")) {
            entry.item.status = status.to_string();
        }
        if let Some(subject) = text(input, "subject") {
            entry.item.title = subject;
        }
        if let Some(description) = text(input, "description") {
            entry.item.description = Some(description);
        }
        entry.item.updated_at = at;
        for blocker in ids(input.get("addBlockedBy")) {
            push_unique(&mut self.entries[index].blocked_by, blocker);
        }
        for blocked in ids(input.get("addBlocks")) {
            if let Some(entry) = self.entries.iter_mut().find(|e| e.item.id == blocked) {
                push_unique(&mut entry.blocked_by, id.clone());
            }
        }
    }

    fn complete_in_progress(&mut self, at: Option<&str>) {
        if let Some(index) = self.position(IN_PROGRESS) {
            self.set_status(index, DONE, at);
        }
    }

    fn position(&self, status: &str) -> Option<usize> {
        self.entries.iter().position(|e| e.item.status == status)
    }

    fn position_after(&self, from: usize, status: &str) -> Option<usize> {
        (from + 1..self.entries.len()).find(|&i| self.entries[i].item.status == status)
    }

    fn set_status(&mut self, index: usize, status: &str, at: Option<&str>) {
        if let Some(entry) = self.entries.get_mut(index)
            && entry.item.status != status
        {
            entry.item.status = status.to_string();
            entry.item.updated_at = at.map(str::to_string);
        }
    }

    /// One past the highest numeric id, as Claude Code numbers its tasks.
    fn next_id(&self) -> String {
        let highest = self
            .entries
            .iter()
            .filter_map(|entry| entry.item.id.parse::<u64>().ok())
            .max()
            .unwrap_or(0);
        (highest + 1).to_string()
    }

    fn into_list(self) -> TodoList {
        let deps = self.tracks_deps.then(|| {
            let known = |id: &String| self.entries.iter().any(|entry| entry.item.id == *id);
            self.entries
                .iter()
                .flat_map(|entry| {
                    entry
                        .blocked_by
                        .iter()
                        .filter(|blocker| known(blocker))
                        .map(|blocker| TodoDep {
                            todo_id: entry.item.id.clone(),
                            depends_on: blocker.clone(),
                        })
                })
                .collect()
        });
        TodoList {
            items: self.entries.into_iter().map(|entry| entry.item).collect(),
            deps,
        }
    }
}

/// Claude Code's status as TracePilot's: `completed` is `done`. Unknown
/// statuses are ignored rather than shown as something they are not.
fn status(value: Option<&Value>) -> Option<&'static str> {
    match value.and_then(Value::as_str)? {
        "pending" => Some(PENDING),
        "in_progress" => Some(IN_PROGRESS),
        "completed" => Some(DONE),
        _ => None,
    }
}

/// A 1-based step number as a list index.
fn step_index(value: &Value) -> Option<usize> {
    let step = value.as_u64()?;
    usize::try_from(step).ok()?.checked_sub(1)
}

/// A task id, written as a string or a number.
fn id_text(value: &Value) -> Option<String> {
    match value {
        Value::String(id) if !id.trim().is_empty() => Some(id.trim().to_string()),
        Value::Number(id) => Some(id.to_string()),
        _ => None,
    }
}

fn ids(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(id_text)
        .collect()
}

fn text(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// `Task #<id> created successfully: …`, the result text of a create.
fn created_id(text: &str) -> Option<String> {
    let rest = text.trim_start().strip_prefix("Task #")?;
    let id: String = rest.chars().take_while(char::is_ascii_digit).collect();
    (!id.is_empty()).then_some(id)
}

fn push_unique(ids: &mut Vec<String>, id: String) {
    if !ids.contains(&id) {
        ids.push(id);
    }
}
