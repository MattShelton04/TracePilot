//! Cross-session agent usage types served to the Agents explorer.
//!
//! Token figures come from `subagent.completed.totalTokens`, which can include
//! descendants: they describe one run and are never summed across a
//! hierarchy. Credits come only from the `agentMetrics` ledger, so every
//! credit total carries the number of runs it covers.

use serde::{Deserialize, Serialize};

/// Percentiles over the runs that reported a value. `count` is the
/// denominator: runs without the metric (older CLIs) are excluded.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricDistribution {
    pub count: u64,
    pub min: Option<u64>,
    pub p25: Option<u64>,
    pub p50: Option<u64>,
    pub p75: Option<u64>,
    pub p90: Option<u64>,
    pub max: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLabelCount {
    pub label: String,
    pub runs: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBucketCount {
    pub value: u32,
    pub runs: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDayCount {
    pub date: String,
    pub runs: u64,
}

/// Aggregate usage for one agent name (case-insensitive).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageStats {
    /// Most recently seen spelling of the agent name.
    pub name: String,
    pub agent_type: Option<String>,
    /// Display name / description, only when every run in range reported the
    /// same value: per-call names and descriptions describe a run, not the agent.
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub runs: u64,
    pub sessions: u64,
    pub completed: u64,
    pub failed: u64,
    pub cancelled: u64,
    pub incomplete: u64,
    pub duration_ms: MetricDistribution,
    /// Includes descendants where the CLI reports it that way.
    pub total_tokens: MetricDistribution,
    pub tool_calls: MetricDistribution,
    /// Median duration over the equally long window before the range, for
    /// trend-based slowness. `None` without a bounded range or earlier runs.
    pub previous_median_duration_ms: Option<u64>,
    /// Runs covered by the credit ledger (1.0.83+) and their exclusive total.
    pub runs_with_credits: u64,
    pub own_nano_aiu: Option<u64>,
    pub first_used: Option<String>,
    pub last_used: Option<String>,
    pub top_models: Vec<AgentLabelCount>,
    /// Runs whose dispatched or actual model differed from the configured one.
    pub mismatch_runs: u64,
    /// Runs recording a configured model (the mismatch denominator).
    pub runs_with_configuration: u64,
    pub max_depth: u32,
    pub peak_siblings: u32,
    pub follow_ups: u64,
    pub multi_turn_runs: u64,
    pub daily_runs: Vec<AgentDayCount>,
}

/// Sessions whose main agent was a selected custom agent (`--agent`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSelectionStats {
    pub name: String,
    pub display_name: Option<String>,
    pub sessions: u64,
    pub last_selected: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageSummary {
    pub total_runs: u64,
    pub total_sessions: u64,
    pub failed_runs: u64,
    pub cancelled_runs: u64,
    pub incomplete_runs: u64,
    pub max_depth: u32,
    pub peak_parallelism: u32,
    pub runs_with_credits: u64,
    pub total_own_nano_aiu: u64,
    pub agents: Vec<AgentUsageStats>,
    pub main_agent_selections: Vec<AgentSelectionStats>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDayOutcomes {
    pub date: String,
    pub completed: u64,
    pub failed: u64,
    pub cancelled: u64,
    pub incomplete: u64,
}

/// Configured vs. dispatched vs. actual model for 1.0.83+ runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDispatchCount {
    pub configured_model: Option<String>,
    pub first_dispatched_model: Option<String>,
    pub actual_model: Option<String>,
    pub override_reason: Option<String>,
    pub runs: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentParentCount {
    /// `None` for the main agent.
    pub parent: Option<String>,
    pub runs: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFailureReason {
    /// Normalised error text (IDs and numbers masked).
    pub reason: String,
    pub example: String,
    pub runs: u64,
    pub last_seen: Option<String>,
}

/// One run, for the Recent runs list and deep links into the session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub session_id: String,
    pub session_summary: Option<String>,
    pub repository: Option<String>,
    pub run_key: String,
    pub tool_call_id: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub started_at: Option<String>,
    pub outcome: String,
    pub error_text: Option<String>,
    pub model: Option<String>,
    pub duration_ms: Option<u64>,
    pub total_tokens: Option<u64>,
    pub total_tool_calls: Option<u64>,
    pub own_nano_aiu: Option<u64>,
    pub depth: u32,
    pub parent_agent_name: Option<String>,
    pub turn_index: u64,
    pub event_index: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageDetail {
    pub stats: AgentUsageStats,
    pub outcomes_by_day: Vec<AgentDayOutcomes>,
    pub dispatch: Vec<AgentDispatchCount>,
    pub invoked_by: Vec<AgentParentCount>,
    pub depths: Vec<AgentBucketCount>,
    pub parallelism: Vec<AgentBucketCount>,
    pub failure_reasons: Vec<AgentFailureReason>,
    pub execution_modes: Vec<AgentLabelCount>,
    pub repositories: Vec<AgentLabelCount>,
    pub recent_runs: Vec<AgentRunRecord>,
}
