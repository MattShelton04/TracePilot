//! The session's task list, rebuilt from the main transcript's tool calls.
//!
//! The transcript is the one record of the list every client keeps: the
//! desktop app stores none, and the CLI's `todos/` and `tasks/` folders are
//! optional and outlive their session. So the list is replayed from the
//! calls that changed it, in file order:
//!
//! - The desktop app's `mcp__ccd_turn__update_plan`: `items` replaces the
//!   list; `advance` completes the step in progress and starts the next
//!   pending one; `done`/`start` name 1-based steps. Its `wrap_up` completes
//!   the step still in progress.
//! - Legacy `TodoWrite`: `todos` replaces the list.
//! - `TaskCreate`/`TaskUpdate` (CLI, opt-in on current models): one task per
//!   create, with the id from `toolUseResult.task.id`; updates change status,
//!   text and dependencies, and `deleted` removes the task.
//!
//! The first two keep one checklist and the task tools a separate task list,
//! as Claude Code does; the one changed last is the session's list.
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
        // `toolUseResult` belongs to the record, so it describes a result
        // only when the record holds just one.
        let results = blocks
            .iter()
            .filter(|b| block_type(b) == "tool_result")
            .count();
        let tool_use_result = rec.0.get("toolUseResult").filter(|_| results == 1);
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
                    board.apply(name, input, at, tool_use_result, block);
                }
                _ => {}
            }
        }
    }
    board.into_list()
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

/// Which list a call changed.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Family {
    /// `update_plan` and `TodoWrite`: an ordered list without dependencies.
    Checklist,
    /// `TaskCreate`/`TaskUpdate`: tasks by id, with dependencies.
    Tasks,
}

