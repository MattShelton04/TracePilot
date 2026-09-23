//! The session-store enrichment refresh pass.
//!
//! A third pass, scheduled independently of baseline indexing (Phase 1) and
//! search content (Phase 2), because its input is an external file on its own
//! schedule. Request rows appear in the store without `events.jsonl` changing
//! at all, so gating this on baseline staleness would mean never seeing them;
//! and the store can be missing or locked exactly when the log does change,
//! so coupling the two would discard good cached data.
//!
//! The pass never fails the caller for an absent or busy source. Its result
//! is a summary the scheduler logs; the baseline index is untouched either
//! way, and nothing here may reach the bindings' "incremental failed, rebuild
//! everything" fallback.

use std::path::Path;

use tracepilot_core::paths::CopilotPaths;
use tracepilot_core::session_store::{
    self, SessionStoreError, SourceAvailability, SourceBinding, SourceReader,
};

use crate::Result;
use crate::index_db::{self, IndexDb};

/// Progress for one enrichment sweep.
#[derive(Debug, Clone, Copy)]
pub struct EnrichmentProgress {
    pub current: usize,
    pub total: usize,
}

/// What one sweep did.
#[derive(Debug, Clone)]
pub struct EnrichmentOutcome {
    pub availability: SourceAvailability,
    /// Sessions whose enrichment was rewritten.
    pub refreshed: usize,
    /// Sessions whose refresh found nothing changed.
    pub unchanged: usize,
    /// Sessions skipped because they are not bound to this source, or have
    /// no baseline index row yet.
    pub skipped: usize,
    /// A short diagnostic for a non-ready source. Never a path or a payload.
    pub detail: Option<String>,
}

impl EnrichmentOutcome {
    fn unavailable(availability: SourceAvailability, detail: Option<String>) -> Self {
        Self {
            availability,
            refreshed: 0,
            unchanged: 0,
            skipped: 0,
            detail,
        }
    }
}

