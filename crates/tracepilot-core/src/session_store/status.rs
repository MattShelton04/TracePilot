//! Availability, freshness and coverage vocabulary for the session store.
//!
//! Every figure this module produces is evidence from an optional local file
//! that may be absent, locked, older or newer than expected. A single boolean
//! "have data?" would collapse distinctions the UI has to make: "no request
//! detail was recorded" and "the source could not be read right now" look the
//! same to a boolean and mean opposite things to a reader.

use serde::{Deserialize, Serialize};

/// Whether the bound source can be read at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceAvailability {
    /// The user turned the enrichment setting off.
    Disabled,
    /// No store file at the resolved location. Expected on a machine whose
    /// Copilot CLI predates the store, and not an error.
    Missing,
    /// Opened, probed and readable.
    Ready,
    /// The file exists but a writer held it past the read budget.
    Busy,
    /// Present but unreadable: permissions, corruption, or an I/O failure.
    Unreadable,
    /// Readable, but without the tables or columns any capability needs.
    Incompatible,
}

impl SourceAvailability {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Missing => "missing",
            Self::Ready => "ready",
            Self::Busy => "busy",
            Self::Unreadable => "unreadable",
            Self::Incompatible => "incompatible",
        }
    }

    /// Whether cached rows from an earlier successful read stay valid. Only a
    /// deliberate disable and a confirmed healthy read may prune them.
    pub fn retains_cache(self) -> bool {
        !matches!(self, Self::Disabled)
    }

    /// Whether the condition is expected to clear by itself, so diagnostics
    /// should stay quiet and retries should back off rather than warn.
    pub fn is_transient(self) -> bool {
        matches!(self, Self::Busy)
    }
}

/// How current the cached enrichment is relative to the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Freshness {
    Current,
    Stale,
    Refreshing,
}

impl Freshness {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::Stale => "stale",
            Self::Refreshing => "refreshing",
        }
    }
}

/// Result of comparing recorded requests against the session's own shutdown
/// accounting. `Reconciled` is only ever claimed together with the metric set
/// and accounting scope that matched — see [`ReconciliationReport`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReconciliationStatus {
    /// No comparable snapshot existed, so nothing was checked.
    Unverified,
    /// Every compared metric matched within the stated scope.
    Reconciled,
    /// Values differ only by a named accounting-scope adjustment, such as an
    /// explicit compaction request counted in credits but not model metrics.
    ScopeDifference,
    /// Some compared metrics matched and others were unavailable.
    Partial,
    /// A compared metric disagreed and no known scope explains it.
    Mismatch,
}

impl ReconciliationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unverified => "unverified",
            Self::Reconciled => "reconciled",
            Self::ScopeDifference => "scopeDifference",
            Self::Partial => "partial",
            Self::Mismatch => "mismatch",
        }
    }
}

/// How firmly a request was attached to TracePilot's own run/turn structure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttributionStatus {
    /// Joined on identifiers the source and the event log both carry.
    Exact,
    /// Joined on secondary evidence that additional checks confirmed.
    Validated,
    /// More than one candidate survived, so no single target is claimed.
    Ambiguous,
    /// No candidate. The request still belongs in the ledger.
    Unavailable,
}

impl AttributionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Exact => "exact",
            Self::Validated => "validated",
            Self::Ambiguous => "ambiguous",
            Self::Unavailable => "unavailable",
        }
    }

    /// Whether a join is firm enough to hang a cache-reuse observation on.
    /// Ambiguity must never be laundered into an observed claim.
    pub fn is_reliable(self) -> bool {
        matches!(self, Self::Exact | Self::Validated)
    }
}

/// Per-field tally behind any aggregate: how many rows supplied a usable
/// value, how many left it out, and how many recorded something unusable.
/// A median over 187 of 383 rows is a different statement from a median over
/// all of them, and the denominator has to travel with the number.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldCoverage {
    pub valid: u32,
    pub missing: u32,
    pub invalid: u32,
}

impl FieldCoverage {
    pub fn record_valid(&mut self) {
        self.valid = self.valid.saturating_add(1);
    }

    pub fn record_missing(&mut self) {
        self.missing = self.missing.saturating_add(1);
    }

    pub fn record_invalid(&mut self) {
        self.invalid = self.invalid.saturating_add(1);
    }

    pub fn total(&self) -> u32 {
        self.valid
            .saturating_add(self.missing)
            .saturating_add(self.invalid)
    }

    pub fn is_complete(&self) -> bool {
        self.missing == 0 && self.invalid == 0
    }
}

/// What a reconciliation actually compared, carried alongside its verdict so
/// that "reconciled" can never be read as a broader claim than it is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciliationReport {
    pub status: ReconciliationStatus,
    /// Names of the metrics compared, e.g. `requests`, `inputTokens`.
    pub metrics: Vec<String>,
    /// The accounting scope used, e.g. `allRequests` or `excludingCompaction`.
    pub scope: String,
    /// Fingerprint of the event snapshot the comparison used, so a later log
    /// rewrite can invalidate the verdict instead of silently keeping it.
    pub snapshot_fingerprint: Option<String>,
    /// Human-readable differences, empty when everything matched.
    pub differences: Vec<String>,
}

impl ReconciliationReport {
    pub fn unverified(reason: impl Into<String>) -> Self {
        Self {
            status: ReconciliationStatus::Unverified,
            metrics: Vec::new(),
            scope: reason.into(),
            snapshot_fingerprint: None,
            differences: Vec::new(),
        }
    }
}
