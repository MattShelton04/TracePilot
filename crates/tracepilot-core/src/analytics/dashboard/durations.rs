use super::super::types::ApiDurationStats;

/// Compute API duration statistics from a list of per-session `total_api_duration_ms` values.
pub(super) fn compute_duration_stats(durations: &[u64]) -> ApiDurationStats {
    if durations.is_empty() {
        return ApiDurationStats {
            avg_ms: 0.0,
            median_ms: 0.0,
            p95_ms: 0.0,
            min_ms: 0,
            max_ms: 0,
            total_sessions_with_duration: 0,
        };
    }

    let mut sorted = durations.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let sum: u64 = sorted.iter().sum();

    let avg_ms = sum as f64 / n as f64;
    let median_ms = if n.is_multiple_of(2) {
        (sorted[n / 2 - 1] + sorted[n / 2]) as f64 / 2.0
    } else {
        sorted[n / 2] as f64
    };
    let p95_idx = ((n as f64 * 0.95).ceil() as usize).min(n) - 1;
    let p95_ms = sorted[p95_idx] as f64;

    ApiDurationStats {
        avg_ms,
        median_ms,
        p95_ms,
        min_ms: sorted[0],
        max_ms: sorted[n - 1],
        total_sessions_with_duration: n as u32,
    }
}
