//! The background-task list served by `ClaudeCodeProvider::artifacts`.

use serde_json::json;
use tracepilot_test_support::claude::{
    OPUS, SESSION_ID, SessionFiles, Transcript, Usage, task_notification, text, tool_use,
    write_session,
};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::super::ClaudeCodeProvider;
use crate::ids::SessionId;
use crate::provider::{BackgroundTask, BackgroundTaskKind, BackgroundTaskStatus, SessionProvider};

fn tasks(files: &SessionFiles) -> Vec<BackgroundTask> {
    let provider = ClaudeCodeProvider::new(files.root.path());
    let locator = provider
        .resolve(&SessionId::from_validated(SESSION_ID))
        .unwrap()
        .expect("fixture session resolves");
    provider.artifacts(&locator).unwrap().background_tasks
}

fn ids(tasks: &[BackgroundTask]) -> Vec<&str> {
    tasks.iter().map(|t| t.id.as_str()).collect()
}

/// A's completion arrives in a `queue-operation`, an
/// `attachment:queued_command` and a `user` record: one entry, not three.
/// C was launched but never reported, so it is not listed.
#[test]
fn duplicated_notifications_make_one_task() {
    let list = tasks(&fixtures::subagents());
    assert_eq!(ids(&list), ["agentA", "agentB"]);
    let a = &list[0];
    assert_eq!(a.kind, BackgroundTaskKind::Agent);
    assert_eq!(a.status, BackgroundTaskStatus::Completed);
    assert_eq!(a.tool_call_id.as_deref(), Some("toolu_A"));
    assert_eq!(a.description.as_deref(), Some("indexer"));
    assert_eq!(a.total_tokens, Some(700));
    assert_eq!(a.tool_calls, Some(3));
    assert_eq!(a.duration_ms, Some(9000));
    assert!(a.started_at.is_some());
    assert!(a.finished_at.is_some());
    assert!(a.started_at < a.finished_at);
    // B has no meta.json; its `Agent` call still names it.
    assert_eq!(list[1].description.as_deref(), Some("exporter"));
    assert_eq!(list[1].kind, BackgroundTaskKind::Agent);
}

/// Shells and agents side by side; a shell notified without any launch in
/// the transcript is still listed, as a shell.
#[test]
fn shells_and_agents_from_notifications() {
    let list = tasks(&fixtures::meta_records(true));
    assert_eq!(ids(&list), ["shell1", "a1", "shell2"]);
    let shell = &list[0];
    assert_eq!(shell.kind, BackgroundTaskKind::Shell);
    assert_eq!(shell.status, BackgroundTaskStatus::Completed);
    assert_eq!(shell.description.as_deref(), Some("npm run build"));
    assert_eq!(shell.tool_call_id.as_deref(), Some("toolu_b1"));
    assert_eq!(shell.total_tokens, None);
    assert_eq!(list[1].kind, BackgroundTaskKind::Agent);
    assert_eq!(list[1].description.as_deref(), Some("Map the indexer"));
    assert_eq!(list[2].kind, BackgroundTaskKind::Shell);
    assert_eq!(list[2].started_at, None);
}

/// `task_status` reports a task before (and after) its notification. A
/// finished task never reopens, and a task reported only by `task_status`
/// keeps its reported kind and description.
#[test]
fn task_status_reports_merge_with_notifications() {
    let mut t = Transcript::main();
    t.prompt("Run the slow suite.");
    t.call(
        "msg_1",
        OPUS,
        vec![tool_use(
            "toolu_suite",
            "Bash",
            json!({"command": "npm run test:slow\nnpm run lint", "run_in_background": true}),
        )],
        Usage::new(1, 10, 0, 1),
        "tool_use",
    );
    t.tool_result(
        "toolu_suite",
        json!("Command running in background with ID: bg_suite"),
        json!({"stdout": "", "stderr": "", "interrupted": false, "isImage": false,
            "backgroundTaskId": "bg_suite"}),
        false,
    );
    let status = |id: &str, kind: &str, status: &str, description: &str| {
        json!({"attachment": {"type": "task_status", "taskId": id, "taskType": kind,
            "status": status, "description": description, "deltaSummary": null}})
    };
    t.record(
        "attachment",
        status("bg_suite", "local_bash", "running", "Slow suite"),
    );
    t.record(
        "attachment",
        status("w1", "local_workflow", "running", "Nightly workflow"),
    );
    for progress in ["Stage 1 of 3", "Stage 2 of 3"] {
        t.record(
            "attachment",
            json!({"attachment": {"type": "task_status", "taskId": "w1",
                "taskType": "local_workflow", "status": "running",
                "description": "Nightly workflow", "deltaSummary": progress}}),
        );
    }
    let failed = "<task-notification>\n<task-id>bg_suite</task-id>\n<tool-use-id>toolu_suite</tool-use-id>\n\
        <status>failed</status>\n<summary>Background command \"Slow suite\" failed (exit code 1)</summary>\n\
        </task-notification>";
    t.bookkeeping(json!({"type": "queue-operation", "operation": "enqueue", "content": failed}));
    t.user(json!({"origin": {"kind": "task-notification"},
        "message": {"role": "user", "content": failed}}));
    // A stale status after the failure leaves it failed.
    t.record(
        "attachment",
        status("bg_suite", "local_bash", "running", "Slow suite"),
    );
    // A tool result that quotes a notification is not a report.
    t.call(
        "msg_2",
        OPUS,
        vec![tool_use(
            "toolu_read",
            "Read",
            json!({"file_path": "notes.md"}),
        )],
        Usage::new(1, 10, 0, 1),
        "tool_use",
    );
    t.tool_result(
        "toolu_read",
        json!(task_notification(
            "quoted",
            "toolu_quoted",
            "completed",
            None
        )),
        json!({"type": "text"}),
        false,
    );
    t.call(
        "msg_3",
        OPUS,
        vec![text("The slow suite failed.")],
        Usage::new(1, 10, 0, 1),
        "end_turn",
    );
    let files = write_session(&t, &[]);

    let list = tasks(&files);
    assert_eq!(ids(&list), ["bg_suite", "w1"]);
    let suite = &list[0];
    assert_eq!(suite.kind, BackgroundTaskKind::Shell);
    assert_eq!(suite.status, BackgroundTaskStatus::Failed);
    assert_eq!(suite.tool_call_id.as_deref(), Some("toolu_suite"));
    assert_eq!(suite.description.as_deref(), Some("Slow suite"));
    assert_eq!(
        suite.summary.as_deref(),
        Some("Background command \"Slow suite\" failed (exit code 1)")
    );
    let workflow = &list[1];
    assert_eq!(workflow.kind, BackgroundTaskKind::Other);
    assert_eq!(workflow.status, BackgroundTaskStatus::Running);
    assert_eq!(workflow.description.as_deref(), Some("Nightly workflow"));
    assert_eq!(workflow.finished_at, None);
    // The latest progress report, not the first.
    assert_eq!(workflow.summary.as_deref(), Some("Stage 2 of 3"));
}

#[test]
fn sessions_without_background_work_have_none() {
    assert!(tasks(&fixtures::tool_catalog()).is_empty());
}
