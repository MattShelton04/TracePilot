//! Shared utilities for analytics calculations.

use std::collections::HashMap;

use super::types::{HeatmapEntry, ToolUsageEntry};

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
