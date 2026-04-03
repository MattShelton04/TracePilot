//! CRUD operations for the task database.

use crate::error::{OrchestratorError, Result};
use rusqlite::{params, Connection};

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
        params![id, task.task_type, task.preset_id, priority, params_json, max_retries],
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

    get_job(conn, &job_id)
}

/// Get a single task by ID.
pub fn get_task(conn: &Connection, id: &str) -> Result<Task> {
    conn.query_row("SELECT * FROM tasks WHERE id = ?1", params![id], |row| {
        Ok(row_to_task(row))
    })?
    .map_err(|e| OrchestratorError::Task(format!("Failed to parse task row: {e}")))
}

/// List tasks with optional filters.
pub fn list_tasks(conn: &Connection, filter: &TaskFilter) -> Result<Vec<Task>> {
    let mut sql = String::from("SELECT * FROM tasks WHERE 1=1");
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(status) = &filter.status {
        sql.push_str(&format!(" AND status = ?{}", param_values.len() + 1));
        param_values.push(Box::new(status.as_str().to_string()));
    }
    if let Some(task_type) = &filter.task_type {
        sql.push_str(&format!(" AND task_type = ?{}", param_values.len() + 1));
        param_values.push(Box::new(task_type.clone()));
    }
    if let Some(job_id) = &filter.job_id {
        sql.push_str(&format!(" AND job_id = ?{}", param_values.len() + 1));
        param_values.push(Box::new(job_id.clone()));
    }
    if let Some(preset_id) = &filter.preset_id {
        sql.push_str(&format!(" AND preset_id = ?{}", param_values.len() + 1));
        param_values.push(Box::new(preset_id.clone()));
    }

    sql.push_str(" ORDER BY created_at DESC");

    if let Some(limit) = filter.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
    }
    if let Some(offset) = filter.offset {
        sql.push_str(&format!(" OFFSET {offset}"));
    }

    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql)?;
    let tasks = stmt
        .query_map(params_refs.as_slice(), |row| Ok(row_to_task(row)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    tasks
        .into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| OrchestratorError::Task(format!("Failed to parse task rows: {e}")))
}

/// Update a task's status.
pub fn update_task_status(conn: &Connection, id: &str, status: TaskStatus) -> Result<()> {
    let completed_at = if status.is_terminal() {
        Some(chrono::Utc::now().to_rfc3339())
    } else {
        None
    };

    let rows = conn.execute(
        "UPDATE tasks SET status = ?1, completed_at = COALESCE(?2, completed_at) WHERE id = ?3",
        params![status.as_str(), completed_at, id],
    )?;

    if rows == 0 {
        return Err(OrchestratorError::NotFound(format!("Task not found: {id}")));
    }
    Ok(())
}

