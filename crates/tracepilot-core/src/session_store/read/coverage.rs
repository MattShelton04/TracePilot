//! What a read of one session actually managed to see.
//!
//! Coverage is the difference between "this session made no API calls" and
//! "no request detail was recorded for it", and between an aggregate over
//! every request and one over the 187 rows that happened to carry a second
//! timing field. It travels with the data, never beside it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::session_store::model::BillingItemsStatus;
use crate::session_store::status::{
    FieldCoverage, Freshness, ReconciliationReport, SourceAvailability,
};

/// Completeness of one session's enrichment read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCoverage {
    pub session_id: String,
    pub source_id: String,
    /// The source generation this read belongs to. Rows from two generations
    /// must never be mixed in one view.
    pub generation: String,
    pub availability: SourceAvailability,
    pub freshness: Freshness,
    /// Request rows accepted.
    pub request_rows: u32,
    /// Request rows whose identity columns were unusable.
    pub request_rows_rejected: u32,
    pub work_ref_rows: u32,
    pub work_ref_rows_rejected: u32,
    /// Requests whose billing array was absent, partial or unparseable.
    pub billing_absent: u32,
    pub billing_partial: u32,
    pub billing_invalid: u32,
    /// Per-metric valid/missing/invalid tallies, keyed by the camelCase field
    /// name the UI shows.
    pub fields: BTreeMap<String, FieldCoverage>,
    /// Allowlisted columns this source lacks, so the UI can explain a whole
    /// column of unavailable cells once instead of per row.
    pub missing_columns: Vec<String>,
    pub schema_version: Option<i64>,
    /// When this read completed, RFC 3339.
    pub read_at: String,
    pub reconciliation: ReconciliationReport,
}

impl SessionCoverage {
    /// Whether the read saw the source successfully. Only a successful read
    /// that genuinely found nothing may prune previously cached rows.
    pub fn is_successful(&self) -> bool {
        matches!(self.availability, SourceAvailability::Ready)
    }

    /// Whether the session has any enrichment at all to show.
    pub fn is_empty(&self) -> bool {
        self.request_rows == 0 && self.work_ref_rows == 0
    }
}

/// Accumulates coverage while rows are parsed.
pub struct CoverageBuilder {
    session_id: String,
    source_id: String,
    generation: String,
    schema_version: Option<i64>,
    missing_columns: Vec<String>,
    fields: BTreeMap<String, FieldCoverage>,
    request_rows: u32,
    request_rows_rejected: u32,
    work_ref_rows: u32,
    work_ref_rows_rejected: u32,
    billing_absent: u32,
    billing_partial: u32,
    billing_invalid: u32,
}

impl CoverageBuilder {
    pub fn new(
        session_id: impl Into<String>,
        source_id: impl Into<String>,
        generation: impl Into<String>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            source_id: source_id.into(),
            generation: generation.into(),
            schema_version: None,
            missing_columns: Vec::new(),
            fields: BTreeMap::new(),
            request_rows: 0,
            request_rows_rejected: 0,
            work_ref_rows: 0,
            work_ref_rows_rejected: 0,
            billing_absent: 0,
            billing_partial: 0,
            billing_invalid: 0,
        }
    }

    pub fn with_schema(
        mut self,
        schema_version: Option<i64>,
        missing_columns: Vec<String>,
    ) -> Self {
        self.schema_version = schema_version;
        self.missing_columns = missing_columns;
        self
    }

    /// The tally for one metric, created on first use.
    pub fn field(&mut self, name: &str) -> &mut FieldCoverage {
        self.fields.entry(name.to_string()).or_default()
    }

    pub fn accept_request_rows(&mut self, count: usize) {
        self.request_rows = u32::try_from(count).unwrap_or(u32::MAX);
    }

    pub fn reject_request_row(&mut self) {
        self.request_rows_rejected = self.request_rows_rejected.saturating_add(1);
    }

    pub fn accept_work_ref_rows(&mut self, count: usize) {
        self.work_ref_rows = u32::try_from(count).unwrap_or(u32::MAX);
    }

    pub fn reject_work_ref_row(&mut self) {
        self.work_ref_rows_rejected = self.work_ref_rows_rejected.saturating_add(1);
    }

    pub fn record_billing(&mut self, status: BillingItemsStatus) {
        match status {
            BillingItemsStatus::Complete => {}
            BillingItemsStatus::Absent => {
                self.billing_absent = self.billing_absent.saturating_add(1)
            }
            BillingItemsStatus::Partial => {
                self.billing_partial = self.billing_partial.saturating_add(1)
            }
            BillingItemsStatus::Invalid => {
                self.billing_invalid = self.billing_invalid.saturating_add(1)
            }
        }
    }

    pub fn build(self, availability: SourceAvailability, read_at: String) -> SessionCoverage {
        SessionCoverage {
            session_id: self.session_id,
            source_id: self.source_id,
            generation: self.generation,
            availability,
            freshness: Freshness::Current,
            request_rows: self.request_rows,
            request_rows_rejected: self.request_rows_rejected,
            work_ref_rows: self.work_ref_rows,
            work_ref_rows_rejected: self.work_ref_rows_rejected,
            billing_absent: self.billing_absent,
            billing_partial: self.billing_partial,
            billing_invalid: self.billing_invalid,
            fields: self.fields,
            missing_columns: self.missing_columns,
            schema_version: self.schema_version,
            read_at,
            reconciliation: ReconciliationReport::unverified("no comparable snapshot"),
        }
    }
}
