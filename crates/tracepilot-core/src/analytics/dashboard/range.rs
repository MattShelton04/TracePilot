//! Usage a date range leaves out of a session's lifetime totals: the segments
//! that ended on a day outside it. Mirrors the indexer's
//! `helpers::range_usage` so the disk fallback and the index agree.

use std::collections::HashMap;

use crate::models::event_types::{ModelMetricDetail, RequestMetrics, SessionSegment, UsageMetrics};

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
}

/// Usage from a session's segments that ended outside the date range,
/// measured like the indexed `session_segments` columns.
#[derive(Default)]
pub(super) struct OutsideUsage {
    pub(super) tokens: u64,
    pub(super) cost: f64,
    pub(super) premium_requests: f64,
    pub(super) nano_aiu: u64,
    models: HashMap<String, OutsideModel>,
}

/// One model's usage in those segments, read like the segments' model JSON.
#[derive(Default)]
struct OutsideModel {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_write: u64,
    reasoning: u64,
    requests: u64,
    cost: f64,
    nano_aiu: u64,
}

impl OutsideUsage {
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
                entry.reasoning += usage.reasoning_tokens.unwrap_or(0);
            }
            if let Some(requests) = &detail.requests {
                entry.requests += requests.count.unwrap_or(0);
                entry.cost += requests.cost.unwrap_or(0.0);
            }
            entry.nano_aiu += detail.total_nano_aiu.unwrap_or(0);
        }
        self.premium_requests += segment.premium_requests;
        self.nano_aiu += segment.total_nano_aiu.unwrap_or(0);
    }

    /// The session's per-model usage inside the range: each lifetime model
    /// minus its usage outside, dropping a model left with nothing.
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
                    reasoning_tokens: u.reasoning_tokens.map(|r| r.saturating_sub(out.reasoning)),
                });
                let requests = detail.requests.as_ref().map(|r| RequestMetrics {
                    count: Some(r.count.unwrap_or(0).saturating_sub(out.requests)),
                    cost: Some((r.cost.unwrap_or(0.0) - out.cost).max(0.0)),
                });
                let total_nano_aiu = detail
                    .total_nano_aiu
                    .map(|n| n.saturating_sub(out.nano_aiu));
                let left = usage.as_ref().map_or(0, |u| {
                    u.input_tokens.unwrap_or(0)
                        + u.output_tokens.unwrap_or(0)
                        + u.cache_read_tokens.unwrap_or(0)
                        + u.cache_write_tokens.unwrap_or(0)
                }) + requests.as_ref().and_then(|r| r.count).unwrap_or(0)
                    + total_nano_aiu.unwrap_or(0);
                let cost_left = requests.as_ref().and_then(|r| r.cost).unwrap_or(0.0);
                (left > 0 || cost_left != 0.0).then(|| {
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
