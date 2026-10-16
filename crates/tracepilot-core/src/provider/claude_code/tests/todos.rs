//! The task list `ClaudeCodeProvider::artifacts` replays from the desktop
//! app's `update_plan`, the CLI's `TaskCreate`/`TaskUpdate` and legacy
//! `TodoWrite`.

use serde_json::{Value, json};
use tracepilot_test_support::claude::{
    OPUS, SESSION_ID, SessionFiles, Subagent, Transcript, Usage, subagent_meta, tool_use,
    write_session,
};

use super::super::ClaudeCodeProvider;
use crate::ids::SessionId;
use crate::provider::{SessionProvider, TodoList};

const UPDATE_PLAN: &str = "mcp__ccd_turn__update_plan";
const WRAP_UP: &str = "mcp__ccd_turn__wrap_up";

fn todos(files: &SessionFiles) -> Option<TodoList> {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .expect("fixture session resolves");
    assert!(provider.capabilities().has_todos);
    provider.artifacts(&locator).unwrap().todos
}

/// One call and its result.
fn call(t: &mut Transcript, id: &str, name: &str, input: Value, result: &str, tur: Value) {
    t.call(
        &format!("msg_{id}"),
        OPUS,
        vec![tool_use(id, name, input)],
        Usage::new(1, 10, 0, 5),
        "tool_use",
    );
    t.tool_result(id, json!(result), tur, false);
}

fn plan(t: &mut Transcript, id: &str, input: Value) {
    call(t, id, UPDATE_PLAN, input, "Plan updated.", Value::Null);
}

fn statuses(list: &TodoList) -> Vec<(&str, &str, &str)> {
    list.items
        .iter()
        .map(|item| (item.id.as_str(), item.title.as_str(), item.status.as_str()))
        .collect()
}

fn steps(names: &[(&str, &str)]) -> Value {
    names
        .iter()
        .map(|(content, status)| json!({"content": content, "status": status}))
        .collect()
}

/// `items` replaces the list, `advance` moves to the next pending step,
/// `done`/`start` name 1-based steps and `wrap_up` completes the step in
/// progress. Claude's `completed` is TracePilot's `done`.
#[test]
fn update_plan_replays_the_desktop_task_list() {
    let mut t = Transcript::main();
    t.prompt("Ship the fix.");
    plan(
        &mut t,
        "toolu_p1",
        json!({"items": steps(&[("Read code", "in_progress"), ("Fix bug", "pending"),
            ("Add tests", "pending"), ("Open PR", "pending")]), "scope": "first_task"}),
    );
    plan(&mut t, "toolu_p2", json!({"advance": true}));
    plan(&mut t, "toolu_p3", json!({"done": [2, 3], "start": 4}));
    call(
        &mut t,
        "toolu_w1",
        WRAP_UP,
        json!({"recap": "Done."}),
        "Shown in the next-step box.",
        Value::Null,
    );
    let list = todos(&write_session(&t, &[])).expect("a task list");
    assert_eq!(
        statuses(&list),
        [
            ("1", "Read code", "done"),
            ("2", "Fix bug", "done"),
            ("3", "Add tests", "done"),
            ("4", "Open PR", "done"),
        ]
    );
    assert!(list.deps.is_none(), "update_plan records no dependencies");
    assert!(list.items.iter().all(|item| item.created_at.is_some()));
}

/// A resent list keeps each unchanged step's creation and update times, and
/// a step whose status changed is stamped with the resend.
#[test]
fn a_resent_plan_keeps_known_steps_times() {
    let mut t = Transcript::main();
    t.prompt("Plan it.");
    plan(
        &mut t,
        "toolu_p1",
        json!({"items": steps(&[("Survey", "in_progress"), ("Build", "pending")])}),
    );
    t.idle(60);
    plan(
        &mut t,
        "toolu_p2",
        json!({"items": steps(&[("Survey", "completed"), ("Build", "pending"),
            ("Verify", "in_progress")])}),
    );
    let list = todos(&write_session(&t, &[])).unwrap();
    let [survey, build, verify] = &list.items[..] else {
        panic!("three steps: {:?}", statuses(&list));
    };
    assert_eq!(survey.status, "done");
    assert_eq!(survey.created_at, build.created_at);
    assert_ne!(
        survey.created_at, survey.updated_at,
        "Survey changed status"
    );
    assert_eq!(build.updated_at, build.created_at, "Build never changed");
    assert_eq!(verify.created_at, survey.updated_at);
}

