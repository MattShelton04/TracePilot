//! Reading the cached request ledger, references and coverage back out.
//!
//! Everything here is scoped to one source generation. Mixing generations
//! would put rows from a rebuilt store beside rows from the one it replaced,
//! which share row IDs and mean different requests.

use rusqlite::{OptionalExtension, Row, ToSql, params_from_iter};
use tracepilot_core::utils::sqlite::table_exists;

use crate::Result;

use super::super::IndexDb;
use super::model::{
    RequestLedgerPage, SessionCoverageRow, StoreSourceStatus, StoredBillingItem, StoredRequest,
    StoredWorkRef,
};
use super::types::{DEFAULT_REQUEST_PAGE, MAX_REQUEST_PAGE, RequestCursor, RequestLedgerFilter};

const REQUEST_COLUMNS: &str = "source_id, generation, source_row_id, session_id, \
     source_turn_index, agent_id, parent_tool_call_id, model, input_tokens, output_tokens, \
     cache_read_tokens, cache_write_tokens, reasoning_tokens, total_nano_aiu, request_multiplier, \
     duration_ms, time_to_first_token_ms, output_ttft_ms, inter_token_latency_ms, initiator, \
     api_endpoint, reasoning_effort, finish_reason, content_filter_triggered, copilot_usage_model, \
     billing_items_status, billing_check, recorded_at, invalid_fields, row_fingerprint";

impl IndexDb {
    /// Whether the enrichment tables exist on this handle.
    ///
    /// `open_readonly` skips migrations, so a reader opened against a
    /// database that predates migration 20 must degrade to "no enrichment"
    /// rather than fail — the baseline views have to keep working.
    pub fn has_session_store_enrichment(&self) -> bool {
        table_exists(&self.conn, "session_request_usage")
    }

