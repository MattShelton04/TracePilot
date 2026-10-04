//! Shared utilities for analytics calculations.

use std::collections::HashMap;

use super::types::{HeatmapEntry, ToolUsageEntry};
use crate::models::event_types::SessionSegment;

/// Compute the average of two numbers, or 0.0 if the count is zero.
#[inline]
pub fn safe_div(numerator: f64, denominator: u32) -> f64 {
    if denominator > 0 {
        numerator / denominator as f64
    } else {
        0.0
    }
}

/// Compute success rate from success and failure counts, or 0.0 if no outcomes are determined.
#[inline]
pub fn compute_success_rate(success: u32, failure: u32) -> f64 {
    let total = success + failure;
    if total > 0 {
        success as f64 / total as f64
    } else {
        0.0
    }
}

/// The `YYYY-MM-DD` day a segment ended, or `None` when it has no valid date.
///
/// Daily charts and date-range clamping both bucket segments by this day so
/// the disk fallback agrees with the indexed `date(end_timestamp)` queries.
pub(crate) fn segment_end_date(segment: &SessionSegment) -> Option<&str> {
    let date = segment.end_timestamp.split('T').next()?;
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .is_ok()
        .then_some(date)
}

/// Build a full 7x24 heatmap grid from sparse data.
/// `data` map keys are `(day_of_week, hour)`.
pub fn build_heatmap_grid(data: &HashMap<(u32, u32), u32>) -> Vec<HeatmapEntry> {
    let mut grid = Vec::with_capacity(168);
    for day in 0..7u32 {
        for hour in 0..24u32 {
            let count = data.get(&(day, hour)).copied().unwrap_or(0);
            grid.push(HeatmapEntry { day, hour, count });
        }
    }
    grid
}

/// Extract the most used tool name from a list of usage entries.
/// Assumes the list is already sorted by call count descending.
pub fn get_most_used_tool(tools: &[ToolUsageEntry]) -> String {
    tools
        .first()
        .map(|t| t.name.clone())
        .unwrap_or_else(|| "N/A".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment_ending(end_timestamp: &str) -> SessionSegment {
        SessionSegment {
            start_timestamp: String::new(),
            end_timestamp: end_timestamp.to_string(),
            tokens: 0,
            total_requests: 0,
            premium_requests: 0.0,
            api_duration_ms: 0,
            total_nano_aiu: None,
            current_model: None,
            model_metrics: None,
        }
    }

    #[test]
    fn segment_end_date_accepts_only_calendar_days() {
        assert_eq!(
            segment_end_date(&segment_ending("2026-03-01T23:59:59.000Z")),
            Some("2026-03-01")
        );
        assert_eq!(
            segment_end_date(&segment_ending("2026-03-01")),
            Some("2026-03-01")
        );
        assert_eq!(segment_end_date(&segment_ending("")), None);
        assert_eq!(
            segment_end_date(&segment_ending("2026-02-30T00:00:00Z")),
            None
        );
        assert_eq!(segment_end_date(&segment_ending("not a timestamp")), None);
    }
}
