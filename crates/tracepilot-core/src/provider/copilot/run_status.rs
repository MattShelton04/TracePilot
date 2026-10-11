//! What a running Copilot CLI session is doing, inferred from the newest
//! events in its `events.jsonl`.
//!
//! Copilot CLI writes no busy/idle flag to disk: its `session.idle` event is
//! ephemeral and never persisted, and the `inuse.<pid>.lock` file only says a
//! process owns the session. So the status is read from the persisted events,
//! replayed in order over the end of the file:
//!
//! - **Waiting** (for the user) when the newest decisive event is
//!   - `assistant.turn_end` after a main-agent `assistant.message` that
//!     requested no tools: the agent has replied and the loop has stopped. A
//!     turn whose reply requested tools is followed by another turn, so it
//!     stays Busy.
//!   - `abort`: the user interrupted, and the CLI is back at its prompt.
//!   - `session.error`: the agent loop stopped on an error.
//!   - `session.start` or `session.resume` with nothing after it yet.
//! - **Waiting** also, whatever came last, while an `ask_user` tool call or a
//!   `permission.requested` has no matching completion: the CLI is blocked on
//!   a question or an approval prompt.
//! - **Busy** when the newest decisive event is work: a user or system message
//!   starting an interaction, a turn starting, an assistant message, a tool
//!   call starting or finishing (including a background subagent's after the
//!   main agent replied), a subagent or compaction starting, or a background
//!   notification that wakes the agent.
//! - **Unknown** (`None`) after `session.shutdown`, or when the tail has no
//!   decisive event.
//!
//! Hooks, model and usage records and informational `session.*` events never
//! change who has the turn, so they are skipped; so are event types this
//! module does not know.
//!
//! The CLI writes `tool.execution_start` before it asks for permission, so a
//! CLI version that does not persist `permission.*` shows an approval prompt
//! as Busy, never as Waiting.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::Deserialize;
use serde::de::IgnoredAny;

use crate::provider::RunStatus;

/// Bytes read from the end of `events.jsonl`. One tool result can be large,
/// so a tail with no decisive event is read again with the larger window.
const TAIL_WINDOWS: [u64; 2] = [128 * 1024, 2 * 1024 * 1024];

/// The status of the session whose events are at `events_path`. `None` when
/// the file is missing, unreadable, or its tail shows no decisive event.
pub(super) fn run_status(events_path: &Path) -> Option<RunStatus> {
    let mut file = File::open(events_path).ok()?;
    let len = file.metadata().ok()?.len();
    for window in TAIL_WINDOWS {
        let start = len.saturating_sub(window);
        file.seek(SeekFrom::Start(start)).ok()?;
        let mut tail = Vec::new();
        file.read_to_end(&mut tail).ok()?;
        let tracker = replay(&tail, start > 0);
        if tracker.decided || start == 0 {
            return tracker.status();
        }
    }
    None
}

/// Replays every complete line of `tail`. When the tail starts mid-file its
/// first line is partial and skipped; so is a last line still being written.
fn replay(tail: &[u8], starts_mid_file: bool) -> Tracker {
    let mut lines = tail.split(|byte| *byte == b'\n');
    if starts_mid_file {
        lines.next();
    }
    let mut tracker = Tracker::default();
    for record in lines.filter_map(|line| serde_json::from_slice::<Record>(line).ok()) {
        tracker.apply(&record);
    }
    tracker
}

/// The fields of one event this module reads; the rest are skipped unparsed.
#[derive(Deserialize)]
struct Record {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    data: Option<Data>,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Data {
    tool_call_id: Option<String>,
    tool_name: Option<String>,
    request_id: Option<String>,
    /// Set on a subagent's messages and tool calls.
    parent_tool_call_id: Option<String>,
    tool_requests: Option<Vec<IgnoredAny>>,
}

#[derive(Default)]
struct Tracker {
    /// The status the newest decisive event implies.
    phase: Option<RunStatus>,
    /// Some event in the tail was decisive.
    decided: bool,
    /// Tool calls started and not finished, and whether each is `ask_user`.
    open_tools: HashMap<String, bool>,
    /// Permission requests not yet completed.
    open_permissions: HashSet<String>,
    /// Whether the current turn's newest main-agent message requested no
    /// tools; `None` when the tail holds no message for this turn.
    final_reply: Option<bool>,
}

impl Tracker {
    fn apply(&mut self, record: &Record) {
        let empty = Data::default();
        let data = record.data.as_ref().unwrap_or(&empty);
        let phase = match record.kind.as_str() {
            "session.start" | "session.resume" | "abort" => {
                self.clear_open();
                Some(RunStatus::Waiting)
            }
            "session.shutdown" => {
                self.clear_open();
                None
            }
            "session.error" => Some(RunStatus::Waiting),
            "assistant.turn_start" => {
                self.settle_calls();
                self.final_reply = Some(false);
                Some(RunStatus::Busy)
            }
            "assistant.turn_end" => {
                self.settle_calls();
                match self.final_reply {
                    Some(true) => Some(RunStatus::Waiting),
                    Some(false) => Some(RunStatus::Busy),
                    // The turn's message lies before the tail, so this decides
                    // nothing; the wider read finds it.
                    None => return,
                }
            }
            "assistant.message" => {
                if data.parent_tool_call_id.is_none() {
                    let requested = data.tool_requests.as_ref().is_some_and(|r| !r.is_empty());
                    self.final_reply = Some(!requested);
                }
                Some(RunStatus::Busy)
            }
            "tool.execution_start" => {
                if let Some(id) = &data.tool_call_id {
                    let asks_user = data.tool_name.as_deref() == Some("ask_user");
                    self.open_tools.insert(id.clone(), asks_user);
                }
                Some(RunStatus::Busy)
            }
            "tool.execution_complete" => {
                if let Some(id) = &data.tool_call_id {
                    self.open_tools.remove(id);
                }
                Some(RunStatus::Busy)
            }
            "permission.requested" => {
                if let Some(id) = &data.request_id {
                    self.open_permissions.insert(id.clone());
                }
                self.decided = true;
                return;
            }
            "permission.completed" => {
                if let Some(id) = &data.request_id {
                    self.open_permissions.remove(id);
                }
                self.decided = true;
                return;
            }
            "user.message"
            | "system.message"
            | "system.notification"
            | "assistant.reasoning"
            | "tool.user_requested"
            | "skill.invoked"
            | "subagent.started"
            | "subagent.completed"
            | "subagent.failed"
            | "session.compaction_start" => Some(RunStatus::Busy),
            _ => return,
        };
        self.phase = phase;
        self.decided = true;
    }

    /// A restart, an interrupt or an exit abandons whatever was in flight.
    fn clear_open(&mut self) {
        self.settle_calls();
        self.final_reply = None;
    }

    /// A turn boundary means the previous turn's calls were all answered: the
    /// agent never starts or ends a turn while blocked on the user. Some
    /// sessions miss a completion record, and this keeps one from reading as
    /// Waiting for the rest of the session.
    fn settle_calls(&mut self) {
        self.open_tools.clear();
        self.open_permissions.clear();
    }

    fn status(&self) -> Option<RunStatus> {
        let blocked_on_user =
            !self.open_permissions.is_empty() || self.open_tools.values().any(|asks| *asks);
        if blocked_on_user {
            Some(RunStatus::Waiting)
        } else {
            self.phase
        }
    }
}

#[cfg(test)]
#[path = "run_status_tests.rs"]
mod tests;
