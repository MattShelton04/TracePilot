//! Dashboard-level aggregate analytics computation.
//!
//! Contains [`compute_analytics`] which produces the main analytics dashboard
//! data (tokens, cost, trends, productivity metrics, etc.).

mod accumulator;
mod daily;
mod durations;
mod models;
mod range;

#[cfg(test)]
mod tests;

use accumulator::AnalyticsAccumulator;
use range::DateRange;

use super::types::*;

/// Compute aggregate analytics across all sessions.
///
/// PERF: CPU-bound — iterates all sessions once. O(n) where n = session count.
/// For 100+ sessions, consider caching results in the index DB (Phase 3).
///
/// Only requires `SessionSummary` data (no turns needed).
pub fn compute_analytics(sessions: &[SessionAnalyticsInput]) -> AnalyticsData {
    compute_analytics_in_range(sessions, None, None)
}

/// [`compute_analytics`] for sessions selected by a date range (inclusive
/// `YYYY-MM-DD` days), as the indexed dashboard query computes it.
///
/// Counts the sessions with activity in the range: last active in it, or with
/// a segment that ended in it ([`load_full_sessions_active_in_range`](super::load_full_sessions_active_in_range)
/// loads them). Per-day charts use only the segments that ended inside the
/// range. Usage (tokens, cost, premium requests, AI Credits, per-model usage
/// and cache statistics) is, for a session last active in the range, its
/// lifetime total minus the segments that ended outside it, so usage the
/// segments do not account for, such as an undated shutdown, stays with it;
/// for a session last active outside the range, only its segments that ended
/// in it. Turns, tool calls and API durations stay whole-session values.
#[tracing::instrument(skip_all, fields(session_count = sessions.len()))]
pub fn compute_analytics_in_range(
    sessions: &[SessionAnalyticsInput],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> AnalyticsData {
    let range = DateRange {
        from: from_date,
        to: to_date,
    };
    let mut accumulator = AnalyticsAccumulator::new();

    for input in sessions {
        accumulator.record_session(input, range);
    }

    accumulator.into_analytics_data()
}