/// A refused call (a subagent's, which the app rejects) and a call that
/// never got its result change nothing.
#[test]
fn failed_and_unanswered_calls_are_ignored() {
    let mut t = Transcript::main();
    t.prompt("Go.");
    plan(
        &mut t,
        "toolu_p1",
        json!({"items": steps(&[("One", "in_progress"), ("Two", "pending")])}),
    );
    t.call(
        "msg_refused",
        OPUS,
        vec![tool_use("toolu_p2", UPDATE_PLAN, json!({"advance": true}))],
        Usage::new(1, 10, 0, 5),
        "tool_use",
    );
    t.tool_result(
        "toolu_p2",
        json!("PreToolUse hook error: Not shown: you are a subagent"),
        json!("Error: Not shown"),
        true,
    );
    t.call(
        "msg_unanswered",
        OPUS,
        vec![tool_use("toolu_p3", UPDATE_PLAN, json!({"done": [1, 2]}))],
        Usage::new(1, 10, 0, 5),
        "tool_use",
    );
    let list = todos(&write_session(&t, &[])).unwrap();
    assert_eq!(
        statuses(&list),
        [("1", "One", "in_progress"), ("2", "Two", "pending")]
    );
}

/// Subagents keep their own lists, which the app never shows.
#[test]
fn subagent_task_lists_are_not_the_sessions() {
    let mut main = Transcript::main();
    main.prompt("Delegate.");
    let mut sub = Transcript::subagent("a1", 1);
    sub.prompt("Sub task.");
    plan(
        &mut sub,
        "toolu_sub",
        json!({"items": steps(&[("Sub step", "in_progress")])}),
    );
    let meta = subagent_meta("toolu_agent", "general-purpose", 1);
    let files = write_session(
        &main,
        &[Subagent {
            agent_id: "a1",
            transcript: &sub,
            meta: Some(meta),
        }],
    );
    assert!(todos(&files).is_none());
}

/// `TaskCreate` takes its id from `toolUseResult.task.id` (or the result
/// text), `TaskUpdate` changes status, text and dependencies under any of
/// its id spellings, and `deleted` removes the task and its edges.
#[test]
fn task_tools_replay_tasks_and_dependencies() {
    let mut t = Transcript::main();
    t.prompt("Build the site.");
    for (id, subject, task_id) in [
        ("toolu_c1", "Home page", "1"),
        ("toolu_c2", "About page", "2"),
        ("toolu_c3", "Stylesheet", "3"),
        ("toolu_c4", "Scratch", "4"),
    ] {
        call(
            &mut t,
            id,
            "TaskCreate",
            json!({"subject": subject, "description": format!("Write the {subject}."),
                "activeForm": format!("Writing {subject}")}),
            &format!("Task #{task_id} created successfully: {subject}"),
            // The last create's id comes from its result text only.
            if task_id == "4" {
                Value::Null
            } else {
                json!({"task": {"id": task_id, "subject": subject}})
            },
        );
    }
    let update = |t: &mut Transcript, id: &str, input: Value| {
        call(t, id, "TaskUpdate", input, "Updated task", Value::Null);
    };
    update(
        &mut t,
        "toolu_u1",
        json!({"taskId": "1", "addBlockedBy": ["3"], "status": "in_progress"}),
    );
    update(
        &mut t,
        "toolu_u2",
        json!({"id": "3", "addBlocks": ["2", "4"]}),
    );
    update(
        &mut t,
        "toolu_u3",
        json!({"task_id": 3, "status": "completed", "subject": "Shared stylesheet"}),
    );
    update(
        &mut t,
        "toolu_u4",
        json!({"taskId": "4", "status": "deleted"}),
    );
    // An unknown status is ignored rather than shown as something else.
    update(
        &mut t,
        "toolu_u5",
        json!({"taskId": "2", "status": "paused"}),
    );

    let list = todos(&write_session(&t, &[])).unwrap();
    assert_eq!(
        statuses(&list),
        [
            ("1", "Home page", "in_progress"),
            ("2", "About page", "pending"),
            ("3", "Shared stylesheet", "done"),
        ]
    );
    assert_eq!(
        list.items[0].description.as_deref(),
        Some("Write the Home page.")
    );
    let deps: Vec<(&str, &str)> = list
        .deps
        .as_ref()
        .expect("task tools record dependencies")
        .iter()
        .map(|dep| (dep.todo_id.as_str(), dep.depends_on.as_str()))
        .collect();
    assert_eq!(deps, [("1", "3"), ("2", "3")]);
}