/// Refresh enrichment for every eligible session, or for `only_session`.
///
/// `session_state_dir` is the directory whose sessions are candidates; a
/// session is eligible only when the bound source owns that directory, so an
/// isolated or imported root never picks up the personal store's telemetry.
///
/// `only_session` keeps an open, in-progress session current without paying
/// for a full sweep. It is honoured only while the source generation is the
/// one already published: a replaced store is swept in full, or one session
/// would be rewritten into a generation its neighbours are not in.
#[tracing::instrument(skip_all)]
pub fn refresh_session_store_enrichment(
    session_state_dir: &Path,
    index_db_path: &Path,
    enabled: bool,
    only_session: Option<&str>,
    on_progress: impl FnMut(&EnrichmentProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<EnrichmentOutcome> {
    let db = IndexDb::open_or_create(index_db_path)?;

    if !enabled {
        // Disabling means "stop using and stop retaining", not merely "hide":
        // the setting's explanation says so, and leaving rows behind would
        // make the toggle a display preference over retained external data.
        db.purge_session_store_enrichment()?;
        return Ok(EnrichmentOutcome::unavailable(
            SourceAvailability::Disabled,
            None,
        ));
    }

    let Some(binding) = SourceBinding::try_default() else {
        return Ok(EnrichmentOutcome::unavailable(
            SourceAvailability::Missing,
            Some("no resolvable Copilot home".to_string()),
        ));
    };
    if !owns_state_dir(&binding, session_state_dir) {
        // A custom or imported session root is not this store's, and a path
        // or UUID match alone is not evidence that it is.
        db.purge_session_store_enrichment()?;
        return Ok(EnrichmentOutcome::unavailable(
            SourceAvailability::Missing,
            Some("session directory is not bound to this source".to_string()),
        ));
    }

    refresh_bound_source_scoped(
        &db,
        &binding,
        session_state_dir,
        only_session,
        on_progress,
        is_cancelled,
    )
}

/// A full sweep of a bound source; the tests' entry point.
#[cfg(test)]
pub(crate) fn refresh_bound_source(
    db: &IndexDb,
    binding: &SourceBinding,
    session_state_dir: &Path,
    on_progress: impl FnMut(&EnrichmentProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<EnrichmentOutcome> {
    refresh_bound_source_scoped(
        db,
        binding,
        session_state_dir,
        None,
        on_progress,
        is_cancelled,
    )
}

pub(crate) fn refresh_bound_source_scoped(
    db: &IndexDb,
    binding: &SourceBinding,
    session_state_dir: &Path,
    only_session: Option<&str>,
    mut on_progress: impl FnMut(&EnrichmentProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<EnrichmentOutcome> {
    let mut reader = match SourceReader::open(binding) {
        Ok(reader) => reader,
        Err(error) => return Ok(record_failure(db, binding, &error)),
    };
    let data_version = match reader.data_version() {
        Ok(version) => version,
        Err(error) => return Ok(record_failure(db, binding, &error)),
    };
    let generation = match reader.generation_fingerprint() {
        Ok(generation) => generation,
        Err(error) => return Ok(record_failure(db, binding, &error)),
    };

    // Read before the upsert below publishes this generation.
    let published = db.active_generation()?;
    let only_session = only_session.filter(|_| published.as_deref() == Some(generation.as_str()));

    let source =
        index_db::enrichment::StoreSourceRow::ready(binding, &generation, reader.capabilities());
    // Readers see either the previous complete sweep or the next complete
    // sweep. Cancellation, failed reads and local write failures roll back
    // the source pointer and every per-session replacement together.
    let transaction = db.conn.unchecked_transaction()?;
    db.upsert_store_source(&source, true)?;

    let mut sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    if let Some(id) = only_session {
        sessions.retain(|session| session.id.as_str() == id);
    }
    let total = sessions.len();
    let mut outcome = EnrichmentOutcome {
        availability: SourceAvailability::Ready,
        refreshed: 0,
        unchanged: 0,
        skipped: 0,
        detail: None,
    };

    for (position, session) in sessions.iter().enumerate() {
        if is_cancelled() {
            tracing::info!(
                processed = position,
                "Session-store enrichment cancelled mid-sweep"
            );
            transaction.rollback()?;
            return Ok(record_failure(
                db,
                binding,
                &SessionStoreError::Busy("refresh cancelled".to_string()),
            ));
        }
        // Each session gets its own budget: one long sweep must not be
        // bounded by a deadline that started at the first session.
        reader.renew_budget();

        let enrichment = match session_store::read_session(&reader, session.id.as_str()) {
            Ok(enrichment) => enrichment,
            Err(error) => {
                transaction.rollback()?;
                return Ok(record_failure(db, binding, &error));
            }
        };
        match refresh_one(db, &reader, &generation, session, enrichment) {
            Ok(Some(true)) => outcome.refreshed += 1,
            Ok(Some(false)) => outcome.unchanged += 1,
            Ok(None) => outcome.skipped += 1,
            Err(error) => {
                transaction.rollback()?;
                db.mark_enrichment_stale()?;
                return Err(error);
            }
        }
        on_progress(&EnrichmentProgress {
            current: position + 1,
            total,
        });
    }

    if reader.data_version().ok() != Some(data_version) {
        transaction.rollback()?;
        return Ok(record_failure(
            db,
            binding,
            &SessionStoreError::Busy("source changed during refresh; retry required".to_string()),
        ));
    }
    db.purge_stale_generations(&binding.source_id, &generation)?;
    // Only the configured binding may supply data, even after a home change.
    db.conn.execute(
        "DELETE FROM session_store_sources WHERE source_id <> ?1",
        [&binding.source_id],
    )?;
    transaction.commit()?;
    Ok(outcome)
}

/// Refresh one session. `None` means it was not eligible.
fn refresh_one(
    db: &IndexDb,
    reader: &SourceReader,
    generation: &str,
    session: &tracepilot_core::session::discovery::DiscoveredSession,
    enrichment: session_store::SessionEnrichment,
) -> Result<Option<bool>> {
    let session_id = session.id.as_str();
    // A truncated or failed read produces an empty value too, so only a
    // confirmed successful read is allowed to replace (and therefore prune)
    // what is already cached.
    if !enrichment.may_prune() {
        return Ok(None);
    }

    let fingerprint = db.session_event_fingerprint(session_id)?;
    // Parse the log once, and only when there is something to attach to it.
    // Locally just 18 of 391 sessions had any recorded requests, so the
    // common case costs nothing at all.
    let events = if enrichment.requests.is_empty() {
        Vec::new()
    } else {
        parse_events(&session.path)
    };
    let links = db.build_request_links(
        session_id,
        &enrichment.requests,
        &events,
        fingerprint.clone(),
    )?;
    let mut coverage = enrichment.coverage.clone();
    coverage.reconciliation =
        db.reconcile_session_requests(&enrichment.requests, &events, fingerprint);

    let write = index_db::enrichment::SessionEnrichmentWrite {
        source_id: &reader.binding().source_id,
        generation,
        session_id,
        requests: &enrichment.requests,
        work_refs: &enrichment.work_refs,
        links: &links,
        coverage: &coverage,
    };
    Ok(Some(db.replace_session_enrichment(&write)?))
}

/// Record a source that could not be opened, keeping cached rows.
///
/// A missing store is expected on a machine whose CLI predates it, and a busy
/// one clears by itself, so neither is a reason to warn on every poll or to
/// drop what a previous successful read produced.
fn record_failure(
    db: &IndexDb,
    binding: &SourceBinding,
    error: &SessionStoreError,
) -> EnrichmentOutcome {
    let availability = error.availability();
    if let Err(write_error) = db.mark_source_unavailable(binding, availability, error) {
        tracing::debug!(error = %write_error, "Failed to record session-store status");
    }
    // Cached rows stay: they are still the best available answer, but only
    // as of the last successful read, so every session is flagged stale.
    if let Err(write_error) = db.mark_enrichment_stale() {
        tracing::debug!(error = %write_error, "Failed to mark enrichment stale");
    }
    if !availability.is_transient() && availability != SourceAvailability::Missing {
        tracing::warn!(
            status = availability.as_str(),
            "Copilot session store unusable"
        );
    }
    EnrichmentOutcome::unavailable(availability, Some(error.to_string()))
}

/// Parse a session's event log, or yield nothing when it cannot be read.
///
/// An unreadable log is not a refresh failure: the request ledger itself is
/// still worth caching, it just arrives without joins or a reconciliation
/// verdict.
fn parse_events(session_path: &Path) -> Vec<tracepilot_core::parsing::events::TypedEvent> {
    let events_path = tracepilot_core::paths::SessionPaths::from_root(session_path).events_jsonl();
    tracepilot_core::parsing::events::parse_typed_events(&events_path)
        .map(|parsed| parsed.events)
        .unwrap_or_default()
}

fn owns_state_dir(binding: &SourceBinding, session_state_dir: &Path) -> bool {
    // Compare through the binding's own ownership rule so the comparison
    // stays in one place, using a synthetic child of the candidate directory.
    binding.owns_session_dir(&session_state_dir.join("probe"))
}

/// The default binding for this machine, for status surfaces that need the
/// resolved path without opening the store.
pub fn default_source_binding() -> Option<SourceBinding> {
    CopilotPaths::try_default().map(|paths| SourceBinding::from_paths(&paths))
}
