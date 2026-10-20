//! The GitHub pull requests a session is linked to.

use tracepilot_indexer::index_db::{IndexedPullRequest, IndexedPullRequestStatus};

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{PullRequestState, PullRequestStatus, SessionPullRequest};

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn get_session_pull_requests(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<SessionPullRequest>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let index_path = read_config(&state).index_db_path();

    crate::blocking_cmd!({
        // A session the indexer has not reached yet has no rows either way.
        if !index_path.exists() {
            return Ok(Vec::new());
        }
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let rows = db.get_session_pull_requests(&sid)?;
        Ok::<_, BindingsError>(rows.into_iter().map(session_pull_request).collect())
    })
}

fn session_pull_request(row: IndexedPullRequest) -> SessionPullRequest {
    SessionPullRequest {
        url: row.key.url(),
        host: row.key.host,
        owner: row.key.owner,
        repo: row.key.repo,
        number: row.key.number,
        roles: row.roles.iter().collect(),
        primary: row.primary,
        head_ref: row.head_ref,
        base_ref: row.base_ref,
        title: row.title,
        first_seen_at: row.first_seen_at,
        last_seen_at: row.last_seen_at,
        event_index: row.event_index.and_then(|index| u32::try_from(index).ok()),
        status: row.status.map(pull_request_status),
    }
}

fn pull_request_status(status: IndexedPullRequestStatus) -> PullRequestStatus {
    let state = status
        .state
        .as_deref()
        .and_then(|state| PullRequestState::from_stored(state, status.is_draft));
    PullRequestStatus {
        state,
        title: status.title,
        merged_at: status.merged_at,
        closed_at: status.closed_at,
        review_decision: status.review_decision,
        checks_state: status.checks_state,
        fetched_at: status.fetched_at,
        error: status.error,
    }
}
