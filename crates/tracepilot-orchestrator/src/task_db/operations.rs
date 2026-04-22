//! CRUD operations for the task database.

use std::fmt::Write as _;

use crate::error::{OrchestratorError, Result};
use rusqlite::{Connection, params};
use serde::de::DeserializeOwned;

use super::types::{Job, JobStatus, NewTask, Task, TaskFilter, TaskResult, TaskStats, TaskStatus};

// ─── Task CRUD ────────────────────────────────────────────────────

/// Create a single task. Returns the created task.
pub fn create_task(conn: &Connection, task: &NewTask) -> Result<Task> {
    let id = uuid::Uuid::new_v4().to_string();
    let priority = task.priority.as_deref().unwrap_or("normal");
    let max_retries = task.max_retries.unwrap_or(3);
    let params_json = serde_json::to_string(&task.input_params)?;

    conn.execute(
        "INSERT INTO tasks (id, task_type, preset_id, priority, input_params, max_retries)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            task.task_type,
            task.preset_id,
            priority,
            params_json,
            max_retries
        ],
    )?;

    get_task(conn, &id)
}

/// Create a batch of tasks grouped under a new job. Returns the job.
pub fn create_task_batch(
    conn: &Connection,
    tasks: &[NewTask],
    job_name: &str,
    preset_id: Option<&str>,
) -> Result<Job> {
    let job_id = uuid::Uuid::new_v4().to_string();

    // Wrap in a transaction so partial failures don't leave inconsistent state
    conn.execute_batch("BEGIN IMMEDIATE")?;

    let result = (|| -> Result<()> {
        conn.execute(
            "INSERT INTO jobs (id, name, preset_id, task_count) VALUES (?1, ?2, ?3, ?4)",
            params![job_id, job_name, preset_id, tasks.len() as i32],
        )?;

        for task in tasks {
            let task_id = uuid::Uuid::new_v4().to_string();
            let priority = task.priority.as_deref().unwrap_or("normal");
            let max_retries = task.max_retries.unwrap_or(3);
            let params_json = serde_json::to_string(&task.input_params)?;

            conn.execute(
                "INSERT INTO tasks (id, job_id, task_type, preset_id, priority, input_params, max_retries)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    task_id,
                    job_id,
                    task.task_type,
                    task.preset_id,
                    priority,
                    params_json,
                    max_retries
                ],
            )?;
        }
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
        }
        Err(e) => {
            if let Err(rb_err) = conn.execute_batch("ROLLBACK") {
                tracing::error!(error = %rb_err, "Failed to rollback create_task_batch transaction");
            }
            return Err(e);
        }
    }

    get_job(conn, &job_id)
}

/// Get a single task by ID.
pub fn get_task(conn: &Connection, id: &str) -> Result<Task> {
    let mut stmt = conn.prepare("SELECT * FROM tasks WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    let Some(row) = rows.next()? else {
        return Err(OrchestratorError::NotFound(format!("Task not found: {id}")));
    };

    row_to_task(row)
}

/// List tasks with optional filters.
pub fn list_tasks(conn: &Connection, filter: &TaskFilter) -> Result<Vec<Task>> {
    let mut sql = String::from("SELECT * FROM tasks WHERE 1=1");
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(status) = &filter.status {
        write!(sql, " AND status = ?{}", param_values.len() + 1).expect("infallible");
        param_values.push(Box::new(status.as_str().to_string()));
    }
    if let Some(task_type) = &filter.task_type {
        write!(sql, " AND task_type = ?{}", param_values.len() + 1).expect("infallible");
        param_values.push(Box::new(task_type.clone()));
    }
    if let Some(job_id) = &filter.job_id {
        write!(sql, " AND job_id = ?{}", param_values.len() + 1).expect("infallible");
        param_values.push(Box::new(job_id.clone()));
    }
    if let Some(preset_id) = &filter.preset_id {
        write!(sql, " AND preset_id = ?{}", param_values.len() + 1).expect("infallible");
        param_values.push(Box::new(preset_id.clone()));
    }

    sql.push_str(" ORDER BY created_at DESC");

    if let Some(limit) = filter.limit {
        write!(sql, " LIMIT ?{}", param_values.len() + 1).expect("infallible");
        param_values.push(Box::new(limit));
    }
    if let Some(offset) = filter.offset {
        write!(sql, " OFFSET ?{}", param_values.len() + 1).expect("infallible");
        param_values.push(Box::new(offset));
    }

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(
        param_values.iter().map(|p| p.as_ref()),
    ))?;
    let mut tasks = Vec::new();

    while let Some(row) = rows.next()? {
        tasks.push(row_to_task(row)?);
    }

    Ok(tasks)
}

