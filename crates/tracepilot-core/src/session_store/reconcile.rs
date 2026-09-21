//! Comparing recorded requests against the session's own shutdown accounting.
//!
//! The earlier research found one session where the store held 112 requests
//! and the shutdown's model metrics counted 111. The extra row is an explicit
//! `initiator=compaction` request whose tokens sit outside the model totals
//! while its charge is already inside the session's credits. That is an
//! accounting-*scope* difference, not a missing or duplicated request.
//!
//! So reconciliation tries the scopes in order and reports **which one
//! matched**, rather than quietly excluding compaction everywhere. A verdict
//! that does not name its scope and metric set is not a verdict a reader can
//! use, and "credits match" is never evidence that token attribution matches.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::models::event_types::session_lifecycle_data::{ModelMetricDetail, ShutdownData};

use super::model::StoreRequest;
use super::status::{ReconciliationReport, ReconciliationStatus};

/// Which requests a comparison counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReconciliationScope {
    /// Every recorded request.
    AllRequests,
    /// Every request except those the source marks `initiator=compaction`.
    /// This is the scope that matched the shutdown *model* metrics locally.
    ExcludingCompaction,
}

impl ReconciliationScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AllRequests => "allRequests",
            Self::ExcludingCompaction => "excludingCompaction",
        }
    }

    fn includes(self, request: &StoreRequest) -> bool {
        match self {
            Self::AllRequests => true,
            Self::ExcludingCompaction => !request
                .initiator
                .as_ref()
                .is_some_and(|initiator| initiator.is_compaction()),
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Totals {
    requests: u64,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
}

/// Compare a session's recorded requests to its combined shutdown metrics.
///
/// `snapshot_fingerprint` identifies the event snapshot used, so a later log
/// rewrite invalidates the verdict instead of leaving a stale "reconciled"
/// badge attached to data that has moved underneath it.
pub fn reconcile_session(
    requests: &[StoreRequest],
    shutdown: Option<&ShutdownData>,
    snapshot_fingerprint: Option<String>,
) -> ReconciliationReport {
    let Some(shutdown) = shutdown else {
        return ReconciliationReport::unverified("no shutdown snapshot");
    };
    let Some(model_metrics) = shutdown.model_metrics.as_ref() else {
        return ReconciliationReport::unverified("shutdown has no model metrics");
    };
    if requests.is_empty() {
        return ReconciliationReport::unverified("no recorded requests");
    }

    let expected = shutdown_totals(model_metrics);
    let metrics = compared_metric_names();

    // All-requests first: when it matches, no scope adjustment is needed and
    // claiming one would misdescribe the data.
    for scope in [
        ReconciliationScope::AllRequests,
        ReconciliationScope::ExcludingCompaction,
    ] {
        let observed = request_totals(requests, scope);
        let differences = compare(&observed, &expected);
        if differences.is_empty() {
            return ReconciliationReport {
                status: if scope == ReconciliationScope::AllRequests {
                    ReconciliationStatus::Reconciled
                } else {
                    ReconciliationStatus::ScopeDifference
                },
                metrics,
                scope: scope.as_str().to_string(),
                snapshot_fingerprint,
                differences: Vec::new(),
            };
        }
    }

    let observed = request_totals(requests, ReconciliationScope::AllRequests);
    let differences = compare(&observed, &expected);
    let comparable = expected.input_tokens.is_some()
        || expected.output_tokens.is_some()
        || expected.cache_read_tokens.is_some();
    ReconciliationReport {
        status: if comparable {
            ReconciliationStatus::Mismatch
        } else {
            ReconciliationStatus::Partial
        },
        metrics,
        scope: ReconciliationScope::AllRequests.as_str().to_string(),
        snapshot_fingerprint,
        differences,
    }
}

fn compared_metric_names() -> Vec<String> {
    ["requests", "inputTokens", "outputTokens", "cacheReadTokens"]
        .iter()
        .map(|name| (*name).to_string())
        .collect()
}

fn request_totals(requests: &[StoreRequest], scope: ReconciliationScope) -> Totals {
    let mut totals = Totals::default();
    for request in requests.iter().filter(|request| scope.includes(request)) {
        totals.requests = totals.requests.saturating_add(1);
        accumulate(&mut totals.input_tokens, request.input_tokens);
        accumulate(&mut totals.output_tokens, request.output_tokens);
        accumulate(&mut totals.cache_read_tokens, request.cache_read_tokens);
        accumulate(&mut totals.cache_write_tokens, request.cache_write_tokens);
        accumulate(&mut totals.reasoning_tokens, request.reasoning_tokens);
    }
    totals
}

fn shutdown_totals(model_metrics: &HashMap<String, ModelMetricDetail>) -> Totals {
    let mut totals = Totals::default();
    for detail in model_metrics.values() {
        if let Some(requests) = detail.requests.as_ref().and_then(|metrics| metrics.count) {
            totals.requests = totals.requests.saturating_add(requests);
        }
        let Some(usage) = detail.usage.as_ref() else {
            continue;
        };
        accumulate(&mut totals.input_tokens, usage.input_tokens);
        accumulate(&mut totals.output_tokens, usage.output_tokens);
        accumulate(&mut totals.cache_read_tokens, usage.cache_read_tokens);
        accumulate(&mut totals.cache_write_tokens, usage.cache_write_tokens);
        accumulate(&mut totals.reasoning_tokens, usage.reasoning_tokens);
    }
    totals
}

/// Sum into an optional total, where `None` means "nothing contributed yet".
/// A missing counter on one side leaves the total absent rather than reading
/// as a zero that would then falsely match.
fn accumulate(total: &mut Option<u64>, value: Option<u64>) {
    if let Some(value) = value {
        *total = Some(total.unwrap_or(0).saturating_add(value));
    }
}

fn compare(observed: &Totals, expected: &Totals) -> Vec<String> {
    let mut differences = Vec::new();
    if observed.requests != expected.requests {
        differences.push(format!(
            "requests: recorded {} vs shutdown {}",
            observed.requests, expected.requests
        ));
    }
    for (name, left, right) in [
        ("inputTokens", observed.input_tokens, expected.input_tokens),
        (
            "outputTokens",
            observed.output_tokens,
            expected.output_tokens,
        ),
        (
            "cacheReadTokens",
            observed.cache_read_tokens,
            expected.cache_read_tokens,
        ),
    ] {
        if let (Some(left), Some(right)) = (left, right)
            && left != right
        {
            differences.push(format!("{name}: recorded {left} vs shutdown {right}"));
        }
    }
    differences
}
