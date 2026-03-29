use serde::{Deserialize, Serialize};
use std::fmt;
use strum::{EnumString, IntoStaticStr};

/// All known session event types, plus an `Unknown` catch-all for forward compatibility.
///
/// Wire-format strings are specified via `#[strum(serialize = "...")]` attributes.
/// Use `.to_string()` to get the wire string, or `"wire.name".parse()` to convert.
///
/// The `Unknown` variant with `#[strum(default)]` captures any unrecognized string,
/// ensuring forward compatibility with new Copilot CLI event types.
#[derive(Debug, Clone, PartialEq, Eq, EnumString, IntoStaticStr)]
pub enum SessionEventType {
    #[strum(serialize = "session.start")]
    SessionStart,
    #[strum(serialize = "session.shutdown")]
    SessionShutdown,
    #[strum(serialize = "session.compaction_start")]
    SessionCompactionStart,
    #[strum(serialize = "session.compaction_complete")]
    SessionCompactionComplete,
    #[strum(serialize = "session.plan_changed")]
    SessionPlanChanged,
    #[strum(serialize = "session.model_change")]
    SessionModelChange,
    #[strum(serialize = "session.info")]
    SessionInfo,
    #[strum(serialize = "session.context_changed")]
    SessionContextChanged,
    #[strum(serialize = "session.error")]
    SessionError,
    #[strum(serialize = "session.resume")]
    SessionResume,
    #[strum(serialize = "session.workspace_file_changed")]
    SessionWorkspaceFileChanged,
    #[strum(serialize = "user.message")]
    UserMessage,
    #[strum(serialize = "assistant.message")]
    AssistantMessage,
    #[strum(serialize = "assistant.turn_start")]
    AssistantTurnStart,
    #[strum(serialize = "assistant.turn_end")]
    AssistantTurnEnd,
    #[strum(serialize = "tool.execution_start")]
    ToolExecutionStart,
    #[strum(serialize = "tool.execution_complete")]
    ToolExecutionComplete,
    #[strum(serialize = "tool.user_requested")]
    ToolUserRequested,
    #[strum(serialize = "subagent.started")]
    SubagentStarted,
    #[strum(serialize = "subagent.completed")]
    SubagentCompleted,
    #[strum(serialize = "subagent.failed")]
    SubagentFailed,
    #[strum(serialize = "system.notification")]
    SystemNotification,
    #[strum(serialize = "skill.invoked")]
    SkillInvoked,
    #[strum(serialize = "abort")]
    Abort,
    // ── New event types ──
    #[strum(serialize = "session.truncation")]
    SessionTruncation,
    #[strum(serialize = "assistant.reasoning")]
    AssistantReasoning,
    #[strum(serialize = "system.message")]
    SystemMessage,
    #[strum(serialize = "session.warning")]
    SessionWarning,
    #[strum(serialize = "session.mode_changed")]
    SessionModeChanged,
    #[strum(serialize = "session.task_complete")]
    SessionTaskComplete,
    #[strum(serialize = "subagent.selected")]
    SubagentSelected,
    #[strum(serialize = "subagent.deselected")]
    SubagentDeselected,
    #[strum(serialize = "hook.start")]
    HookStart,
    #[strum(serialize = "hook.end")]
    HookEnd,
    #[strum(serialize = "session.handoff")]
    SessionHandoff,
    #[strum(serialize = "session.import_legacy")]
    SessionImportLegacy,
    /// Catch-all for unrecognized event types from newer Copilot CLI versions.
    /// The contained string is the original wire-format type name.
    #[strum(default)]
    Unknown(String),
}

/// All known event type wire strings, for runtime introspection and validation.
pub const KNOWN_EVENT_TYPES: &[&str] = &[
    "session.start",
    "session.shutdown",
    "session.compaction_start",
    "session.compaction_complete",
    "session.plan_changed",
    "session.model_change",
    "session.info",
    "session.context_changed",
    "session.error",
    "session.resume",
    "session.workspace_file_changed",
    "user.message",
    "assistant.message",
    "assistant.turn_start",
    "assistant.turn_end",
    "tool.execution_start",
    "tool.execution_complete",
    "tool.user_requested",
    "subagent.started",
    "subagent.completed",
    "subagent.failed",
    "system.notification",
    "skill.invoked",
    "abort",
    // New event types
    "session.truncation",
    "assistant.reasoning",
    "system.message",
    "session.warning",
    "session.mode_changed",
    "session.task_complete",
    "subagent.selected",
    "subagent.deselected",
    "hook.start",
    "hook.end",
    "session.handoff",
    "session.import_legacy",
];

impl fmt::Display for SessionEventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown(s) => write!(f, "{}", s),
            // For known variants, strum's IntoStaticStr gives us the wire string
            other => {
                let s: &'static str = other.into();
                write!(f, "{}", s)
            }
        }
    }
}

/// Parse a wire-format event type string (e.g. `"session.start"`) into a
/// [`SessionEventType`]. Unknown strings are captured as `Unknown(s)`.
///
/// This is infallible because `#[strum(default)]` on `Unknown` catches all
/// unrecognized input.
impl SessionEventType {
    pub fn parse_wire(s: &str) -> Self {
        s.parse()
            .expect("strum default variant makes this infallible")
    }
}

impl Serialize for SessionEventType {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for SessionEventType {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(SessionEventType::parse_wire(s.as_str()))
    }
}