/// Update a task's status.
///
/// Guards against overwriting terminal states (done, failed, cancelled, expired,
/// dead_letter). Callers should use `cancel_task` / `retry_task` for those transitions.
pub fn update_task_status(conn: &Connection, id: &str, status: TaskStatus) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    let completed_at = if status.is_terminal() {
        Some(now.clone())
    } else {
        None
    };
    let claimed_at = if status == TaskStatus::Claimed {
        Some(now.clone())
    } else {
        None
    };
    let started_at = if status == TaskStatus::InProgress {
        Some(now)
    } else {
        None
    };

    let rows = conn.execute(
        "UPDATE tasks SET status = ?1,
            completed_at = COALESCE(?2, completed_at),
            claimed_at = COALESCE(?3, claimed_at),
            started_at = COALESCE(?4, started_at)
         WHERE id = ?5
           AND status NOT IN ('done', 'failed', 'cancelled', 'expired', 'dead_letter')",
        params![status.as_str(), completed_at, claimed_at, started_at, id],
    )?;

    if rows == 0 {
        // Check if the task exists but is in a terminal state.
        let exists: bool = conn
            .query_row("SELECT 1 FROM tasks WHERE id = ?1", params![id], |_| {
                Ok(true)
            })
            .unwrap_or(false);
        if exists {
            return Err(OrchestratorError::Task(format!(
                "Task {id} is in a terminal state and cannot be updated"
            )));
        }
        return Err(OrchestratorError::NotFound(format!("Task not found: {id}")));
    }

    // Propagate status change to job counters/lifecycle.
    update_job_counters(conn, id)?;

    Ok(())
}

/// Set the orchestrator session ID on in-progress tasks that don't have one yet.
pub fn set_orchestrator_session_id(conn: &Connection, session_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET orchestrator_session_id = ?1
         WHERE status IN ('in_progress', 'claimed')
           AND (orchestrator_session_id IS NULL OR orchestrator_session_id = '')",
        params![session_id],
    )?;
    Ok(())
}

/// Store a task result (from file-based IPC).
pub fn store_task_result(conn: &Connection, result: &TaskResult) -> Result<()> {
    let result_parsed = result
        .result_parsed
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;

    let rows = conn.execute(
        "UPDATE tasks SET
            status = ?1,
            result_summary = ?2,
            result_parsed = ?3,
            schema_valid = ?4,
            error_message = ?5,
            completed_at = COALESCE(completed_at, ?6)
         WHERE id = ?7
           AND status NOT IN ('pending', 'cancelled', 'expired', 'dead_letter')",
        params![
            result.status.as_str(),
            result.result_summary,
            result_parsed,
            result.schema_valid,
            result.error_message,
            chrono::Utc::now().to_rfc3339(),
            result.task_id,
        ],
    )?;

    if rows == 0 {
        return Err(OrchestratorError::NotFound(format!(
            "Task not found: {}",
            result.task_id
        )));
    }

    // Update parent job counters if applicable.
    update_job_counters(conn, &result.task_id)?;

    Ok(())
}

