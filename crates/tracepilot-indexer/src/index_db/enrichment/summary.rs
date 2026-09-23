//! Session-wide figures behind a ledger view.
//!
//! A page shows twenty-five requests; the questions a reader brings — what
//! did this session's requests cost, which agents and models appear at all —
//! are about every request the filter matches. Kept apart from the paging
//! reader so each stays small.

use rusqlite::params_from_iter;
use tracepilot_core::session_store::ExactDecimal;

use crate::Result;

use super::super::IndexDb;
use super::model::{RequestLedgerFacets, RequestLedgerSummary};
use super::types::RequestLedgerFilter;

impl IndexDb {
    /// Totals over every request `filter` matches, ignoring its page and
    /// cursor, plus the session's full set of filter values.
    ///
    /// `None` when the ledger is unavailable or the filter names no session.
    pub fn request_ledger_summary(
        &self,
        filter: &RequestLedgerFilter,
    ) -> Result<Option<RequestLedgerSummary>> {
        let Some(session_id) = filter.session_id.as_deref() else {
            return Ok(None);
        };
        if !self.has_session_store_enrichment() {
            return Ok(None);
        }
        let Some(generation) = self.request_generation()? else {
            return Ok(None);
        };

        let unpaged = RequestLedgerFilter {
            after: None,
            limit: None,
            ..filter.clone()
        };
        let (where_sql, params) = self.build_request_filter(&unpaged, &generation);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT total_nano_aiu FROM session_request_usage u {where_sql}"
        ))?;
        let charges = stmt
            .query_map(
                params_from_iter(params.iter().map(|param| param.as_ref())),
                |row| row.get::<_, Option<String>>(0),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut summary = RequestLedgerSummary {
            request_count: i64::try_from(charges.len()).unwrap_or(i64::MAX),
            ..RequestLedgerSummary::default()
        };
        let mut total: Option<ExactDecimal> = None;
        for charge in charges {
            let Some(text) = charge else {
                summary.uncharged_requests += 1;
                continue;
            };
            // An overflowing sum is as unreadable as an unparseable cell:
            // either way the total would not be the recorded one.
            match ExactDecimal::parse(&text)
                .and_then(|value| total.map_or(Some(value), |sum| sum.checked_add(value)))
            {
                Some(sum) => {
                    total = Some(sum);
                    summary.charged_requests += 1;
                }
                None => summary.unreadable_charges += 1,
            }
        }
        summary.total_nano_aiu = total.map(|sum| sum.to_string());
        summary.facets = self.request_ledger_facets(session_id, &generation)?;
        Ok(Some(summary))
    }

    fn request_ledger_facets(
        &self,
        session_id: &str,
        generation: &str,
    ) -> Result<RequestLedgerFacets> {
        let distinct = |column: &str| -> Result<Vec<String>> {
            let mut stmt = self.conn.prepare(&format!(
                "SELECT DISTINCT {column} FROM session_request_usage                  WHERE generation = ?1 AND session_id = ?2 AND {column} IS NOT NULL                  ORDER BY {column}"
            ))?;
            Ok(stmt
                .query_map([generation, session_id], |row| row.get(0))?
                .collect::<rusqlite::Result<_>>()?)
        };
        Ok(RequestLedgerFacets {
            models: distinct("model")?,
            agent_ids: distinct("agent_id")?,
            initiators: distinct("initiator")?,
            reasoning_efforts: distinct("reasoning_effort")?,
            finish_reasons: distinct("finish_reason")?,
        })
    }
}
