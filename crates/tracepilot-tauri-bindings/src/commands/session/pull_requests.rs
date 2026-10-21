//! The GitHub pull requests a session is linked to, and the other sessions
//! linked to the same ones.

use std::sync::Arc;

use tracepilot_core::SessionId;
use tracepilot_indexer::index_db::{
    IndexedPullRequest, IndexedPullRequestSession, IndexedPullRequestStatus,
    IndexedRelatedPullRequestCount,
};

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::services::pull_request_status::{
    MAX_LIST_SESSIONS, PullRequestRefresher, RefreshContext,
};
use crate::types::{
    PullRequestRefreshResult, PullRequestSessionLink, PullRequestState, PullRequestStatus,
    RelatedPullRequestCount, SessionPullRequest,
};

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

fn refresh_context(state: &SharedConfig) -> RefreshContext {
    let config = read_config(state);
    RefreshContext {
        index_path: config.index_db_path(),
        enabled: config.ui.pull_request_lookup,
        now: chrono::Utc::now(),
    }
}

/// Ask GitHub, through the user's `gh`, for the state of the session's pull
/// requests and for pull requests on the branches it pushed, when due.
/// `force` refreshes all of them. Starts no `gh` when nothing is due.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn refresh_session_pull_requests(
    state: tauri::State<'_, SharedConfig>,
    refresher: tauri::State<'_, Arc<PullRequestRefresher>>,
    session_id: String,
    force: bool,
) -> CmdResult<PullRequestRefreshResult> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    refresher
        .inner()
        .refresh_session(refresh_context(&state), sid, force)
        .await
}

/// Refresh the due primary pull requests of the listed sessions: at most 50,
/// and at most one `gh` batch a minute.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn refresh_list_pull_requests(
    state: tauri::State<'_, SharedConfig>,
    refresher: tauri::State<'_, Arc<PullRequestRefresher>>,
    session_ids: Vec<String>,
) -> CmdResult<PullRequestRefreshResult> {
    let ids = session_ids
        .iter()
        .take(MAX_LIST_SESSIONS)
        .map(|id| crate::validators::validate_session_id(id))
        .collect::<CmdResult<Vec<_>>>()?;
    refresher
        .inner()
        .refresh_list(refresh_context(&state), ids)
        .await
}

/// For each of the session's pull requests that other sessions link too, how
/// many other sessions do. Pull requests no other session links are left out.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn get_session_pull_request_related_counts(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<RelatedPullRequestCount>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let index_path = read_config(&state).index_db_path();

    crate::blocking_cmd!({
        if !index_path.exists() {
            return Ok(Vec::new());
        }
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let rows = db.get_session_pull_request_related_counts(&sid)?;
        Ok::<_, BindingsError>(rows.into_iter().map(related_count).collect())
    })
}

/// Every session linked to the pull request (host, owner and repository
/// compared ignoring case), most recently updated first, at most 100. The
/// asking session is included when it links it.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn get_pull_request_sessions(
    state: tauri::State<'_, SharedConfig>,
    host: String,
    owner: String,
    repo: String,
    number: u32,
) -> CmdResult<Vec<PullRequestSessionLink>> {
    let key = crate::validators::validate_pull_request_key(&host, &owner, &repo, number)?;
    let index_path = read_config(&state).index_db_path();

    crate::blocking_cmd!({
        if !index_path.exists() {
            return Ok(Vec::new());
        }
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let rows = db.get_pull_request_sessions(&key)?;
        Ok::<_, BindingsError>(rows.into_iter().map(session_link).collect())
    })
}

fn related_count(row: IndexedRelatedPullRequestCount) -> RelatedPullRequestCount {
    RelatedPullRequestCount {
        host: row.key.host,
        owner: row.key.owner,
        repo: row.key.repo,
        number: row.key.number,
        other_session_count: row.other_session_count,
    }
}

fn session_link(row: IndexedPullRequestSession) -> PullRequestSessionLink {
    PullRequestSessionLink {
        session_id: SessionId::from_validated(row.session_id),
        summary: row.summary,
        repository: row.repository,
        source: row.source,
        updated_at: row.updated_at,
        roles: row.roles.iter().collect(),
    }
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
        found_by_branch: row.found_by_branch,
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