/// Cancel a single task. Only non-terminal tasks can be cancelled.
pub fn cancel_task(conn: &Connection, id: &str) -> Result<()> {
    let rows = conn.execute(
        "UPDATE tasks SET status = 'cancelled', completed_at = ?1
         WHERE id = ?2 AND status NOT IN ('done', 'failed', 'cancelled', 'expired', 'dead_letter')",
        params![chrono::Utc::now().to_rfc3339(), id],
    )?;

    if rows == 0 {
        return Err(OrchestratorError::Task(format!(
            "Task {id} not found or already in terminal state"
        )));
    }

    update_job_counters(conn, id)?;
    Ok(())
}

/// Cancel all non-terminal tasks in a job.
pub fn cancel_job(conn: &Connection, job_id: &str) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE tasks SET status = 'cancelled', completed_at = ?1
         WHERE job_id = ?2 AND status NOT IN ('done', 'failed', 'cancelled', 'expired', 'dead_letter')",
        params![now, job_id],
    )?;

    conn.execute(
        "UPDATE jobs SET status = 'cancelled', completed_at = ?1 WHERE id = ?2",
        params![now, job_id],
    )?;

    Ok(())
}

/// Retry a failed task by resetting it to pending and incrementing attempt_count.
pub fn retry_task(conn: &Connection, id: &str) -> Result<()> {
    let rows = conn.execute(
        "UPDATE tasks SET status = 'pending', attempt_count = attempt_count + 1,
            completed_at = NULL, claimed_at = NULL, started_at = NULL,
            error_message = NULL, result_summary = NULL,
            result_parsed = NULL, schema_valid = NULL
         WHERE id = ?1 AND status IN ('failed', 'dead_letter')",
        params![id],
    )?;

    if rows == 0 {
        return Err(OrchestratorError::Task(format!(
            "Task {id} not found or not in a retryable state"
        )));
    }
    Ok(())
}

/// Delete a task (must be in a terminal or pending state).
pub fn delete_task(conn: &Connection, id: &str) -> Result<()> {
    let rows = conn.execute(
        "DELETE FROM tasks WHERE id = ?1 AND status IN ('pending', 'done', 'failed', 'cancelled', 'expired', 'dead_letter')",
        params![id],
    )?;

    if rows == 0 {
        return Err(OrchestratorError::Task(format!(
            "Task {id} not found or not in a deletable state (cancel in-progress tasks first)"
        )));
    }
    Ok(())
}

/// Get aggregate task statistics.
pub fn get_task_stats(conn: &Connection) -> Result<TaskStats> {
    let stats = conn.query_row(
        "SELECT
            COUNT(*) as total,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
            COALESCE(SUM(CASE WHEN status IN ('claimed', 'in_progress') THEN 1 ELSE 0 END), 0) as in_progress,
            COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) as done,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
            COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled
         FROM tasks",
        [],
        |row| {
            Ok(TaskStats {
                total: row.get(0)?,
                pending: row.get(1)?,
                in_progress: row.get(2)?,
                done: row.get(3)?,
                failed: row.get(4)?,
                cancelled: row.get(5)?,
            })
        },
    )?;

    Ok(stats)
}

/// Get pending tasks suitable for inclusion in the orchestrator manifest.
pub fn get_pending_tasks_for_manifest(conn: &Connection) -> Result<Vec<Task>> {
    let filter = TaskFilter {
        status: Some(TaskStatus::Pending),
        limit: Some(100),
        ..Default::default()
    };
    list_tasks(conn, &filter)
}

/// Release stale in-progress or claimed tasks back to pending.
/// Tasks are considered stale if they've been in the given state for longer than `stale_minutes`.
pub fn release_stale_tasks(conn: &Connection, stale_minutes: i64) -> Result<u64> {
    if stale_minutes <= 0 {
        return Err(OrchestratorError::Task(
            "stale_minutes must be positive".into(),
        ));
    }
    let rows = conn.execute(
        "UPDATE tasks SET status = 'pending'
         WHERE status IN ('in_progress', 'claimed')
         AND datetime(updated_at) < datetime('now', ?1)",
        params![format!("-{stale_minutes} minutes")],
    )?;
    Ok(rows as u64)
}