#[derive(Default)]
struct Board {
    checklist: Vec<Entry>,
    tasks: Vec<Entry>,
    /// The family changed last, if any call changed a list (even to empty).
    latest: Option<Family>,
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
            // A wrap-up never starts a list; it only checks off the step
            // still in progress.
            WRAP_UP => complete_in_progress(&mut self.checklist, at.as_deref()),
            TODO_WRITE => self.todo_write(input, at),
            TASK_CREATE => self.task_create(input, at, tool_use_result, result),
            TASK_UPDATE => self.task_update(input, at),
            _ => {}
        }
    }

    fn update_plan(&mut self, input: &Value, at: Option<String>) {
        if let Some(items) = input.get("items").and_then(Value::as_array) {
            self.replace(items, at.clone());
        } else if self.checklist.is_empty() {
            return;
        }
        self.latest = Some(Family::Checklist);
        let list = &mut self.checklist;
        if input.get("advance").and_then(Value::as_bool) == Some(true) {
            let current = position(list, IN_PROGRESS);
            complete_in_progress(list, at.as_deref());
            let next = current
                .and_then(|from| (from + 1..list.len()).find(|&i| list[i].item.status == PENDING))
                .or_else(|| position(list, PENDING));
            if let Some(next) = next {
                set_status(list, next, IN_PROGRESS, at.as_deref());
            }
        }
        for step in input
            .get("done")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(step_index)
        {
            set_status(list, step, DONE, at.as_deref());
        }
        if let Some(step) = input.get("start").and_then(step_index) {
            set_status(list, step, IN_PROGRESS, at.as_deref());
        }
    }

    fn todo_write(&mut self, input: &Value, at: Option<String>) {
        if let Some(todos) = input.get("todos").and_then(Value::as_array) {
            self.replace(todos, at);
        }
    }

    /// Replace the checklist with `items`. Ids are 1-based positions, as
    /// `update_plan` names its steps; an item whose title was already listed
    /// keeps its creation time.
    fn replace(&mut self, items: &[Value], at: Option<String>) {
        self.latest = Some(Family::Checklist);
        let mut previous = std::mem::take(&mut self.checklist);
        for item in items {
            let Some(title) = text(item, "content") else {
                continue;
            };
            let status = status(item.get("status")).unwrap_or(PENDING);
            // Each earlier entry matches once, so repeated titles keep
            // their own times.
            let before = previous
                .iter()
                .position(|entry| entry.item.title == title)
                .map(|index| previous.remove(index).item);
            let changed = before.as_ref().is_none_or(|item| item.status != status);
            let (created_at, updated_at) = match before {
                Some(item) if !changed => (item.created_at, item.updated_at),
                Some(item) => (item.created_at, at.clone()),
                None => (at.clone(), at.clone()),
            };
            self.checklist.push(Entry {
                item: TodoItem {
                    id: (self.checklist.len() + 1).to_string(),
                    title,
                    description: None,
                    status: status.to_string(),
                    created_at,
                    updated_at,
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
        let Some(subject) = text(input, "subject") else {
            return;
        };
        self.latest = Some(Family::Tasks);
        let id = tool_use_result
            .and_then(|tur| tur.pointer("/task/id"))
            .and_then(id_text)
            .or_else(|| created_id(&tool_result_text(result)))
            .unwrap_or_else(|| next_id(&self.tasks));
        self.tasks.retain(|entry| entry.item.id != id);
        self.tasks.push(Entry {
            item: TodoItem {
                id,
                title: subject,
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
        let tasks = &mut self.tasks;
        let Some(index) = tasks.iter().position(|entry| entry.item.id == id) else {
            return;
        };
        self.latest = Some(Family::Tasks);
        if input.get("status").and_then(Value::as_str) == Some("deleted") {
            tasks.remove(index);
            for entry in tasks.iter_mut() {
                entry.blocked_by.retain(|blocker| *blocker != id);
            }
            return;
        }
        let mut changed = false;
        let item = &mut tasks[index].item;
        if let Some(status) = status(input.get("status")) {
            changed |= replace_if_new(&mut item.status, status.to_string());
        }
        if let Some(subject) = text(input, "subject") {
            changed |= replace_if_new(&mut item.title, subject);
        }
        if let Some(description) = text(input, "description") {
            changed |= item.description.as_deref() != Some(description.as_str());
            item.description = Some(description);
        }
        for blocker in ids(input.get("addBlockedBy")) {
            if blocker != id {
                changed |= push_unique(&mut tasks[index].blocked_by, blocker);
            }
        }
        for blocked in ids(input.get("addBlocks")) {
            if let Some(entry) = tasks
                .iter_mut()
                .find(|e| e.item.id == blocked && blocked != id)
            {
                changed |= push_unique(&mut entry.blocked_by, id.clone());
            }
        }
        if changed {
            tasks[index].item.updated_at = at;
        }
    }

    fn into_list(self) -> Option<TodoList> {
        match self.latest? {
            Family::Checklist => Some(TodoList {
                items: self.checklist.into_iter().map(|entry| entry.item).collect(),
                deps: None,
            }),
            Family::Tasks => {
                let tasks = self.tasks;
                let known = |id: &String| tasks.iter().any(|entry| entry.item.id == *id);
                let deps = tasks
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
                    .collect();
                Some(TodoList {
                    items: tasks.into_iter().map(|entry| entry.item).collect(),
                    deps: Some(deps),
                })
            }
        }
    }
}

fn complete_in_progress(list: &mut [Entry], at: Option<&str>) {
    if let Some(index) = position(list, IN_PROGRESS) {
        set_status(list, index, DONE, at);
    }
}

fn position(list: &[Entry], status: &str) -> Option<usize> {
    list.iter().position(|entry| entry.item.status == status)
}

fn set_status(list: &mut [Entry], index: usize, status: &str, at: Option<&str>) {
    if let Some(entry) = list.get_mut(index)
        && entry.item.status != status
    {
        entry.item.status = status.to_string();
        entry.item.updated_at = at.map(str::to_string);
    }
}

/// One past the highest numeric id, as Claude Code numbers its tasks.
fn next_id(tasks: &[Entry]) -> String {
    let highest = tasks
        .iter()
        .filter_map(|entry| entry.item.id.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    (highest + 1).to_string()
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

/// A trimmed, non-blank string field.
fn text(value: &Value, key: &str) -> Option<String> {
    value
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

fn replace_if_new(field: &mut String, value: String) -> bool {
    let changed = *field != value;
    *field = value;
    changed
}

fn push_unique(ids: &mut Vec<String>, id: String) -> bool {
    let new = !ids.contains(&id);
    if new {
        ids.push(id);
    }
    new
}
