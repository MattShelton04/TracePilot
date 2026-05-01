use std::collections::HashMap;

use crate::models::event_types::ModelMetricDetail;

use super::super::types::{CacheStats, ModelDistEntry};

#[derive(Default)]
pub(super) struct ModelDistributionAccumulator {
    model_tokens: HashMap<String, ModelTokenTotals>,
    total_cache_read_tokens: u64,
    total_input_tokens: u64,
}

#[derive(Default)]
struct ModelTokenTotals {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    premium_cost: f64,
    request_count: u64,
    reasoning_tokens_sum: u64,
    has_reasoning_data: bool,
}

pub(super) struct ModelMetricsTotals {
    pub tokens: u64,
    pub cost: f64,
}

impl ModelDistributionAccumulator {
    pub(super) fn record_model_metrics(
        &mut self,
        model_metrics: &HashMap<String, ModelMetricDetail>,
    ) -> ModelMetricsTotals {
        let mut tokens = 0;
        let mut cost = 0.0;

        for (model_name, detail) in model_metrics {
            if let Some(ref usage) = detail.usage {
                let input_t = usage.input_tokens.unwrap_or(0);
                let output_t = usage.output_tokens.unwrap_or(0);
                let cache_read = usage.cache_read_tokens.unwrap_or(0);
                let cache_write = usage.cache_write_tokens.unwrap_or(0);
                let session_model_tokens = input_t + output_t;
                tokens += session_model_tokens;

                let entry = self.entry(model_name);
                entry.input_tokens += input_t;
                entry.output_tokens += output_t;
                entry.cache_read_tokens += cache_read;
                entry.cache_write_tokens += cache_write;

                if let Some(reasoning_tokens) = usage.reasoning_tokens {
                    entry.reasoning_tokens_sum += reasoning_tokens;
                    entry.has_reasoning_data = true;
                }

                self.total_cache_read_tokens += cache_read;
                self.total_input_tokens += input_t;
            }

            if let Some(ref requests) = detail.requests {
                let request_cost = requests.cost.unwrap_or(0.0);
                cost += request_cost;
                let req_count = requests.count.unwrap_or(0);
                let entry = self.entry(model_name);
                entry.premium_cost += request_cost;
                entry.request_count += req_count;
            }
        }

        ModelMetricsTotals { tokens, cost }
    }

    pub(super) fn into_model_distribution(self) -> Vec<ModelDistEntry> {
        let total_model_tokens: u64 = self
            .model_tokens
            .values()
            .map(|totals| totals.input_tokens + totals.output_tokens)
            .sum();
        let mut model_distribution: Vec<ModelDistEntry> = self
            .model_tokens
            .into_iter()
            .map(|(model, totals)| {
                let tokens = totals.input_tokens + totals.output_tokens;
                let percentage = if total_model_tokens > 0 {
                    (tokens as f64 / total_model_tokens as f64) * 100.0
                } else {
                    0.0
                };
                ModelDistEntry {
                    model,
                    tokens,
                    percentage,
                    input_tokens: totals.input_tokens,
                    output_tokens: totals.output_tokens,
                    cache_read_tokens: totals.cache_read_tokens,
                    premium_requests: totals.premium_cost,
                    request_count: totals.request_count,
                    reasoning_tokens: if totals.has_reasoning_data {
                        Some(totals.reasoning_tokens_sum)
                    } else {
                        None
                    },
                }
            })
            .collect();
        model_distribution.sort_by_key(|b| std::cmp::Reverse(b.tokens));
        model_distribution
    }

    pub(super) fn cache_stats(&self) -> CacheStats {
        let cache_hit_rate = if self.total_input_tokens > 0 {
            (self.total_cache_read_tokens as f64 / self.total_input_tokens as f64) * 100.0
        } else {
            0.0
        };
        CacheStats {
            total_cache_read_tokens: self.total_cache_read_tokens,
            total_input_tokens: self.total_input_tokens,
            cache_hit_rate,
            non_cached_input_tokens: self
                .total_input_tokens
                .saturating_sub(self.total_cache_read_tokens),
        }
    }

    fn entry(&mut self, model_name: &str) -> &mut ModelTokenTotals {
        self.model_tokens.entry(model_name.to_string()).or_default()
    }
}