/// Legacy `TodoWrite` sends the whole list each time.
#[test]
fn todo_write_replaces_the_list() {
    let mut t = Transcript::main();
    t.prompt("Track it.");
    let write = |t: &mut Transcript, id: &str, todos: Value| {
        call(
            t,
            id,
            "TodoWrite",
            json!({ "todos": todos }),
            "Todos have been modified successfully.",
            Value::Null,
        );
    };
    write(
        &mut t,
        "toolu_t1",
        json!([{"content": "Parse", "status": "in_progress", "activeForm": "Parsing"},
            {"content": "Render", "status": "pending", "activeForm": "Rendering"}]),
    );
    write(
        &mut t,
        "toolu_t2",
        json!([{"content": "Parse", "status": "completed", "activeForm": "Parsing"},
            {"content": "Render", "status": "in_progress", "activeForm": "Rendering"},
            {"content": "  ", "status": "pending"}]),
    );
    let list = todos(&write_session(&t, &[])).unwrap();
    assert_eq!(
        statuses(&list),
        [("1", "Parse", "done"), ("2", "Render", "in_progress")]
    );
    assert!(list.deps.is_none());
}

/// A list that ends empty is still the session's list; a wrap-up with no
/// list makes none.
#[test]
fn an_emptied_list_differs_from_no_list() {
    let mut t = Transcript::main();
    t.prompt("Go.");
    call(
        &mut t,
        "toolu_w0",
        WRAP_UP,
        json!({"recap": "Answered."}),
        "Nothing is pending.",
        Value::Null,
    );
    let files = write_session(&t, &[]);
    assert!(todos(&files).is_none());

    plan(&mut t, "toolu_p1", json!({"items": []}));
    let list = todos(&write_session(&t, &[])).expect("an empty list");
    assert!(list.items.is_empty());
}

/// `advance` with nothing in progress starts the first pending step, and
/// out-of-range or zero steps change nothing.
#[test]
fn advance_and_steps_tolerate_odd_input() {
    let mut t = Transcript::main();
    t.prompt("Go.");
    plan(
        &mut t,
        "toolu_p1",
        json!({"items": steps(&[("One", "completed"), ("Two", "pending"), ("Three", "pending")])}),
    );
    plan(&mut t, "toolu_p2", json!({"advance": true}));
    plan(&mut t, "toolu_p3", json!({"done": [0, 9, "2"], "start": 7}));
    let list = todos(&write_session(&t, &[])).unwrap();
    assert_eq!(
        statuses(&list),
        [
            ("1", "One", "done"),
            ("2", "Two", "in_progress"),
            ("3", "Three", "pending")
        ]
    );
}

