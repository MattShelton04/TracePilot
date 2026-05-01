//! Dashboard-level aggregate analytics computation.
//!
//! Contains [`compute_analytics`] which produces the main analytics dashboard
//! data (tokens, cost, trends, productivity metrics, etc.).

mod accumulator;
mod daily;
mod durations;
mod models;

#[cfg(test)]
mod tests;

use accumulator::AnalyticsAccumulator;

use super::types::*;

/// Compute aggregate analytics across all sessions.
///
/// PERF: CPU-bound — iterates all sessions once. O(n) where n = session count.
/// For 100+ sessions, consider caching results in the index DB (Phase 3).
///
/// Only requires `SessionSummary` data (no turns needed).
#[tracing::instrument(skip_all, fields(session_count = sessions.len()))]
pub fn compute_analytics(sessions: &[SessionAnalyticsInput]) -> AnalyticsData {
    let mut accumulator = AnalyticsAccumulator::new(sessions.len() as u32);

    for input in sessions {
        accumulator.record_session(input);
    }

    accumulator.into_analytics_data()
}
