//! Recorded cache reuse, attached beside a window's prediction.
//!
//! A window's [`CacheConfidence`] answers "how much do we trust this expiry
//! claim?" and stays exactly as it was. What the session store adds is a
//! separate question — "did the request that resumed this window actually
//! reuse anything?" — and the two must not be collapsed. A later request
//! reusing some tokens is not evidence that an earlier expiry prediction was
//! wrong: the prefix may have been rebuilt, or only part of it may have
//! survived. The UI can therefore say "Predicted expired; the resuming
//! request recorded 12k cache reads" and be accurate about both halves.
//!
//! Attachment is conservative by design. A request is associated with a
//! window only when it is unambiguously the *first* root request inside that
//! window's resume interval and its model agrees. Subagent and compaction
//! requests are excluded outright: a worker running concurrently with the
//! main agent says nothing about the root prompt's cache, and a compaction
//! request is a different prompt altogether.

use serde::Serialize;

use super::model::{CacheWindow, CacheWindowOutcome};
use super::parse_timestamp;
use crate::session_store::{AttributionStatus, RequestInitiator, StoreRequest};

/// Whether a recorded observation lines up with the window's prediction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CacheComparison {
    /// The observation is consistent with the prediction. Consistency, not
    /// proof: zero recorded reads support "no reuse was recorded", never
    /// "the whole prefix had expired".
    Agrees,
    /// The observation contradicts the prediction. Worth showing, because a
    /// disagreement is usually more informative than either figure alone.
    Differs,
    /// The prediction makes no claim to compare against, or the request did
    /// not record a cache counter.
    NotComparable,
}

impl CacheComparison {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agrees => "agrees",
            Self::Differs => "differs",
            Self::NotComparable => "notComparable",
        }
    }
}

/// What the resuming request recorded.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheObservation {
    /// Index of the window this belongs to.
    pub window_index: usize,
    /// The source row that supplied it. Not a provider request ID.
    pub source_row_id: i64,
    pub model: String,
    pub recorded_at: Option<String>,
    /// Recorded reuse. `None` means the counter was absent, which is not the
    /// same as a recorded zero.
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub input_tokens: Option<u64>,
    /// How the request was tied to this window. Never `Exact`: there is no
    /// identifier the window and the request both carry.
    pub attribution: AttributionStatus,
    pub comparison: CacheComparison,
}

/// Attach observations to windows.
///
/// `requests` may be in any order; the association depends only on recorded
/// times, which are compared against each window's resume instant and the
/// start of the following window.
pub fn attach_observations(
    windows: &[CacheWindow],
    requests: &[StoreRequest],
) -> Vec<CacheObservation> {
    let mut candidates: Vec<(chrono::DateTime<chrono::Utc>, &StoreRequest)> = requests
        .iter()
        .filter(|request| is_root_request(request))
        .filter_map(|request| {
            let recorded_at = request.recorded_at.as_deref().and_then(parse_timestamp)?;
            Some((recorded_at, request))
        })
        .collect();
    candidates.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.source_row_id.cmp(&right.1.source_row_id))
    });

    windows
        .iter()
        .filter_map(|window| observation_for(window, windows, &candidates))
        .collect()
}

/// Whether a request is the main agent's own work.
///
/// A missing `initiator` is a historical absence rather than an implicit
/// "user", so it is allowed through only when no agent ID claims the request.
/// The design's rule is that concurrent workers and compaction never attach
/// to a root cache window, and this is where that is enforced.
fn is_root_request(request: &StoreRequest) -> bool {
    if request.agent_id.is_some() {
        return false;
    }
    match request.initiator.as_ref() {
        Some(RequestInitiator::SubAgent | RequestInitiator::Compaction) => false,
        Some(RequestInitiator::Other(_)) => false,
        _ => true,
    }
}

fn observation_for(
    window: &CacheWindow,
    windows: &[CacheWindow],
    candidates: &[(chrono::DateTime<chrono::Utc>, &StoreRequest)],
) -> Option<CacheObservation> {
    let resume_at = window.resume_at.as_deref().and_then(parse_timestamp)?;
    // The interval ends where the next window begins idling, so a request
    // belonging to a later exchange cannot be pulled back into this one.
    let window_end = windows
        .iter()
        .find(|later| later.index > window.index)
        .and_then(|later| parse_timestamp(&later.idle_start));

    let mut inside = candidates.iter().filter(|(recorded_at, _)| {
        *recorded_at >= resume_at && window_end.is_none_or(|end| *recorded_at < end)
    });

    let (first_at, request) = inside.next()?;
    // Two requests recorded at the same instant cannot be ordered, so "the
    // first request" is not a well-defined thing to observe. A multi-request
    // turn is fine — the first of them is still the one that resumed the
    // window — but an unorderable tie is not.
    if inside
        .next()
        .is_some_and(|(next_at, _)| next_at == first_at)
    {
        return None;
    }
    // A different model means this request did not resume *this* window's
    // cached prefix, whatever the timestamps say.
    if let Some(model) = window.model.as_deref()
        && model != request.model
    {
        return None;
    }

    Some(CacheObservation {
        window_index: window.index,
        source_row_id: request.source_row_id,
        model: request.model.clone(),
        recorded_at: request.recorded_at.clone(),
        cache_read_tokens: request.cache_read_tokens,
        cache_write_tokens: request.cache_write_tokens,
        input_tokens: request.input_tokens,
        // Secondary evidence — order, interval and model — that additional
        // checks confirmed. No identifier links the two sides, so this is
        // never `Exact`.
        attribution: AttributionStatus::Validated,
        comparison: compare(window.outcome, request.cache_read_tokens),
    })
}

fn compare(outcome: CacheWindowOutcome, cache_read_tokens: Option<u64>) -> CacheComparison {
    let Some(cache_read_tokens) = cache_read_tokens else {
        return CacheComparison::NotComparable;
    };
    match outcome {
        CacheWindowOutcome::Warm => {
            if cache_read_tokens > 0 {
                CacheComparison::Agrees
            } else {
                CacheComparison::Differs
            }
        }
        CacheWindowOutcome::Expired | CacheWindowOutcome::ModelChanged => {
            if cache_read_tokens > 0 {
                CacheComparison::Differs
            } else {
                CacheComparison::Agrees
            }
        }
        CacheWindowOutcome::NoCache => {
            if cache_read_tokens > 0 {
                CacheComparison::Differs
            } else {
                CacheComparison::Agrees
            }
        }
        // Pending, SessionEnded and Unknown make no claim about reuse, so
        // there is nothing for the observation to agree or disagree with.
        _ => CacheComparison::NotComparable,
    }
}