/// Move old failed tasks to dead_letter after exceeding max_retries.
pub fn expire_exhausted_tasks(conn: &Connection) -> Result<u64> {
    let rows = conn.execute(
        "UPDATE tasks SET status = 'dead_letter'
         WHERE status = 'failed' AND attempt_count >= max_retries",
        [],
    )?;
    Ok(rows as u64)
}

/// Clean up old completed tasks older than `retention_days`.
pub fn cleanup_old_completed(conn: &Connection, retention_days: i64) -> Result<u64> {
    let rows = conn.execute(
        "DELETE FROM tasks
         WHERE status IN ('done', 'cancelled', 'expired', 'dead_letter')
         AND datetime(completed_at) < datetime('now', ?1)",
        params![format!("-{retention_days} days")],
    )?;
    Ok(rows as u64)
}

/// Set the context_hash for a task (used for deduplication).
pub fn set_context_hash(conn: &Connection, id: &str, hash: &str) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET context_hash = ?1 WHERE id = ?2",
        params![hash, id],
    )?;
    Ok(())
}

// ─── Job CRUD ────────────────────────────────────────────────────

/// Get a single job by ID.
pub fn get_job(conn: &Connection, id: &str) -> Result<Job> {
    let mut stmt = conn.prepare("SELECT * FROM jobs WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    let Some(row) = rows.next()? else {
        return Err(OrchestratorError::NotFound(format!("Job not found: {id}")));
    };

    row_to_job(row)
}

/// List all jobs, newest first.
pub fn list_jobs(conn: &Connection, limit: Option<i64>) -> Result<Vec<Job>> {
    let (sql, param_values): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match limit {
        Some(l) => (
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?1".to_string(),
            vec![Box::new(l)],
        ),
        None => (
            "SELECT * FROM jobs ORDER BY created_at DESC".to_string(),
            vec![],
        ),
    };

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(
        param_values.iter().map(|p| p.as_ref()),
    ))?;
    let mut jobs = Vec::new();

    while let Some(row) = rows.next()? {
        jobs.push(row_to_job(row)?);
    }

    Ok(jobs)
}

// ─── Internal helpers ────────────────────────────────────────────

/// Update job counters after a task status change.
fn update_job_counters(conn: &Connection, task_id: &str) -> Result<()> {
    let job_id: Option<String> = conn
        .query_row(
            "SELECT job_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .ok();

    let Some(job_id) = job_id else {
        return Ok(());
    };

    conn.execute(
        "UPDATE jobs SET
            tasks_completed = (SELECT COUNT(*) FROM tasks WHERE job_id = ?1 AND status = 'done'),
            tasks_failed = (SELECT COUNT(*) FROM tasks WHERE job_id = ?1 AND status IN ('failed', 'dead_letter'))
         WHERE id = ?1",
        params![job_id],
    )?;

    // Transition job to Running if any task is active and the job is still Pending.
    let has_active: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM tasks
         WHERE job_id = ?1 AND status IN ('in_progress', 'claimed')",
        params![job_id],
        |row| row.get(0),
    )?;

    if has_active {
        conn.execute(
            "UPDATE jobs SET status = 'running' WHERE id = ?1 AND status = 'pending'",
            params![job_id],
        )?;
    }

    // Check if all tasks are terminal — if so, mark job complete.
    let all_terminal: bool = conn.query_row(
        "SELECT COUNT(*) = 0 FROM tasks
         WHERE job_id = ?1 AND status NOT IN ('done', 'failed', 'cancelled', 'expired', 'dead_letter')",
        params![job_id],
        |row| row.get(0),
    )?;

    if all_terminal {
        let has_failures: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM tasks
             WHERE job_id = ?1 AND status IN ('failed', 'dead_letter')",
            params![job_id],
            |row| row.get(0),
        )?;

        let job_status = if has_failures {
            JobStatus::Failed
        } else {
            JobStatus::Completed
        };

        conn.execute(
            "UPDATE jobs SET status = ?1, completed_at = ?2 WHERE id = ?3",
            params![job_status.as_str(), chrono::Utc::now().to_rfc3339(), job_id],
        )?;
    }

    Ok(())
}

