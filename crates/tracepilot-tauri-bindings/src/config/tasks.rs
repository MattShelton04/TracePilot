//! Configuration for the AI Agent Task System (orchestrator + subagents).

use serde::{Deserialize, Serialize};

use super::defaults::{
    default_context_budget_tokens, default_heartbeat_stale_multiplier, default_max_concurrent_tasks,
    default_max_retries, default_orchestrator_model, default_poll_interval, default_subagent_model,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksConfig {
    /// Whether the tasks feature is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Model used for the orchestrator session (the polling root agent).
    #[serde(default = "default_orchestrator_model")]
    pub orchestrator_model: String,
    /// Default model for subagent task execution (overridable per-preset/task).
    #[serde(default = "default_subagent_model")]
    pub default_subagent_model: String,
    /// How often the orchestrator polls for new tasks (seconds).
    #[serde(default = "default_poll_interval")]
    pub poll_interval_seconds: u32,
    /// Maximum number of concurrent subagent tasks.
    #[serde(default = "default_max_concurrent_tasks")]
    pub max_concurrent_tasks: u32,
    /// Multiplier applied to poll interval to determine heartbeat staleness.
    /// If heartbeat is older than `poll_interval * this`, orchestrator is dead.
    #[serde(default = "default_heartbeat_stale_multiplier")]
    pub heartbeat_stale_multiplier: u32,
    /// Max consecutive orchestrator crash restarts before circuit-breaking.
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// Whether to auto-start the orchestrator when the app launches.
    #[serde(default)]
    pub auto_start_orchestrator: bool,
    /// Approximate token budget for context assembly per task.
    #[serde(default = "default_context_budget_tokens")]
    pub context_budget_tokens: u32,
}

impl Default for TasksConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            orchestrator_model: default_orchestrator_model(),
            default_subagent_model: default_subagent_model(),
            poll_interval_seconds: default_poll_interval(),
            max_concurrent_tasks: default_max_concurrent_tasks(),
            heartbeat_stale_multiplier: default_heartbeat_stale_multiplier(),
            max_retries: default_max_retries(),
            auto_start_orchestrator: false,
            context_budget_tokens: default_context_budget_tokens(),
        }
    }
}
