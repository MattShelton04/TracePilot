//! Job-scoped commands (a Job groups a batch of tasks).

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::with_task_db;
use crate::types::SharedTaskDb;
use tracepilot_orchestrator::task_db::types::Job;

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn task_list_jobs(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    limit: Option<i64>,
) -> CmdResult<Vec<Job>> {
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::list_jobs(db.conn(), limit)
            .map_err(BindingsError::Orchestrator)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip(state), err, fields(%job_id))]
pub async fn task_cancel_job(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    job_id: String,
) -> CmdResult<()> {
    crate::validators::validate_job_id(&job_id)?;
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::cancel_job(db.conn(), &job_id)
            .map_err(BindingsError::Orchestrator)
    })
    .await
}
