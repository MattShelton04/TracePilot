//! Data model for extracted agent runs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Final state of one agent invocation as reconstructed from the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentRunOutcome {
    /// Finished successfully (an idle multi-turn worker counts as completed).
    Completed,
    Failed,
    Cancelled,
    /// No terminal state was recorded: still running, or the session ended
    /// (crash, truncation) before the agent reported back.
    Incomplete,
}

impl AgentRunOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Incomplete => "incomplete",
        }
    }
}

/// Where a run's identity came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentRunSource {
    /// `subagent.*` lifecycle events (all CLI versions that emit them).
    Lifecycle,
    /// A `task` tool call without lifecycle events; the agent name comes
    /// from its `agent_type` argument.
    TaskArguments,
}

impl AgentRunSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lifecycle => "events",
            Self::TaskArguments => "task_args",
        }
    }
}

/// One agent invocation within a session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRun {
    /// Stable key within the session: the launching tool-call ID, or the
    /// runtime instance ID when no tool call was recorded.
    pub run_key: String,
    pub tool_call_id: Option<String>,
    /// Runtime agent instance ID (envelope `agentId`, 1.0.20+).
    pub agent_id: Option<String>,
    /// Run key of the agent that launched this one; `None` for the main agent.
    pub parent_run_key: Option<String>,
    /// Name of the launching agent; `None` for the main agent.
    pub parent_agent_name: Option<String>,
    /// Nesting depth: 0 when launched by the main agent.
    pub depth: u32,
    pub agent_name: String,
    /// `agentType` (1.0.83+) or the `task` tool's `agent_type` argument.
    pub agent_type: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    /// `sync` or `background` (1.0.83+).
    pub execution_mode: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub outcome: AgentRunOutcome,
    pub error_text: Option<String>,
    /// Model requested in the launching tool call's arguments.
    pub requested_model: Option<String>,
    /// Model the run actually used, as reconstructed.
    pub model: Option<String>,
    /// `subagent.configured` model, effort, context tier and multi-turn flag.
    pub configured_model: Option<String>,
    pub configured_effort: Option<String>,
    pub context_tier: Option<String>,
    pub multi_turn: Option<bool>,
    pub first_dispatched_model: Option<String>,
    pub explicit_model_override: Option<String>,
    pub model_override_reason: Option<String>,
    pub configured_model_preference: Option<String>,
    pub configured_matches_actual: Option<bool>,
    pub total_tool_calls: Option<u64>,
    /// As reported by the CLI; can include descendants.
    pub total_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
    /// Exclusive credits from the shutdown `agentMetrics` ledger (1.0.83+).
    pub own_nano_aiu: Option<u64>,
    /// Successful `write_agent` follow-up messages sent to this run.
    pub follow_up_count: u32,
    /// `write_agent` calls this run made (a broadcast counts once).
    #[serde(default)]
    pub messages_sent: u32,
    /// Messages delivered to this run after its launch prompt (1.0.78+).
    #[serde(default)]
    pub messages_received: u32,
    /// Deliveries to or from agents outside this run's own line (siblings,
    /// cousins): neither its ancestors nor its descendants.
    #[serde(default)]
    pub peer_messages: u32,
    /// Messages delivered while this run was busy, so they waited.
    #[serde(default)]
    pub queued_messages: u32,
    /// Most siblings (same parent, this run included) running at once while
    /// this run was active.
    pub peak_siblings: u32,
    /// Launching turn and event, for deep links into the conversation.
    pub turn_index: usize,
    pub event_index: Option<usize>,
    pub source: AgentRunSource,
}

/// A main-session custom agent selection (`subagent.selected` / `deselected`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSelection {
    pub event_index: usize,
    /// `None` for a deselection.
    pub agent_name: Option<String>,
    pub display_name: Option<String>,
    pub selected: bool,
    pub timestamp: Option<DateTime<Utc>>,
}

/// Everything extracted from one session.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunExtraction {
    pub runs: Vec<AgentRun>,
    pub selections: Vec<AgentSelection>,
}
