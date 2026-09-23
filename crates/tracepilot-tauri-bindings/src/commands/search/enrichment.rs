//! Scheduling the session-store enrichment pass.
//!
//! A third pass alongside session indexing (Phase 1) and search content
//! (Phase 2), with its own gate. Its failures are reported as an outcome and
//! logged; they never propagate into `reindex_sessions`, whose `Err(_)` arm
//! escalates to a full rebuild of the whole index. An optional external file
//! being locked must not cost the user a full reindex.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tracepilot_core::session_store::SourceAvailability;
use tracepilot_indexer::EnrichmentOutcome;

use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{EnrichmentRefreshResponse, RefreshFailure};

/// Refresh enrichment on demand: every eligible session, or only
/// `session_id` — the open, in-progress session the detail view keeps current.
///
/// Turning the feature off still runs the pass: that is what purges the rows
/// it owns, so disabling stops retention rather than merely hiding data.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn refresh_session_enrichment(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, Arc<IndexingSemaphores>>,
    app: tauri::AppHandle,
    session_id: Option<String>,
) -> CmdResult<EnrichmentRefreshResponse> {
    if let Some(id) = &session_id {
        crate::validators::validate_session_id(id)?;
    }
    let permit = gates
        .try_acquire_enrichment()
        .map_err(|_| BindingsError::AlreadyIndexing)?;

    let config = read_config(&state);
    let session_state_dir = config.session_state_dir();
    let index_path = config.index_db_path();
    let enabled = config.features.session_store_enrichment;
    let app_handle = app.clone();

    let outcome = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        tracepilot_indexer::refresh_session_store_enrichment(
            &session_state_dir,
            &index_path,
            enabled,
            session_id.as_deref(),
            |progress| {
                crate::helpers::emit_best_effort(
                    &app_handle,
                    crate::events::ENRICHMENT_PROGRESS,
                    serde_json::json!({
                        "current": progress.current,
                        "total": progress.total
                    }),
                );
            },
            || false,
        )
    })
    .await?;
    record_refresh_result(&outcome);
    let outcome = outcome?;

    publish_if_changed(&app, &outcome);

    Ok(EnrichmentRefreshResponse {
        availability: outcome.availability.as_str().to_string(),
        refreshed: outcome.refreshed,
        unchanged: outcome.unchanged,
        skipped: outcome.skipped,
        detail: outcome.detail,
    })
}

/// Minimum spacing between the automatic passes that follow a reindex.
///
/// Auto-refresh can reindex every few seconds, and a sweep re-reads the store
/// and re-parses the log of every session with recorded requests while
/// holding the sessions gate. Back to back, those passes would occupy the
/// gate most of the time and starve the very reindexes they follow. Explicit
/// refreshes and the frontend's periodic sweep are not throttled.
const AUTO_PASS_INTERVAL: Duration = Duration::from_secs(30);

static LAST_AUTO_PASS: Mutex<Option<Instant>> = Mutex::new(None);

/// The availability the last published event reported.
static LAST_PUBLISHED: Mutex<Option<SourceAvailability>> = Mutex::new(None);

/// The most recent refresh failure, until a refresh succeeds.
static LAST_REFRESH_ERROR: Mutex<Option<RefreshFailure>> = Mutex::new(None);

/// Remember whether the latest refresh failed.
///
/// A failure while *writing* the index leaves the source row exactly as the
/// last good sweep left it — "available", last success long ago — so without
/// this the only trace of a sweep that fails every time is the log.
fn record_refresh_result<T>(result: &tracepilot_indexer::Result<T>) {
    let mut last = LAST_REFRESH_ERROR.lock().unwrap_or_else(|e| e.into_inner());
    *last = result.as_ref().err().map(|error| RefreshFailure {
        at: chrono::Utc::now().to_rfc3339(),
        message: error.to_string(),
    });
}

/// The failure a status surface should report, if the latest refresh failed.
pub(crate) fn last_refresh_failure() -> Option<RefreshFailure> {
    LAST_REFRESH_ERROR
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// Tell the views to reload, but only when a sweep changed what they show.
///
/// Every listener re-queries on this event, and most sweeps find nothing new;
/// announcing those would reset the ledger and redraw every enrichment panel
/// on each pass for no visible difference.
fn publish_if_changed(app: &tauri::AppHandle, outcome: &EnrichmentOutcome) {
    let availability_changed = {
        let mut last = LAST_PUBLISHED.lock().unwrap_or_else(|e| e.into_inner());
        last.replace(outcome.availability) != Some(outcome.availability)
    };
    if outcome.refreshed == 0 && !availability_changed {
        return;
    }
    crate::helpers::emit_best_effort(
        app,
        crate::events::ENRICHMENT_FINISHED,
        serde_json::json!({
            "availability": outcome.availability.as_str(),
            "refreshed": outcome.refreshed,
        }),
    );
}

fn auto_pass_due(last: Option<Instant>, now: Instant) -> bool {
    last.is_none_or(|at| now.saturating_duration_since(at) >= AUTO_PASS_INTERVAL)
}

/// Whether the automatic pass is due, claiming the slot if it is.
fn claim_auto_pass(now: Instant) -> bool {
    let mut last = LAST_AUTO_PASS.lock().unwrap_or_else(|e| e.into_inner());
    if !auto_pass_due(*last, now) {
        return false;
    }
    *last = Some(now);
    true
}

/// Start an enrichment sweep in the background, ignoring a busy gate.
///
/// Called after a successful session reindex, at most once per
/// [`AUTO_PASS_INTERVAL`]. A no-op when the gate is taken or the interval has
/// not elapsed is the right behaviour: the sweep is periodic, and the next one
/// will pick up whatever this one missed.
pub(crate) fn spawn_enrichment_pass(
    gates: Arc<IndexingSemaphores>,
    session_state_dir: std::path::PathBuf,
    index_path: std::path::PathBuf,
    enabled: bool,
    app: tauri::AppHandle,
) {
    let Ok(permit) = gates.try_acquire_enrichment() else {
        return;
    };
    if !claim_auto_pass(Instant::now()) {
        return;
    }
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let start = std::time::Instant::now();
        let result = tracepilot_indexer::refresh_session_store_enrichment(
            &session_state_dir,
            &index_path,
            enabled,
            None,
            |_| {},
            || false,
        );
        record_refresh_result(&result);
        match result {
            Ok(outcome) => {
                // An absent store is the expected state on a machine whose
                // CLI predates it, so it is logged at debug and never
                // surfaced as a warning on every sweep.
                tracing::debug!(
                    availability = outcome.availability.as_str(),
                    refreshed = outcome.refreshed,
                    skipped = outcome.skipped,
                    elapsed_ms = start.elapsed().as_millis(),
                    "Session-store enrichment sweep"
                );
                publish_if_changed(&app, &outcome);
            }
            Err(error) => {
                tracing::warn!(error = %error, "Session-store enrichment sweep failed");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_passes_are_spaced_by_the_interval() {
        let start = Instant::now();
        assert!(auto_pass_due(None, start));
        assert!(!auto_pass_due(Some(start), start + Duration::from_secs(3)));
        assert!(auto_pass_due(Some(start), start + AUTO_PASS_INTERVAL));
    }
}