/// Blank items are dropped and ids stay the steps `done`/`start` name;
/// repeated titles each keep their own times.
#[test]
fn blank_and_repeated_titles_keep_steps_aligned() {
    let mut t = Transcript::main();
    t.prompt("Go.");
    plan(
        &mut t,
        "toolu_p1",
        json!({"items": steps(&[("Check", "completed"), ("Check", "pending")])}),
    );
    t.idle(60);
    plan(
        &mut t,
        "toolu_p2",
        json!({"items": steps(&[("Check", "completed"), (" ", "pending"),
            ("Check", "pending"), ("Ship", "pending")]), "start": 3}),
    );
    let list = todos(&write_session(&t, &[])).unwrap();
    assert_eq!(
        statuses(&list),
        [
            ("1", "Check", "done"),
            ("2", "Check", "pending"),
            ("3", "Ship", "in_progress")
        ]
    );
    let [first, second, _] = &list.items[..] else {
        unreachable!()
    };
    assert_eq!(
        first.updated_at, first.created_at,
        "unchanged since the first list"
    );
    assert_eq!(
        second.updated_at, second.created_at,
        "matched its own earlier copy"
    );
}

/// The checklist and the task list are separate, as in Claude Code: a task
/// update never touches a plan step with the same id, and the list changed
/// last is shown.
#[test]
fn checklist_and_tasks_stay_apart() {
    let mut t = Transcript::main();
    t.prompt("Go.");
    for (id, subject, task_id) in [("toolu_c1", "Task one", "1"), ("toolu_c2", "Task two", "2")] {
        call(
            &mut t,
            id,
            "TaskCreate",
            json!({ "subject": subject }),
            "Task created",
            json!({"task": {"id": task_id, "subject": subject}}),
        );
    }
    plan(
        &mut t,
        "toolu_p1",
        json!({"items": steps(&[("Step one", "in_progress"), ("Step two", "pending")])}),
    );
    let files = write_session(&t, &[]);
    let list = todos(&files).unwrap();
    assert_eq!(
        statuses(&list),
        [
            ("1", "Step one", "in_progress"),
            ("2", "Step two", "pending")
        ]
    );
    assert!(list.deps.is_none());

    call(
        &mut t,
        "toolu_u1",
        "TaskUpdate",
        json!({"taskId": "2", "status": "completed"}),
        "Updated task #2",
        Value::Null,
    );
    let list = todos(&write_session(&t, &[])).unwrap();
    assert_eq!(
        statuses(&list),
        [("1", "Task one", "pending"), ("2", "Task two", "done")]
    );

    // Advancing the plan shows the checklist again, untouched by the update.
    plan(&mut t, "toolu_p2", json!({"advance": true}));
    let list = todos(&write_session(&t, &[])).unwrap();
    assert_eq!(
        statuses(&list),
        [("1", "Step one", "done"), ("2", "Step two", "in_progress")]
    );
}

/// An update that changes nothing keeps the task's update time.
#[test]
fn a_no_op_task_update_keeps_its_time() {
    let mut t = Transcript::main();
    t.prompt("Go.");
    call(
        &mut t,
        "toolu_c1",
        "TaskCreate",
        json!({"subject": "Only task"}),
        "Task #1 created successfully: Only task",
        Value::Null,
    );
    t.idle(60);
    call(
        &mut t,
        "toolu_u1",
        "TaskUpdate",
        json!({"taskId": "1", "status": "pending", "addBlocks": ["9"], "addBlockedBy": ["1"]}),
        "Updated task #1",
        Value::Null,
    );
    let list = todos(&write_session(&t, &[])).unwrap();
    let task = &list.items[0];
    assert_eq!(task.updated_at, task.created_at);
    assert_eq!(list.deps.as_deref().map(<[_]>::len), Some(0));
}

/// Sidechain records inside the main file are a subagent's, not the
/// session's.
#[test]
fn sidechain_records_in_the_main_file_are_skipped() {
    let mut t = Transcript::main();
    t.prompt("Go.");
    t.record(
        "assistant",
        json!({"isSidechain": true, "message": {"id": "msg_side", "model": OPUS,
            "role": "assistant", "content": [tool_use("toolu_side", UPDATE_PLAN,
                json!({"items": steps(&[("Side step", "pending")])}))]}}),
    );
    t.record(
        "user",
        json!({"isSidechain": true, "message": {"role": "user", "content": [{
            "type": "tool_result", "tool_use_id": "toolu_side", "content": "Plan shown."}]}}),
    );
    assert!(todos(&write_session(&t, &[])).is_none());
}