/// Parse a task row from SQLite.
fn row_to_task(row: &rusqlite::Row<'_>) -> Result<Task> {
    let status_str: String = row.get("status")?;
    let status = TaskStatus::from_str(&status_str)
        .ok_or_else(|| OrchestratorError::Task(format!("Invalid status: {status_str}")))?;

    let params_str: String = row.get("input_params")?;
    let input_params: serde_json::Value = parse_json_field("input_params", &params_str)?;

    let result_parsed_str: Option<String> = row.get("result_parsed")?;
    let result_parsed = match result_parsed_str {
        Some(raw) => Some(parse_json_field("result_parsed", &raw)?),
        None => None,
    };

    Ok(Task {
        id: row.get("id")?,
        job_id: row.get("job_id")?,
        task_type: row.get("task_type")?,
        preset_id: row.get("preset_id")?,
        status,
        priority: row.get("priority")?,
        input_params,
        context_hash: row.get("context_hash")?,
        attempt_count: row.get("attempt_count")?,
        max_retries: row.get("max_retries")?,
        orchestrator_session_id: row.get("orchestrator_session_id")?,
        result_summary: row.get("result_summary")?,
        result_parsed,
        schema_valid: row.get("schema_valid")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
        claimed_at: row.get("claimed_at")?,
        started_at: row.get("started_at")?,
    })
}

/// Parse a job row from SQLite.
fn row_to_job(row: &rusqlite::Row<'_>) -> Result<Job> {
    let status_str: String = row.get("status")?;
    let status = JobStatus::from_str(&status_str)
        .ok_or_else(|| OrchestratorError::Task(format!("Invalid status: {status_str}")))?;

    Ok(Job {
        id: row.get("id")?,
        name: row.get("name")?,
        preset_id: row.get("preset_id")?,
        status,
        task_count: row.get("task_count")?,
        tasks_completed: row.get("tasks_completed")?,
        tasks_failed: row.get("tasks_failed")?,
        created_at: row.get("created_at")?,
        completed_at: row.get("completed_at")?,
        orchestrator_session_id: row.get("orchestrator_session_id")?,
    })
}

