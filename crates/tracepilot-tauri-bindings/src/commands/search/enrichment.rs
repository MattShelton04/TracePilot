//! Scheduling the session-store enrichment pass.
//!
//! A third pass alongside session indexing (Phase 1) and search content
//! (Phase 2), with its own gate. Its failures are reported as an outcome and
//! logged; they never propagate into `reindex_sessions`, whose `Err(_)` arm
//! escalates to a full rebuild of the whole index. An optional external file
//! being locked must not cost the user a full reindex.

use std::sync::Arc;

use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::EnrichmentRefreshResponse;

/// Refresh enrichment for every eligible session, on demand.
///
/// Turning the feature off still runs the pass: that is what purges the rows
/// it owns, so disabling stops retention rather than merely hiding data.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn refresh_session_enrichment(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, Arc<IndexingSemaphores>>,
    app: tauri::AppHandle,
) -> CmdResult<EnrichmentRefreshResponse> {
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
    .await??;

    crate::helpers::emit_best_effort(
        &app,
        crate::events::ENRICHMENT_FINISHED,
        serde_json::json!({
            "availability": outcome.availability.as_str(),
            "refreshed": outcome.refreshed,
        }),
    );

    Ok(EnrichmentRefreshResponse {
        availability: outcome.availability.as_str().to_string(),
        refreshed: outcome.refreshed,
        unchanged: outcome.unchanged,
        skipped: outcome.skipped,
        detail: outcome.detail,
    })
}

/// Start an enrichment sweep in the background, ignoring a busy gate.
///
/// Called after a successful session reindex. A no-op when the gate is taken
/// is the right behaviour: the sweep is periodic, and the next one will pick
/// up whatever this one missed.
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
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let start = std::time::Instant::now();
        match tracepilot_indexer::refresh_session_store_enrichment(
            &session_state_dir,
            &index_path,
            enabled,
            |_| {},
            || false,
        ) {
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
                crate::helpers::emit_best_effort(
                    &app,
                    crate::events::ENRICHMENT_FINISHED,
                    serde_json::json!({
                        "availability": outcome.availability.as_str(),
                        "refreshed": outcome.refreshed,
                    }),
                );
            }
            Err(error) => {
                tracing::warn!(error = %error, "Session-store enrichment sweep failed");
            }
        }
    });
}
