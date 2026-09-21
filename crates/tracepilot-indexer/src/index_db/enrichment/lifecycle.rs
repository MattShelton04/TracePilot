//! Refresh bookkeeping: source status, snapshot identity and reconciliation.

use tracepilot_core::parsing::events::{TypedEvent, extract_combined_shutdown_data};
use tracepilot_core::session_store::{
    ReconciliationReport, SessionStoreError, SourceAvailability, SourceBinding, reconcile_session,
};

use crate::Result;

use super::super::IndexDb;
use super::types::StoreSourceRow;

impl IndexDb {
    /// Record that the bound source could not be read.
    ///
    /// The generation and capability fingerprint are left as they were: a
    /// source that is merely locked has not changed shape, and overwriting
    /// them would make the next successful read look like a replacement and
    /// discard a whole generation of good rows.
    pub(crate) fn mark_source_unavailable(
        &self,
        binding: &SourceBinding,
        availability: SourceAvailability,
        error: &SessionStoreError,
    ) -> Result<()> {
        let existing = self
            .session_store_status()?
            .filter(|status| status.source_id == binding.source_id);
        let source = StoreSourceRow {
            source_id: binding.source_id.clone(),
            db_path: binding.db_path.display().to_string(),
            copilot_home: binding.copilot_home.display().to_string(),
            session_state_dir: binding.session_state_dir.display().to_string(),
            generation: existing
                .as_ref()
                .map(|status| status.generation.clone())
                .unwrap_or_default(),
            capability_fingerprint: existing
                .as_ref()
                .and_then(|status| status.capability_fingerprint.clone()),
            source_schema_version: existing
                .as_ref()
                .and_then(|status| status.source_schema_version),
            capabilities: existing
                .as_ref()
                .map(|status| status.capabilities.join(","))
                .unwrap_or_default(),
            availability: availability.as_str().to_string(),
            // The error's own text, which names the condition without
            // quoting a path or a payload.
            status_detail: Some(short_detail(error)),
        };
        self.upsert_store_source(&source, false)
    }

    /// Mark every cached session as stale without touching its rows.
    ///
    /// Used when the source is unreadable: the data is still the best answer
    /// available, but it is an answer as of the last successful read.
    pub(crate) fn mark_enrichment_stale(&self) -> Result<()> {
        self.conn.execute(
            "UPDATE session_store_coverage SET freshness = 'stale' WHERE freshness <> 'stale'",
            [],
        )?;
        Ok(())
    }

    /// Identity of the event snapshot a mapping or reconciliation used.
    ///
    /// Taken from the baseline index's own staleness fingerprint, so a log
    /// rewrite that re-indexes the session also invalidates every enrichment
    /// claim derived from the previous contents.
    pub(crate) fn session_event_fingerprint(&self, session_id: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT events_mtime, events_size FROM sessions WHERE id = ?1",
                [session_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                    ))
                },
            )
            .ok()
            .and_then(|(mtime, size)| {
                let mtime = mtime?;
                Some(format!("{mtime}:{}", size.unwrap_or(-1)))
            }))
    }

    /// Compare recorded requests against the session's shutdown accounting.
    ///
    /// The verdict always carries the scope and metric set it used, and an
    /// absent or unreadable snapshot yields `unverified` rather than a
    /// mismatch the user cannot act on.
    pub(crate) fn reconcile_session_requests(
        &self,
        requests: &[tracepilot_core::session_store::StoreRequest],
        events: &[TypedEvent],
        snapshot_fingerprint: Option<String>,
    ) -> ReconciliationReport {
        if requests.is_empty() {
            return ReconciliationReport::unverified("no recorded requests");
        }
        if events.is_empty() {
            return ReconciliationReport::unverified("event log unavailable");
        }
        // The combined extractor is what normalises cumulative and legacy
        // segment shutdowns; comparing against a raw latest shutdown would
        // mis-scope every session that spans a CLI upgrade.
        let shutdown = extract_combined_shutdown_data(events).map(|(data, _)| data);
        reconcile_session(requests, shutdown.as_ref(), snapshot_fingerprint)
    }
}

/// A one-line diagnostic safe for routine status telemetry.
fn short_detail(error: &SessionStoreError) -> String {
    match error {
        // The missing variant embeds the resolved path, which does not belong
        // in a status string that may be logged on every poll.
        SessionStoreError::Missing(_) => {
            "no session store at the configured Copilot home".to_string()
        }
        other => other.to_string(),
    }
}
