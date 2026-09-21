//! Distributions and ratios over recorded requests.
//!
//! Every function here computes over *request samples*, never over averages
//! of per-session summaries: a mean of session p95s is not a p95, and a mean
//! of per-request cache percentages is not a token-weighted reuse ratio.
//!
//! Each metric carries its own [`FieldCoverage`], because the four timing
//! columns have genuinely different populations — 383, 351, 187 and 346 rows
//! locally — and their medians are therefore not comparable to one another.

use serde::{Deserialize, Serialize};

use super::model::StoreRequest;
use super::status::FieldCoverage;

/// Fewest valid samples before a p95 is shown. A presentation threshold that
/// keeps a three-sample "95th percentile" off the screen — not a statement of
/// statistical confidence.
pub const MIN_SAMPLES_FOR_P95: usize = 20;

/// A latency metric's distribution over the rows that supplied it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyDistribution {
    /// Milliseconds.
    pub median: Option<f64>,
    /// Suppressed below [`MIN_SAMPLES_FOR_P95`] valid samples; the count and
    /// median remain.
    pub p95: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub coverage: FieldCoverage,
}

impl LatencyDistribution {
    fn from_samples(mut samples: Vec<f64>, coverage: FieldCoverage) -> Self {
        samples.sort_by(|left, right| left.total_cmp(right));
        Self {
            median: quantile(&samples, 0.5),
            p95: (samples.len() >= MIN_SAMPLES_FOR_P95)
                .then(|| quantile(&samples, 0.95))
                .flatten(),
            min: samples.first().copied(),
            max: samples.last().copied(),
            coverage,
        }
    }
}

/// Linear-interpolated quantile of a sorted sample. `None` when empty.
pub fn quantile(sorted: &[f64], fraction: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    if sorted.len() == 1 {
        return sorted.first().copied();
    }
    let position = fraction.clamp(0.0, 1.0) * (sorted.len() - 1) as f64;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let low = *sorted.get(lower)?;
    let high = *sorted.get(upper)?;
    if lower == upper {
        return Some(low);
    }
    Some(low + (high - low) * (position - lower as f64))
}

/// Two different answers to "did the cache help?", kept apart on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheReuse {
    /// Requests reporting a positive cache read, over requests with a valid
    /// counter.
    pub requests_reporting_reuse: u32,
    pub requests_with_counter: u32,
    /// Sum of cache reads over sum of inputs, across the *same* rows — never
    /// a mean of per-request percentages.
    pub token_weighted_ratio: Option<f64>,
    pub cache_read_tokens: u64,
    pub input_tokens: u64,
    /// Rows excluded because their cache counters exceeded their input, which
    /// makes a ratio meaningless rather than merely imprecise.
    pub inconsistent_rows: u32,
}

/// Compute cache reuse over one population of requests.
///
/// Numerator and denominator use identical rows: a request missing either
/// counter is out of both, and an internally inconsistent request is excluded
/// and counted rather than clamped into range.
pub fn cache_reuse<'a>(requests: impl IntoIterator<Item = &'a StoreRequest>) -> CacheReuse {
    let mut reuse = CacheReuse {
        requests_reporting_reuse: 0,
        requests_with_counter: 0,
        token_weighted_ratio: None,
        cache_read_tokens: 0,
        input_tokens: 0,
        inconsistent_rows: 0,
    };
    for request in requests {
        if !request.cache_counters_are_consistent() {
            reuse.inconsistent_rows = reuse.inconsistent_rows.saturating_add(1);
            continue;
        }
        let (Some(read), Some(input)) = (request.cache_read_tokens, request.input_tokens) else {
            continue;
        };
        reuse.requests_with_counter = reuse.requests_with_counter.saturating_add(1);
        if read > 0 {
            reuse.requests_reporting_reuse = reuse.requests_reporting_reuse.saturating_add(1);
        }
        reuse.cache_read_tokens = reuse.cache_read_tokens.saturating_add(read);
        reuse.input_tokens = reuse.input_tokens.saturating_add(input);
    }
    if reuse.input_tokens > 0 {
        reuse.token_weighted_ratio =
            Some(reuse.cache_read_tokens as f64 / reuse.input_tokens as f64);
    }
    reuse
}

/// Observed performance over a set of requests.
///
/// The two first-token metrics are separate fields with separate coverage
/// because they measure different things: `time_to_first_token` is the
/// streaming first token, while `output_ttft` is the first *observable*
/// output, which includes reasoning and tool-call output. Their difference is
/// not reasoning duration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPerformance {
    pub request_count: u32,
    pub session_count: u32,
    /// Whole API-call duration, which includes waiting before streaming began
    /// and excludes unrelated tool runtime.
    pub duration_ms: LatencyDistribution,
    pub time_to_first_token_ms: LatencyDistribution,
    pub output_ttft_ms: LatencyDistribution,
    /// Reported average inter-token latency. Its reciprocal is not a
    /// visible-text token rate.
    pub inter_token_latency_ms: LatencyDistribution,
    pub cache: CacheReuse,
}

/// Summarise a population of requests.
///
/// `session_count` counts distinct sessions represented, so a distribution
/// dominated by one long session is visible as such.
pub fn request_performance<'a>(
    requests: impl IntoIterator<Item = &'a StoreRequest> + Clone,
) -> RequestPerformance {
    let mut durations = Vec::new();
    let mut duration_coverage = FieldCoverage::default();
    let mut ttft = Vec::new();
    let mut ttft_coverage = FieldCoverage::default();
    let mut output_ttft = Vec::new();
    let mut output_ttft_coverage = FieldCoverage::default();
    let mut itl = Vec::new();
    let mut itl_coverage = FieldCoverage::default();
    let mut sessions: Vec<&str> = Vec::new();
    let mut request_count: u32 = 0;

    for request in requests.clone() {
        request_count = request_count.saturating_add(1);
        if !sessions.contains(&request.session_id.as_str()) {
            sessions.push(request.session_id.as_str());
        }
        collect(request.duration_ms, &mut durations, &mut duration_coverage);
        collect(
            request.time_to_first_token_ms,
            &mut ttft,
            &mut ttft_coverage,
        );
        collect(
            request.output_ttft_ms,
            &mut output_ttft,
            &mut output_ttft_coverage,
        );
        collect(request.inter_token_latency_ms, &mut itl, &mut itl_coverage);
    }

    RequestPerformance {
        request_count,
        session_count: u32::try_from(sessions.len()).unwrap_or(u32::MAX),
        duration_ms: LatencyDistribution::from_samples(durations, duration_coverage),
        time_to_first_token_ms: LatencyDistribution::from_samples(ttft, ttft_coverage),
        output_ttft_ms: LatencyDistribution::from_samples(output_ttft, output_ttft_coverage),
        inter_token_latency_ms: LatencyDistribution::from_samples(itl, itl_coverage),
        cache: cache_reuse(requests),
    }
}

fn collect(value: Option<f64>, samples: &mut Vec<f64>, coverage: &mut FieldCoverage) {
    match value {
        Some(value) if value.is_finite() && value >= 0.0 => {
            samples.push(value);
            coverage.record_valid();
        }
        Some(_) => coverage.record_invalid(),
        None => coverage.record_missing(),
    }
}
