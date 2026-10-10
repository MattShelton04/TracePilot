//! Background shells: a `system.notification` of kind `shell_completed` (or
//! Copilot's `shell_detached_completed`) settles the call that started the
//! shell, found by shell id.
//!
//! A call starts a background shell when it runs in `async`/`background`
//! mode or detached, or when its result says the command is still running
//! (a Copilot sync call that outlived its initial wait). Its id comes from
//! the `shellId` argument (Claude Code's `backgroundTaskId` is copied there
//! by the provider) or from the result's closing line. Copilot reuses shell
//! ids, so the latest launch of an id owns its next completion.

use serde_json::Value;

use crate::models::conversation::BackgroundOutcome;
use crate::models::event_types::SystemNotificationData;
use crate::parsing::events::TypedEvent;

use super::TurnReconstructor;

/// Tools that start a shell. Read/write/stop tools only address one.
const LAUNCH_TOOLS: &[&str] = &["shell", "bash", "powershell"];

impl TurnReconstructor {
    /// Index a call whose arguments already name a background shell.
    pub(super) fn register_background_shell_launch(
        &mut self,
        tool_call_id: Option<&str>,
        tool_name: Option<&str>,
        args: Option<&Value>,
    ) {
        let (Some(call), Some(id)) = (tool_call_id, launch_shell_id(tool_name, args)) else {
            return;
        };
        self.background_shells.insert(id, call.to_string());
    }

    /// Index a call whose result reveals that its shell kept running.
    pub(super) fn register_background_shell_result(
        &mut self,
        tool_call_id: Option<&str>,
        result: Option<&Value>,
    ) {
        let Some(call) = self.find_tool_call_ref(tool_call_id) else {
            return;
        };
        if !LAUNCH_TOOLS.contains(&call.tool_name.as_str()) {
            return;
        }
        let Some(id) = result.and_then(result_text).and_then(running_shell_id) else {
            return;
        };
        if let Some(call) = tool_call_id {
            self.background_shells.insert(id, call.to_string());
        }
    }

    pub(super) fn handle_system_notification(
        &mut self,
        event: &TypedEvent,
        data: &SystemNotificationData,
    ) {
        let Some(kind) = data.kind.as_ref() else {
            return;
        };
        let kind_type = kind.get("type").and_then(Value::as_str);
        if !matches!(
            kind_type,
            Some("shell_completed" | "shell_detached_completed")
        ) {
            return;
        }
        let Some(shell_id) = kind.get("shellId").and_then(id_string) else {
            return;
        };
        let Some(status) = terminal_status(kind.get("status")) else {
            return;
        };
        let Some(call_id) = self.background_shells.remove(&shell_id) else {
            tracing::debug!(%shell_id, "Background shell completion with no launch — skipping");
            return;
        };
        if let Some(call) = self.find_tool_call_mut(Some(&call_id)) {
            call.background_outcome = Some(BackgroundOutcome {
                status,
                exit_code: kind.get("exitCode").and_then(Value::as_i64),
                completed_at: event.raw.timestamp,
            });
        }
    }
}

/// The shell id of a call that starts in the background by its arguments.
fn launch_shell_id(tool_name: Option<&str>, args: Option<&Value>) -> Option<String> {
    if !tool_name.is_some_and(|name| LAUNCH_TOOLS.contains(&name)) {
        return None;
    }
    let args = args?;
    let mode = args.get("mode").and_then(Value::as_str);
    let detached = args.get("detach").and_then(Value::as_bool) == Some(true);
    if !(detached || matches!(mode, Some("async" | "background"))) {
        return None;
    }
    args.get("shellId").and_then(id_string)
}

/// A string id, or a numeric one as text.
fn id_string(value: &Value) -> Option<String> {
    match value {
        Value::String(id) if !id.trim().is_empty() => Some(id.trim().to_string()),
        Value::Number(id) => Some(id.to_string()),
        _ => None,
    }
}