    /// The bound source's current state, or `None` when nothing is bound.
    pub fn session_store_status(&self) -> Result<Option<StoreSourceStatus>> {
        if !table_exists(&self.conn, "session_store_sources") {
            return Ok(None);
        }
        let status = self
            .conn
            .query_row(
                "SELECT source_id, db_path, copilot_home, generation, capability_fingerprint, \
                        source_schema_version, capabilities, availability, status_detail, \
                        last_attempt_at, last_success_at, revision, enrichment_version \
                 FROM session_store_sources ORDER BY last_attempt_at DESC LIMIT 1",
                [],
                |row| {
                    Ok(StoreSourceStatus {
                        source_id: row.get(0)?,
                        db_path: row.get(1)?,
                        copilot_home: row.get(2)?,
                        generation: row.get(3)?,
                        capability_fingerprint: row.get(4)?,
                        source_schema_version: row.get(5)?,
                        capabilities: split_csv(row.get::<_, Option<String>>(6)?),
                        availability: row.get(7)?,
                        status_detail: row.get(8)?,
                        last_attempt_at: row.get(9)?,
                        last_success_at: row.get(10)?,
                        revision: row.get(11)?,
                        enrichment_version: row.get(12)?,
                        sessions_with_requests: 0,
                        total_requests: 0,
                    })
                },
            )
            .optional()?;
        let Some(mut status) = status else {
            return Ok(None);
        };
        let (sessions, requests): (i64, i64) = self.conn.query_row(
            "SELECT COUNT(DISTINCT session_id), COUNT(*) FROM session_request_usage \
             WHERE source_id = ?1 AND generation = ?2",
            params_from_iter([&status.source_id, &status.generation].map(|v| v as &dyn ToSql)),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        status.sessions_with_requests = sessions;
        status.total_requests = requests;
        Ok(Some(status))
    }

    /// One page of the request ledger.
    ///
    /// Sorted by recorded time then row ID: timestamps repeat, and a sort
    /// that is not total makes a cursor skip or repeat rows across pages.
    pub fn list_request_usage(&self, filter: &RequestLedgerFilter) -> Result<RequestLedgerPage> {
        let _snapshot = self.conn.unchecked_transaction()?;
        if !self.has_session_store_enrichment() {
            return Ok(RequestLedgerPage::unavailable());
        }
        let Some(generation) = self.request_generation()? else {
            return Ok(RequestLedgerPage::unavailable());
        };
        let revision = self.ledger_revision(filter.session_id.as_deref())?;
        // A cursor from a superseded generation cannot be continued: its row
        // IDs address different requests now. Neither can one whose session
        // was rewritten since, but a change to some other session is no
        // reason to send this one back to its first page.
        if let Some(cursor) = &filter.after
            && (cursor.generation != generation || cursor.revision != revision)
        {
            return Ok(RequestLedgerPage::stale_cursor(generation));
        }

        let limit = filter
            .limit
            .unwrap_or(DEFAULT_REQUEST_PAGE)
            .clamp(1, MAX_REQUEST_PAGE);
        let (where_sql, mut params) = self.build_request_filter(filter, &generation);

        let sql = format!(
            "SELECT {REQUEST_COLUMNS} FROM session_request_usage u {where_sql} \
             ORDER BY recorded_at ASC NULLS LAST, source_row_id ASC LIMIT ?"
        );
        params.push(Box::new(i64::try_from(limit + 1).unwrap_or(i64::MAX)));

        let mut stmt = self.conn.prepare(&sql)?;
        let mut rows: Vec<StoredRequest> = stmt
            .query_map(
                params_from_iter(params.iter().map(|param| param.as_ref())),
                stored_request_from_row,
            )?
            .collect::<rusqlite::Result<_>>()?;

        let has_more = rows.len() > limit;
        rows.truncate(limit);
        let next_cursor = has_more.then(|| {
            rows.last().map(|request| RequestCursor {
                generation: generation.clone(),
                revision,
                recorded_at: request.recorded_at.clone(),
                source_row_id: request.source_row_id,
            })
        });
        self.attach_billing_items(&mut rows, &generation)?;

        Ok(RequestLedgerPage {
            requests: rows,
            next_cursor: next_cursor.flatten(),
            generation: Some(generation),
            available: true,
            cursor_expired: false,
        })
    }

    /// The revision a ledger cursor is valid for: the session's own when the
    /// ledger is one session's, else the source's.
    fn ledger_revision(&self, session_id: Option<&str>) -> Result<i64> {
        if let Some(session_id) = session_id
            && let Some(coverage) = self.session_store_coverage(session_id)?
        {
            return Ok(coverage.revision);
        }
        Ok(self
            .session_store_status()?
            .map_or(0, |source| source.revision))
    }

    /// Every request for one session, for aggregates that need the whole
    /// population rather than a page of it.
    pub fn all_session_requests(&self, session_id: &str) -> Result<Vec<StoredRequest>> {
        if !self.has_session_store_enrichment() {
            return Ok(Vec::new());
        }
        let Some(generation) = self.request_generation()? else {
            return Ok(Vec::new());
        };
        let sql = format!(
            "SELECT {REQUEST_COLUMNS} FROM session_request_usage u \
             WHERE u.generation = ?1 AND u.session_id = ?2 \
             ORDER BY recorded_at ASC NULLS LAST, source_row_id ASC"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(
                rusqlite::params![generation, session_id],
                stored_request_from_row,
            )?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// One session's linked-work references.
    pub fn list_session_work_refs(&self, session_id: &str) -> Result<Vec<StoredWorkRef>> {
        if !table_exists(&self.conn, "session_work_refs") {
            return Ok(Vec::new());
        }
        let Some(generation) = self.active_generation()? else {
            return Ok(Vec::new());
        };
        let mut stmt = self.conn.prepare(
            "SELECT ref_identity, session_id, source_row_id, kind, raw_value, normalized_value, \
                    resolved_host, resolved_repository, candidate_repository, resolution, \
                    sha_shaped, source_turn_index, recorded_at \
             FROM session_work_refs WHERE generation = ?1 AND session_id = ?2 \
             ORDER BY kind ASC, normalized_value ASC",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![generation, session_id], |row| {
                Ok(StoredWorkRef {
                    identity: row.get(0)?,
                    session_id: row.get(1)?,
                    source_row_id: row.get(2)?,
                    kind: row.get(3)?,
                    raw_value: row.get(4)?,
                    normalized_value: row.get(5)?,
                    resolved_host: row.get(6)?,
                    resolved_repository: row.get(7)?,
                    candidate_repository: row.get(8)?,
                    resolution: row.get(9)?,
                    sha_shaped: row.get::<_, Option<i64>>(10)?.unwrap_or(0) != 0,
                    source_turn_index: row.get(11)?,
                    recorded_at: row.get(12)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        Ok(rows)
    }

    /// One session's coverage record, if it has been refreshed.
    pub fn session_store_coverage(&self, session_id: &str) -> Result<Option<SessionCoverageRow>> {
        if !table_exists(&self.conn, "session_store_coverage") {
            return Ok(None);
        }
        let Some(generation) = self.active_generation()? else {
            return Ok(None);
        };
        Ok(self
            .conn
            .query_row(
                "SELECT session_id, generation, availability, freshness, request_rows, \
                        request_rows_rejected, work_ref_rows, work_ref_rows_rejected, \
                        billing_absent, billing_partial, billing_invalid, field_coverage_json, \
                        missing_columns, reconciliation_status, reconciliation_scope, \
                        reconciliation_metrics, reconciliation_differences, read_at, revision \
                 FROM session_store_coverage WHERE session_id = ?1 AND generation = ?2 \
                 ORDER BY read_at DESC LIMIT 1",
                [session_id, generation.as_str()],
                |row| {
                    Ok(SessionCoverageRow {
                        session_id: row.get(0)?,
                        generation: row.get(1)?,
                        availability: row.get(2)?,
                        freshness: row.get(3)?,
                        request_rows: row.get(4)?,
                        request_rows_rejected: row.get(5)?,
                        work_ref_rows: row.get(6)?,
                        work_ref_rows_rejected: row.get(7)?,
                        billing_absent: row.get(8)?,
                        billing_partial: row.get(9)?,
                        billing_invalid: row.get(10)?,
                        field_coverage_json: row.get(11)?,
                        missing_columns: split_csv(row.get::<_, Option<String>>(12)?),
                        reconciliation_status: row.get(13)?,
                        reconciliation_scope: row.get(14)?,
                        reconciliation_metrics: split_csv(row.get::<_, Option<String>>(15)?),
                        reconciliation_differences: row.get(16)?,
                        read_at: row.get(17)?,
                        revision: row.get(18)?,
                    })
                },
            )
            .optional()?)
    }

    /// The generation currently published by the bound source.
    pub(crate) fn active_generation(&self) -> Result<Option<String>> {
        self.generation_for(None)
    }

    pub(crate) fn request_generation(&self) -> Result<Option<String>> {
        self.generation_for(Some("requests"))
    }

    /// Whether the published source snapshot supports this evidence type.
    pub fn has_session_store_capability(&self, capability: &str) -> Result<bool> {
        Ok(self.generation_for(Some(capability))?.is_some())
    }

    fn generation_for(&self, capability: Option<&str>) -> Result<Option<String>> {
        if !table_exists(&self.conn, "session_store_sources") {
            return Ok(None);
        }
        Ok(self
            .conn
            .query_row(
                "SELECT CASE WHEN last_success_at IS NOT NULL \
                    AND (?1 IS NULL OR instr(',' || capabilities || ',', ',' || ?1 || ',') > 0) \
                    THEN generation END FROM session_store_sources \
                 ORDER BY last_attempt_at DESC LIMIT 1",
                [capability],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten())
    }

    pub(super) fn build_request_filter(
        &self,
        filter: &RequestLedgerFilter,
        generation: &str,
    ) -> (String, Vec<Box<dyn ToSql>>) {
        let mut clauses = vec!["u.generation = ?".to_string()];
        let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(generation.to_string())];

        if let Some(session_id) = &filter.session_id {
            clauses.push("u.session_id = ?".to_string());
            params.push(Box::new(session_id.clone()));
        }
        for (column, values) in [
            ("u.model", &filter.models),
            ("u.agent_id", &filter.agent_ids),
            ("u.initiator", &filter.initiators),
            ("u.reasoning_effort", &filter.reasoning_efforts),
            ("u.finish_reason", &filter.finish_reasons),
            ("u.api_endpoint", &filter.api_endpoints),
        ] {
            if values.is_empty() {
                continue;
            }
            let placeholders = vec!["?"; values.len()].join(", ");
            clauses.push(format!("{column} IN ({placeholders})"));
            for value in values {
                params.push(Box::new(value.clone()));
            }
        }
        // A NULL counter belongs to neither population: "not recorded" is not
        // the same statement as "no reuse".
        match filter.reports_cache_reuse {
            Some(true) => clauses.push("u.cache_read_tokens > 0".to_string()),
            Some(false) => clauses.push("u.cache_read_tokens = 0".to_string()),
            None => {}
        }
        if let Some(repository) = &filter.repository {
            clauses.push(
                "EXISTS (SELECT 1 FROM sessions s WHERE s.id = u.session_id AND s.repository = ?)"
                    .to_string(),
            );
            params.push(Box::new(repository.clone()));
        }
        // Filter on the request's own recorded time, not the session's
        // creation date: assigning every request to a session's start would
        // pile a long-running session's whole history onto one day.
        if let Some(from) = &filter.from_date {
            clauses.push("u.recorded_at >= ?".to_string());
            params.push(Box::new(from.clone()));
        }
        if let Some(to) = &filter.to_date {
            clauses.push("u.recorded_at < date(?, '+1 day')".to_string());
            params.push(Box::new(to.clone()));
        }
        if let Some(cursor) = &filter.after {
            if let Some(timestamp) = &cursor.recorded_at {
                clauses.push("(u.recorded_at IS NULL OR u.recorded_at > ? OR (u.recorded_at = ? AND u.source_row_id > ?))".to_string());
                params.push(Box::new(timestamp.clone()));
                params.push(Box::new(timestamp.clone()));
            } else {
                clauses.push("(u.recorded_at IS NULL AND u.source_row_id > ?)".to_string());
            }
            params.push(Box::new(cursor.source_row_id));
        }
        (format!("WHERE {}", clauses.join(" AND ")), params)
    }

    fn attach_billing_items(&self, requests: &mut [StoredRequest], generation: &str) -> Result<()> {
        if requests.is_empty() {
            return Ok(());
        }
        let ids: Vec<i64> = requests
            .iter()
            .map(|request| request.source_row_id)
            .collect();
        let placeholders = vec!["?"; ids.len()].join(", ");
        let sql = format!(
            "SELECT source_row_id, ordinal, token_type, token_count, batch_size, \
                    cost_per_batch, billing_model \
             FROM session_request_billing_items \
             WHERE generation = ? AND source_row_id IN ({placeholders}) ORDER BY ordinal ASC"
        );
        let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(generation.to_string())];
        for id in ids {
            params.push(Box::new(id));
        }
        let mut stmt = self.conn.prepare(&sql)?;
        let items = stmt
            .query_map(
                params_from_iter(params.iter().map(|param| param.as_ref())),
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        StoredBillingItem {
                            ordinal: row.get(1)?,
                            token_type: row.get(2)?,
                            token_count: row.get(3)?,
                            batch_size: row.get(4)?,
                            cost_per_batch: row.get(5)?,
                            billing_model: row.get(6)?,
                        },
                    ))
                },
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (source_row_id, item) in items {
            if let Some(request) = requests
                .iter_mut()
                .find(|request| request.source_row_id == source_row_id)
            {
                request.billing_items.push(item);
            }
        }
        Ok(())
    }
}

fn split_csv(value: Option<String>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

fn stored_request_from_row(row: &Row<'_>) -> rusqlite::Result<StoredRequest> {
    Ok(StoredRequest {
        source_id: row.get(0)?,
        generation: row.get(1)?,
        source_row_id: row.get(2)?,
        session_id: row.get(3)?,
        source_turn_index: row.get(4)?,
        agent_id: row.get(5)?,
        parent_tool_call_id: row.get(6)?,
        model: row.get(7)?,
        input_tokens: row.get(8)?,
        output_tokens: row.get(9)?,
        cache_read_tokens: row.get(10)?,
        cache_write_tokens: row.get(11)?,
        reasoning_tokens: row.get(12)?,
        total_nano_aiu: row.get(13)?,
        request_multiplier: row.get(14)?,
        duration_ms: row.get(15)?,
        time_to_first_token_ms: row.get(16)?,
        output_ttft_ms: row.get(17)?,
        inter_token_latency_ms: row.get(18)?,
        initiator: row.get(19)?,
        api_endpoint: row.get(20)?,
        reasoning_effort: row.get(21)?,
        finish_reason: row.get(22)?,
        content_filter_triggered: row.get::<_, Option<i64>>(23)?.map(|flag| flag != 0),
        copilot_usage_model: row.get(24)?,
        billing_items_status: row.get(25)?,
        billing_check: row.get(26)?,
        recorded_at: row.get(27)?,
        invalid_fields: split_csv(row.get::<_, Option<String>>(28)?),
        row_fingerprint: row.get(29)?,
        billing_items: Vec::new(),
    })
}
