//! Types for the task database.

use serde::{Deserialize, Serialize};

/// Task status lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Claimed,
    InProgress,
    Done,
    Failed,
    Cancelled,
    Expired,
    DeadLetter,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Claimed => "claimed",
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Expired => "expired",
            Self::DeadLetter => "dead_letter",
        }
    }

    // Intentional inherent method: returns `Option<Self>` rather than the
    // `Result<Self, Err>` that `std::str::FromStr` mandates.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "claimed" => Some(Self::Claimed),
            "in_progress" => Some(Self::InProgress),
            "done" => Some(Self::Done),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            "expired" => Some(Self::Expired),
            "dead_letter" => Some(Self::DeadLetter),
            _ => None,
        }
    }

    /// Whether this status represents a terminal (completed) state.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Done | Self::Failed | Self::Cancelled | Self::Expired | Self::DeadLetter
        )
    }
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Job status lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    // Intentional inherent method: returns `Option<Self>` rather than the
    // `Result<Self, Err>` that `std::str::FromStr` mandates.
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(Self::Pending),
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A task row from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub job_id: Option<String>,
    pub task_type: String,
    pub preset_id: String,
    pub status: TaskStatus,
    pub priority: String,
    pub input_params: serde_json::Value,
    pub context_hash: Option<String>,
    pub attempt_count: i32,
    pub max_retries: i32,
    pub orchestrator_session_id: Option<String>,
    pub result_summary: Option<String>,
    pub result_parsed: Option<serde_json::Value>,
    pub schema_valid: Option<bool>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub claimed_at: Option<String>,
    pub started_at: Option<String>,
}

/// Parameters for creating a new task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub task_type: String,
    pub preset_id: String,
    pub priority: Option<String>,
    pub input_params: serde_json::Value,
    pub max_retries: Option<i32>,
}

/// A job (batch of tasks) row from the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub name: String,
    pub preset_id: Option<String>,
    pub status: JobStatus,
    pub task_count: i32,
    pub tasks_completed: i32,
    pub tasks_failed: i32,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub orchestrator_session_id: Option<String>,
}

/// Filter criteria for listing tasks.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFilter {
    pub status: Option<TaskStatus>,
    pub task_type: Option<String>,
    pub job_id: Option<String>,
    pub preset_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Aggregate task statistics.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStats {
    pub total: i64,
    pub pending: i64,
    pub in_progress: i64,
    pub done: i64,
    pub failed: i64,
    pub cancelled: i64,
}

/// Result of a completed/failed task, ingested from file-based IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResult {
    pub task_id: String,
    pub status: TaskStatus,
    pub result_summary: Option<String>,
    pub result_parsed: Option<serde_json::Value>,
    pub schema_valid: Option<bool>,
    pub error_message: Option<String>,
}