fn parse_json_field<T: DeserializeOwned>(field: &str, raw: &str) -> Result<T> {
    serde_json::from_str(raw)
        .map_err(|e| OrchestratorError::task_ctx(format!("Invalid JSON in {field}"), e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_db::TaskDb;
    use tempfile::TempDir;

    fn setup_db() -> (TempDir, TaskDb) {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test_tasks.db");
        let db = TaskDb::open_or_create(&db_path).unwrap();
        (dir, db)
    }

    #[test]
    fn test_create_and_get_task() {
        let (_dir, db) = setup_db();
        let new_task = NewTask {
            task_type: "session_summary".into(),
            preset_id: "builtin-session-summary".into(),
            priority: None,
            input_params: serde_json::json!({"session_id": "test-123"}),
            max_retries: None,
        };

        let task = create_task(&db.conn, &new_task).unwrap();
        assert_eq!(task.task_type, "session_summary");
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.attempt_count, 0);

        let fetched = get_task(&db.conn, &task.id).unwrap();
        assert_eq!(fetched.id, task.id);
    }

    #[test]
    fn test_create_batch_and_job() {
        let (_dir, db) = setup_db();
        let tasks = vec![
            NewTask {
                task_type: "session_summary".into(),
                preset_id: "p1".into(),
                priority: None,
                input_params: serde_json::json!({}),
                max_retries: None,
            },
            NewTask {
                task_type: "session_summary".into(),
                preset_id: "p1".into(),
                priority: Some("high".into()),
                input_params: serde_json::json!({}),
                max_retries: Some(5),
            },
        ];

        let job = create_task_batch(&db.conn, &tasks, "Test Batch", Some("p1")).unwrap();
        assert_eq!(job.task_count, 2);
        assert_eq!(job.status, JobStatus::Pending);

        let job_tasks = list_tasks(
            &db.conn,
            &TaskFilter {
                job_id: Some(job.id.clone()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(job_tasks.len(), 2);
    }

    #[test]
    fn test_task_lifecycle() {
        let (_dir, db) = setup_db();
        let new_task = NewTask {
            task_type: "test".into(),
            preset_id: "p1".into(),
            priority: None,
            input_params: serde_json::json!({}),
            max_retries: None,
        };

        let task = create_task(&db.conn, &new_task).unwrap();
        assert_eq!(task.status, TaskStatus::Pending);

        update_task_status(&db.conn, &task.id, TaskStatus::InProgress).unwrap();
        let task = get_task(&db.conn, &task.id).unwrap();
        assert_eq!(task.status, TaskStatus::InProgress);

        let result = TaskResult {
            task_id: task.id.clone(),
            status: TaskStatus::Done,
            result_summary: Some("Completed successfully".into()),
            result_parsed: Some(serde_json::json!({"score": 95})),
            schema_valid: Some(true),
            error_message: None,
        };
        store_task_result(&db.conn, &result).unwrap();

        let task = get_task(&db.conn, &task.id).unwrap();
        assert_eq!(task.status, TaskStatus::Done);
        assert!(task.completed_at.is_some());
        assert_eq!(task.schema_valid, Some(true));
    }

    #[test]
    fn test_cancel_and_retry() {
        let (_dir, db) = setup_db();
        let new_task = NewTask {
            task_type: "test".into(),
            preset_id: "p1".into(),
            priority: None,
            input_params: serde_json::json!({}),
            max_retries: None,
        };

        let task = create_task(&db.conn, &new_task).unwrap();
        cancel_task(&db.conn, &task.id).unwrap();

        let task = get_task(&db.conn, &task.id).unwrap();
        assert_eq!(task.status, TaskStatus::Cancelled);

        // Can't retry a cancelled task
        assert!(retry_task(&db.conn, &task.id).is_err());

        // Create another task that fails
        let task2 = create_task(&db.conn, &new_task).unwrap();
        update_task_status(&db.conn, &task2.id, TaskStatus::Failed).unwrap();
        retry_task(&db.conn, &task2.id).unwrap();

        let task2 = get_task(&db.conn, &task2.id).unwrap();
        assert_eq!(task2.status, TaskStatus::Pending);
        assert_eq!(task2.attempt_count, 1);
    }

    #[test]
    fn test_task_stats() {
        let (_dir, db) = setup_db();
        for _ in 0..3 {
            create_task(
                &db.conn,
                &NewTask {
                    task_type: "test".into(),
                    preset_id: "p1".into(),
                    priority: None,
                    input_params: serde_json::json!({}),
                    max_retries: None,
                },
            )
            .unwrap();
        }

        let stats = get_task_stats(&db.conn).unwrap();
        assert_eq!(stats.total, 3);
        assert_eq!(stats.pending, 3);
    }

    #[test]
    fn get_task_not_found_returns_not_found_error() {
        let (_dir, db) = setup_db();

        let err = get_task(&db.conn, "missing").unwrap_err();
        assert!(matches!(err, OrchestratorError::NotFound(msg) if msg.contains("missing")));
    }

    #[test]
    fn invalid_json_surfaces_structured_error() {
        let (_dir, db) = setup_db();
        let new_task = NewTask {
            task_type: "test".into(),
            preset_id: "p1".into(),
            priority: None,
            input_params: serde_json::json!({ "valid": true }),
            max_retries: None,
        };

        let task = create_task(&db.conn, &new_task).unwrap();
        db.conn
            .execute(
                "UPDATE tasks SET input_params = 'not-json' WHERE id = ?1",
                params![task.id],
            )
            .unwrap();

        let err = get_task(&db.conn, &task.id).unwrap_err();
        assert!(matches!(err, OrchestratorError::Task(msg) if msg.contains("input_params")));
    }
}