fn result_text(result: &Value) -> Option<&str> {
    match result {
        Value::String(text) => Some(text),
        Value::Object(obj) => obj.get("content")?.as_str(),
        _ => None,
    }
}

/// The shell id from a result's closing line when the shell kept running:
/// `<command started in background with shellId: N>`, `<command started in
/// detached background with shellId: N>` or `<command with shellId: N is
/// still running after …>`.
fn running_shell_id(text: &str) -> Option<String> {
    let line = text.lines().rev().map(str::trim).find(|l| !l.is_empty())?;
    let running = line.starts_with("<command started in ")
        || (line.starts_with("<command with shellId: ") && line.contains(" is still running"));
    if !running {
        return None;
    }
    let rest = line.split_once("shellId: ")?.1;
    let id = rest.split(|c: char| c.is_whitespace() || c == '>').next()?;
    (!id.is_empty()).then(|| id.to_string())
}

/// The reported final status, normalized; `None` while the shell runs.
/// Copilot reports no status: its notification means the shell completed.
fn terminal_status(status: Option<&Value>) -> Option<String> {
    let Some(status) = status.and_then(Value::as_str) else {
        return Some("completed".into());
    };
    let status = status.trim().to_ascii_lowercase();
    Some(match status.as_str() {
        "running" | "pending" => return None,
        "completed" | "success" | "succeeded" => "completed".into(),
        "failed" | "error" => "failed".into(),
        "stopped" | "killed" | "cancelled" | "canceled" => "stopped".into(),
        "" => "completed".into(),
        _ => status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_shell_id_of_a_shell_that_kept_running() {
        let cases = [
            (
                "out\n<command started in background with shellId: 7>",
                Some("7"),
            ),
            (
                "<command started in detached background with shellId: srv>\n",
                Some("srv"),
            ),
            (
                "partial\n<command with shellId: build-1 is still running after 30 seconds. Use read_powershell to continue waiting.>",
                Some("build-1"),
            ),
            ("done\n<shellId: 7 completed with exit code 0>", None),
            ("<exited with exit code 0>", None),
            ("<command with shellId: 7>", None),
        ];
        for (text, expected) in cases {
            assert_eq!(running_shell_id(text).as_deref(), expected, "{text}");
        }
    }

    #[test]
    fn launch_ids_need_background_arguments() {
        let id = |name, args: Value| launch_shell_id(Some(name), Some(&args));
        assert_eq!(
            id("shell", json!({"mode": "background", "shellId": "b1"})).as_deref(),
            Some("b1")
        );
        assert_eq!(
            id("powershell", json!({"mode": "async", "shellId": 4})).as_deref(),
            Some("4")
        );
        assert_eq!(
            id("powershell", json!({"detach": true, "shellId": "d"})).as_deref(),
            Some("d")
        );
        assert_eq!(
            id("powershell", json!({"mode": "sync", "shellId": "s"})),
            None
        );
        assert_eq!(id("powershell", json!({"shellId": "s"})), None);
        assert_eq!(
            id("read_powershell", json!({"mode": "async", "shellId": "s"})),
            None
        );
    }

    #[test]
    fn statuses_are_normalized() {
        let status = |value: Value| terminal_status(Some(&value));
        assert_eq!(terminal_status(None).as_deref(), Some("completed"));
        assert_eq!(status(Value::Null).as_deref(), Some("completed"));
        assert_eq!(status(json!("completed")).as_deref(), Some("completed"));
        assert_eq!(status(json!("failed")).as_deref(), Some("failed"));
        assert_eq!(status(json!("killed")).as_deref(), Some("stopped"));
        assert_eq!(status(json!("stopped")).as_deref(), Some("stopped"));
        assert_eq!(status(json!("running")), None);
        assert_eq!(status(json!("timed_out")).as_deref(), Some("timed_out"));
    }
}
