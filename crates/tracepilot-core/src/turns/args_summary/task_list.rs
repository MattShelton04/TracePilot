//! Mirrors `taskListSummary()` from
//! `packages/ui/src/components/renderers/taskList.ts`: a one-line summary of
//! a Claude task-list call (`update_plan`, `wrap_up`, `TodoWrite`,
//! `TaskCreate`, `TaskUpdate`) read from its arguments alone.

use serde_json::{Map, Value};

use super::js;

const UPDATE_PLAN: &str = "mcp__ccd_turn__update_plan";
const WRAP_UP: &str = "mcp__ccd_turn__wrap_up";

/// Tool names whose summary comes from [`task_list_summary`].
pub(super) const TASK_LIST_TOOLS: [&str; 5] = [
    UPDATE_PLAN,
    WRAP_UP,
    "TodoWrite",
    "TaskCreate",
    "TaskUpdate",
];

/// `text()`: a non-blank string, trimmed.
fn text(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(js::trim)
        .filter(|s| !s.is_empty())
}

/// A listed step's status, when it is one of Claude's three.
#[derive(PartialEq)]
enum Status {
    Completed,
    InProgress,
    Other,
}

/// `steps()`: the steps of an array argument whose items carry `text_key`.
fn steps(value: Option<&Value>, text_key: &str) -> Option<Vec<Status>> {
    let items = value?.as_array()?;
    Some(
        items
            .iter()
            .filter_map(Value::as_object)
            .filter(|item| text(item.get(text_key)).is_some())
            .map(|item| match item.get("status").and_then(Value::as_str) {
                Some("completed") => Status::Completed,
                Some("in_progress") => Status::InProgress,
                _ => Status::Other,
            })
            .collect(),
    )
}

/// `stepNumber()`: a positive integer, as `update_plan` numbers steps.
fn step_number(value: &Value) -> Option<String> {
    let n = value.as_number()?;
    let f = n.as_f64()?;
    (f.fract() == 0.0 && f > 0.0).then(|| js::number(n))
}

/// `joinNumbers()`: "1", "1 and 2", "1, 2 and 4".
fn join_numbers(numbers: &[String]) -> String {
    match numbers {
        [] => String::new(),
        [only] => only.clone(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
}

fn plan_changes(a: &Map<String, Value>) -> Vec<String> {
    let mut changes = Vec::new();
    if a.get("advance") == Some(&Value::Bool(true)) {
        changes.push("Advanced to the next step".to_string());
    }
    let done: Vec<String> = a
        .get("done")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(step_number).collect())
        .unwrap_or_default();
    if !done.is_empty() {
        let plural = if done.len() > 1 { "s" } else { "" };
        changes.push(format!("Completed step{plural} {}", join_numbers(&done)));
    }
    if let Some(start) = a.get("start").and_then(step_number) {
        changes.push(format!("Started step {start}"));
    }
    changes
}

/// `taskId()`: a task id written as a string or a number.
fn task_id(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::Number(n)) => Some(js::number(n)),
        other => text(other).map(String::from),
    }
}

fn task_ids(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| task_id(Some(item)))
                .map(|id| format!("#{id}"))
                .collect()
        })
        .unwrap_or_default()
}

fn task_update(a: &Map<String, Value>) -> Vec<String> {
    // Claude Code accepts `id`/`task_id` as spellings of `taskId`.
    let id = task_id(a.get("taskId"))
        .or_else(|| task_id(a.get("id")))
        .or_else(|| task_id(a.get("task_id")));
    let name = id
        .as_ref()
        .map_or_else(|| "a task".to_string(), |id| format!("task #{id}"));
    let mut changes = Vec::new();
    match a.get("status").and_then(Value::as_str) {
        Some("deleted") => changes.push(format!("Deleted {name}")),
        Some("") | None => {}
        Some(status) => {
            let word = match status {
                "in_progress" => "in progress",
                other => other,
            };
            changes.push(format!("Marked {name} {word}"));
        }
    }
    if let Some(subject) = text(a.get("subject")) {
        changes.push(format!("Renamed {name} to “{subject}”"));
    }
    if text(a.get("description")).is_some() {
        changes.push(format!("Updated the description of {name}"));
    }
    let blocked_by = task_ids(a.get("addBlockedBy"));
    if !blocked_by.is_empty() {
        changes.push(format!(
            "{} waits on {}",
            capitalize(&name),
            join_numbers(&blocked_by)
        ));
    }
    let blocks = task_ids(a.get("addBlocks"));
    if !blocks.is_empty() {
        let verb = if blocks.len() > 1 { "wait" } else { "waits" };
        changes.push(format!("{} {verb} on {name}", join_numbers(&blocks)));
    }
    if changes.is_empty() && id.is_some() {
        changes.push(format!("Updated {name}"));
    }
    changes
}

fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// `taskListSummary()`, e.g. "4 steps · 1 done · 1 in progress", or "".
pub(super) fn task_list_summary(tool_name: &str, a: &Map<String, Value>) -> String {
    let (steps, changes) = match tool_name {
        WRAP_UP => {
            let first = text(a.get("recap"))
                .or_else(|| text(a.get("ask")))
                .and_then(|s| s.split('\n').next())
                .unwrap_or_default();
            return js::trim(first).to_string();
        }
        "TaskCreate" => {
            return text(a.get("subject")).unwrap_or_default().to_string();
        }
        UPDATE_PLAN => (steps(a.get("items"), "content"), plan_changes(a)),
        "TodoWrite" => (steps(a.get("todos"), "content"), Vec::new()),
        "TaskUpdate" => (None, task_update(a)),
        _ => (None, Vec::new()),
    };
    let mut parts = Vec::new();
    if let Some(steps) = steps {
        let count = |status: Status| steps.iter().filter(|s| **s == status).count();
        let plural = if steps.len() == 1 { "" } else { "s" };
        parts.push(format!("{} step{plural}", steps.len()));
        let done = count(Status::Completed);
        if done > 0 {
            parts.push(format!("{done} done"));
        }
        let active = count(Status::InProgress);
        if active > 0 {
            parts.push(format!("{active} in progress"));
        }
    }
    parts.extend(changes);
    parts.join(" · ")
}