/// Store a task result (from file-based IPC).
pub fn store_task_result(conn: &Connection, result: &TaskResult) -> Result<()> {
    let result_parsed = result
        .result_parsed
        .as_ref()
        .map(|v| serde_json::to_string(v))
        .transpose()?;

    conn.execute(
        "UPDATE tasks SET
            status = ?1,
            result_summary = ?2,
            result_parsed = ?3,
            schema_valid = ?4,
            error_message = ?5,
            completed_at = COALESCE(completed_at, ?6)
         WHERE id = ?7",
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
            completed_at = NULL, error_message = NULL, result_summary = NULL,
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

/// Delete a task (must be in terminal state).
pub fn delete_task(conn: &Connection, id: &str) -> Result<()> {
    let rows = conn.execute(
        "DELETE FROM tasks WHERE id = ?1 AND status IN ('done', 'failed', 'cancelled', 'expired', 'dead_letter')",
        params![id],
    )?;

    if rows == 0 {
        return Err(OrchestratorError::Task(format!(
            "Task {id} not found or not in a deletable state"
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

/// Release stale in-progress tasks back to pending.
/// Tasks are considered stale if they've been in_progress for longer than `stale_minutes`.
pub fn release_stale_tasks(conn: &Connection, stale_minutes: i64) -> Result<u64> {
    let rows = conn.execute(
        "UPDATE tasks SET status = 'pending'
         WHERE status = 'in_progress'
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
    conn.query_row("SELECT * FROM jobs WHERE id = ?1", params![id], |row| {
        Ok(row_to_job(row))
    })?
    .map_err(|e| OrchestratorError::Task(format!("Failed to parse job row: {e}")))
}

/// List all jobs, newest first.
pub fn list_jobs(conn: &Connection, limit: Option<i64>) -> Result<Vec<Job>> {
    let sql = format!(
        "SELECT * FROM jobs ORDER BY created_at DESC{}",
        limit.map_or(String::new(), |l| format!(" LIMIT {l}"))
    );

    let mut stmt = conn.prepare(&sql)?;
    let jobs = stmt
        .query_map([], |row| Ok(row_to_job(row)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    jobs.into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| OrchestratorError::Task(format!("Failed to parse job rows: {e}")))
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
            params![
                job_status.as_str(),
                chrono::Utc::now().to_rfc3339(),
                job_id
            ],
        )?;
    }

    Ok(())
}

/// Parse a task row from SQLite.
fn row_to_task(row: &rusqlite::Row<'_>) -> std::result::Result<Task, String> {
    let status_str: String = row.get("status").map_err(|e| e.to_string())?;
    let status =
        TaskStatus::from_str(&status_str).ok_or_else(|| format!("Invalid status: {status_str}"))?;

    let params_str: String = row.get("input_params").map_err(|e| e.to_string())?;
    let input_params: serde_json::Value =
        serde_json::from_str(&params_str).map_err(|e| e.to_string())?;

    let result_parsed_str: Option<String> = row.get("result_parsed").map_err(|e| e.to_string())?;
    let result_parsed = result_parsed_str
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(|e| e.to_string())?;

    Ok(Task {
        id: row.get("id").map_err(|e| e.to_string())?,
        job_id: row.get("job_id").map_err(|e| e.to_string())?,
        task_type: row.get("task_type").map_err(|e| e.to_string())?,
        preset_id: row.get("preset_id").map_err(|e| e.to_string())?,
        status,
        priority: row.get("priority").map_err(|e| e.to_string())?,
        input_params,
        context_hash: row.get("context_hash").map_err(|e| e.to_string())?,
        attempt_count: row.get("attempt_count").map_err(|e| e.to_string())?,
        max_retries: row.get("max_retries").map_err(|e| e.to_string())?,
        orchestrator_session_id: row
            .get("orchestrator_session_id")
            .map_err(|e| e.to_string())?,
        result_summary: row.get("result_summary").map_err(|e| e.to_string())?,
        result_parsed,
        schema_valid: row.get("schema_valid").map_err(|e| e.to_string())?,
        error_message: row.get("error_message").map_err(|e| e.to_string())?,
        created_at: row.get("created_at").map_err(|e| e.to_string())?,
        updated_at: row.get("updated_at").map_err(|e| e.to_string())?,
        completed_at: row.get("completed_at").map_err(|e| e.to_string())?,
    })
}

/// Parse a job row from SQLite.
fn row_to_job(row: &rusqlite::Row<'_>) -> std::result::Result<Job, String> {
    let status_str: String = row.get("status").map_err(|e| e.to_string())?;
    let status =
        JobStatus::from_str(&status_str).ok_or_else(|| format!("Invalid status: {status_str}"))?;

    Ok(Job {
        id: row.get("id").map_err(|e| e.to_string())?,
        name: row.get("name").map_err(|e| e.to_string())?,
        preset_id: row.get("preset_id").map_err(|e| e.to_string())?,
        status,
        task_count: row.get("task_count").map_err(|e| e.to_string())?,
        tasks_completed: row.get("tasks_completed").map_err(|e| e.to_string())?,
        tasks_failed: row.get("tasks_failed").map_err(|e| e.to_string())?,
        created_at: row.get("created_at").map_err(|e| e.to_string())?,
        completed_at: row.get("completed_at").map_err(|e| e.to_string())?,
        orchestrator_session_id: row
            .get("orchestrator_session_id")
            .map_err(|e| e.to_string())?,
    })
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
            schema_valid: true,
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
}
