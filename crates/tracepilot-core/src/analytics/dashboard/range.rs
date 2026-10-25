//! Usage from a set of a session's segments: those that ended outside a date
//! range (left out of a session last active in the range) or inside it (all
//! that counts for a session last active outside it). Mirrors the indexer's
//! `helpers::range_usage` so the disk fallback and the index agree.

use std::collections::HashMap;

use crate::models::event_types::{ModelMetricDetail, RequestMetrics, SessionSegment, UsageMetrics};

use super::super::utils::segment_end_date;
use super::daily::tokens_and_cost;

/// An inclusive range of `YYYY-MM-DD` days; `None` leaves that side open.
#[derive(Clone, Copy)]
pub(super) struct DateRange<'a> {
    pub(super) from: Option<&'a str>,
    pub(super) to: Option<&'a str>,
}

impl DateRange<'_> {
    pub(super) fn contains(&self, day: &str) -> bool {
        self.from.is_none_or(|from| day >= from) && self.to.is_none_or(|to| day <= to)
    }

    /// Whether a segment ended on a day in the range; undated ones never do.
    pub(super) fn holds(&self, segment: &SessionSegment) -> bool {
        segment_end_date(segment).is_some_and(|day| self.contains(day))
    }
}

/// Usage from some of a session's segments, measured like the indexed
/// `session_segments` columns.
#[derive(Default)]
pub(super) struct SegmentUsage {
    pub(super) tokens: u64,
    pub(super) cost: f64,
    pub(super) premium_requests: f64,
    pub(super) nano_aiu: u64,
    /// Whether any of the segments observed AI Credits.
    observed_nano_aiu: bool,
    models: HashMap<String, SegmentModel>,
}

/// One model's usage in those segments, read like the segments' model JSON.
#[derive(Default)]
struct SegmentModel {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    reasoning: Option<u64>,
    requests: u64,
    cost: f64,
    nano_aiu: Option<u64>,
}

/// Whether a model row has any usage left; empty rows are dropped.
fn has_usage(
    usage: Option<&UsageMetrics>,
    requests: Option<&RequestMetrics>,
    nano_aiu: Option<u64>,
) -> bool {
    let left = usage.map_or(0, |u| {
        u.input_tokens.unwrap_or(0)
            + u.output_tokens.unwrap_or(0)
            + u.cache_read_tokens.unwrap_or(0)
            + u.cache_write_tokens.unwrap_or(0)
    }) + requests.and_then(|r| r.count).unwrap_or(0)
        + nano_aiu.unwrap_or(0);
    let cost_left = requests.and_then(|r| r.cost).unwrap_or(0.0);
    left > 0 || cost_left != 0.0
}

impl SegmentUsage {
    pub(super) fn add(&mut self, segment: &SessionSegment) {
        for (model, detail) in segment.model_metrics.iter().flatten() {
            let totals = tokens_and_cost(detail);
            self.tokens += totals.tokens;
            self.cost += totals.cost;
            let entry = self.models.entry(model.clone()).or_default();
            if let Some(usage) = &detail.usage {
                entry.input += usage.input_tokens.unwrap_or(0);
                entry.output += usage.output_tokens.unwrap_or(0);
                entry.cache_read += usage.cache_read_tokens.unwrap_or(0);
                entry.cache_write += usage.cache_write_tokens.unwrap_or(0);
                if let Some(reasoning) = usage.reasoning_tokens {
                    *entry.reasoning.get_or_insert(0) += reasoning;
                }
            }
            if let Some(requests) = &detail.requests {
                entry.requests += requests.count.unwrap_or(0);
                entry.cost += requests.cost.unwrap_or(0.0);
            }
            if let Some(nano_aiu) = detail.total_nano_aiu {
                *entry.nano_aiu.get_or_insert(0) += nano_aiu;
            }
        }
        self.premium_requests += segment.premium_requests;
        if let Some(nano_aiu) = segment.total_nano_aiu {
            self.nano_aiu += nano_aiu;
            self.observed_nano_aiu = true;
        }
    }

    /// The segments' AI Credits; `None` when none were observed.
    pub(super) fn observed_nano_aiu(&self) -> Option<u64> {
        self.observed_nano_aiu.then_some(self.nano_aiu)
    }

    /// The segments' own per-model usage, for a session counted from its
    /// in-range segments alone, dropping a model with nothing.
    pub(super) fn models(&self) -> HashMap<String, ModelMetricDetail> {
        self.models
            .iter()
            .filter_map(|(model, usage)| {
                let detail = ModelMetricDetail {
                    requests: Some(RequestMetrics {
                        count: Some(usage.requests),
                        cost: Some(usage.cost),
                    }),
                    usage: Some(UsageMetrics {
                        input_tokens: Some(usage.input),
                        output_tokens: Some(usage.output),
                        cache_read_tokens: Some(usage.cache_read),
                        cache_write_tokens: Some(usage.cache_write),
                        reasoning_tokens: usage.reasoning,
                    }),
                    total_nano_aiu: usage.nano_aiu,
                    token_details: None,
                };
                has_usage(
                    detail.usage.as_ref(),
                    detail.requests.as_ref(),
                    detail.total_nano_aiu,
                )
                .then(|| (model.clone(), detail))
            })
            .collect()
    }

    /// The session's per-model usage inside the range, when these are its
    /// segments outside it: each lifetime model minus its usage outside,
    /// dropping a model left with nothing.
    pub(super) fn in_range_models(
        &self,
        lifetime: &HashMap<String, ModelMetricDetail>,
    ) -> HashMap<String, ModelMetricDetail> {
        lifetime
            .iter()
            .filter_map(|(model, detail)| {
                let Some(out) = self.models.get(model) else {
                    return Some((model.clone(), detail.clone()));
                };
                let usage = detail.usage.as_ref().map(|u| UsageMetrics {
                    input_tokens: Some(u.input_tokens.unwrap_or(0).saturating_sub(out.input)),
                    output_tokens: Some(u.output_tokens.unwrap_or(0).saturating_sub(out.output)),
                    cache_read_tokens: Some(
                        u.cache_read_tokens
                            .unwrap_or(0)
                            .saturating_sub(out.cache_read),
                    ),
                    cache_write_tokens: Some(
                        u.cache_write_tokens
                            .unwrap_or(0)
                            .saturating_sub(out.cache_write),
                    ),
                    reasoning_tokens: u
                        .reasoning_tokens
                        .map(|r| r.saturating_sub(out.reasoning.unwrap_or(0))),
                });
                let requests = detail.requests.as_ref().map(|r| RequestMetrics {
                    count: Some(r.count.unwrap_or(0).saturating_sub(out.requests)),
                    cost: Some((r.cost.unwrap_or(0.0) - out.cost).max(0.0)),
                });
                let total_nano_aiu = detail
                    .total_nano_aiu
                    .map(|n| n.saturating_sub(out.nano_aiu.unwrap_or(0)));
                has_usage(usage.as_ref(), requests.as_ref(), total_nano_aiu).then(|| {
                    (
                        model.clone(),
                        ModelMetricDetail {
                            requests,
                            usage,
                            total_nano_aiu,
                            token_details: detail.token_details.clone(),
                        },
                    )
                })
            })
            .collect()
    }
}
